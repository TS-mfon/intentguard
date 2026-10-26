import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {readFile} from "node:fs/promises";

export const terminalStates = new Set(["PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","EXPIRED","CANCELLED"]);
const id = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const payment = z.object({
 destinationChainId:z.number().int().positive().optional(),
 recipient:address,
 amount:z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/).refine(v=>{const[a,b=""]=v.split(".");try{const n=BigInt(a)*1000000n+BigInt(b.padEnd(6,"0"));return n>0n&&n<=18446744073709551615n;}catch{return false;}},"Use a positive decimal string with at most six fractional digits within uint64."),
 purchaseDescription:z.string().min(3).max(2000),
 justification:z.string().min(3).max(6000),
 category:z.string().min(1).max(200),
 invoiceId:z.string().min(1).max(200),
 evidence:z.array(z.object({url:z.url().max(2048).refine(v=>{try{return new URL(v).protocol==="https:"}catch{return false}},"Evidence uses HTTPS"),sha256:z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/).optional()}).strict()).min(1).max(8)
}).strict().refine(v=>new Set(v.evidence.map(e=>e.url)).size===v.evidence.length,"Evidence URLs must be unique");
function safeBase(value){
 const u=new URL(value);
 if(u.username||u.password||u.search||u.hash||!["","/"].includes(u.pathname))throw Error("INTENTGUARD_BASE_URL must be an application origin without credentials, path, query or fragment");
 if(u.protocol!=="https:"&&!(u.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(u.hostname)))throw Error("Use HTTPS; HTTP is allowed only for loopback development");
 return u.origin;
}
function fail(code,message,status=0,retryable=false,extra={}){
 return {ok:false,error:{code,message,status,retryable,...extra}};
}
export function createProtocolServer({baseUrl="https://intentguard-tapeout.vercel.app",apiKey="",fetchImpl=fetch}={}){
 const base=safeBase(baseUrl),sanitize=v=>apiKey?JSON.parse(JSON.stringify(v).replaceAll(apiKey,"[REDACTED]")):v;
 async function call(path,{authenticated=false,method="GET",body,idempotencyKey,signal}={}){
  if(authenticated&&!apiKey)return fail("KEY_REQUIRED","Configure INTENTGUARD_API_KEY with the one-time agent credential. Public tools remain available.",401);
  const headers={"Accept":"application/json"};
  if(authenticated)headers.Authorization="Bearer "+apiKey;
  if(body!==undefined)headers["Content-Type"]="application/json";
  if(idempotencyKey)headers["Idempotency-Key"]=idempotencyKey;
  try{
   const response=await fetchImpl(base+"/api/v1"+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal??AbortSignal.timeout(20000),redirect:"error"});
   let value;try{value=await response.json()}catch{return fail("INVALID_RESPONSE","The service returned a non-JSON response. Preserve the operation ID/key and check service availability.",response.status,true,{requestId:response.headers.get("x-request-id")??undefined});}
   if(!response.ok){
    const e=value?.error??{};
    return sanitize(fail(typeof e.code==="string"?e.code:"HTTP_ERROR",typeof e.message==="string"?e.message:"IntentGuard request failed",response.status,e.retryable??(response.status===429||response.status>=500),{requestId:e.requestId??response.headers.get("x-request-id")??undefined,retryAfterSeconds:Number(response.headers.get("retry-after"))||undefined,...(e.details?{details:e.details}:{})}));
   }
   return sanitize({ok:true,status:response.status,data:value});
  }catch{
   return fail("TRANSPORT_UNAVAILABLE","The response could not be obtained. For submission, retry the exact payload with the SAME Idempotency-Key; no automatic new payment was created by this tool.",0,true);
  }
 }
 const server=new McpServer({name:"intentguard-protocol",version:"0.3.0"},{instructions:"Read intentguard://protocol before requesting payment. Native USDC cards use owner-approved X Layer/Base Sepolia/Arbitrum Sepolia destinations. Read the actual agent token, not the legacy config token. Burn, attestation and mint submission are pending; only PAID confirms funds delivered. Inspect /me policy and balances. Request invoices for the vault buyer. Keep exact decimal strings and a stable Idempotency-Key per purchase. Never put credentials in tool arguments. This deployment uses X Layer testnet 1952 and GenLayer Studionet 61999."});
 const output=value=>({content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value,...(value.ok===false?{isError:true}:{})});
 const register=(name,description,inputSchema,handler,readOnly=true)=>server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,idempotentHint:true,openWorldHint:true}},async args=>output(await handler(args)));
 register("get_config","Read public runtime chain, token, circuit and configured status. Verify testnet before integrating.",{},()=>call("/config"));
 register("get_my_agent","Read the credential-bound agent's immutable policy, vault, actual balances and reviewer readiness. Agent key stays in server environment.",{},()=>call("/me",{authenticated:true}));
 register("submit_payment","Submit ONE owner-permitted invoice-backed payment. Admission HTTP 202 is not settlement. Keep the same idempotencyKey and identical payment on retry; never invent a merchant invoice. Optional destinationChainId must be owner-approved; invoice token/chain identify the destination USDC. CCTP burns cannot be cancelled or repeated. This requests a potential token transfer.",{payment,idempotencyKey:z.string().regex(/^[ -~]{1,128}$/)},args=>call("/requests",{authenticated:true,method:"POST",body:args.payment,idempotencyKey:args.idempotencyKey}),false);
 register("get_payment","Read an existing payment belonging to this credential's agent. PAID is delivered; APPROVED and CCTP bridge states are awaiting settlement. Terminal failure requires correction, not endless polling.",{id},args=>call("/requests/"+encodeURIComponent(args.id),{authenticated:true}));
 register("wait_for_payment","Poll an existing operation for a bounded time. Returns pending with the same id when its deadline expires; never resubmits. Default 30 seconds, maximum 45 seconds.",{id,maxWaitMs:z.number().int().min(0).max(45000).default(30000)},async args=>{
  const end=Date.now()+args.maxWaitMs;let result;
  do{
   result=await call("/requests/"+encodeURIComponent(args.id),{authenticated:true,signal:AbortSignal.timeout(Math.max(1000,Math.min(20000,end-Date.now()+1000)))});
   if(!result.ok||terminalStates.has(result.data.status))return result;
   if(Date.now()+5000>end)break;
   await new Promise(r=>setTimeout(r,5000));
  }while(Date.now()<end);
  return {...result,pending:true,operationId:args.id,nextAction:"Poll this same operation ID later. Do not submit a new payment to resolve a timeout."};
 });
 const page={limit:z.number().int().min(1).max(50).default(20),cursor:z.string().max(2048).optional()};
 register("list_agents","Read public deployed agents with cursor pagination. Does not require or transmit an agent credential.",page,args=>call("/explorer/agents?"+new URLSearchParams(Object.entries(args).map(([k,v])=>[k,String(v)]))));
 register("list_transactions","Read actual public payment requests, optionally filtered by agentId/status. Records include failed attempts, not only transfers.",{...page,agentId:id.optional(),status:z.enum(["QUEUED","RESERVED","REVIEWING","AWAITING_FINALITY","APPROVED","BRIDGING","AWAITING_ATTESTATION","MINTING","PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","EXPIRED","CANCELLED","RETRYING"]).optional()},args=>call("/explorer/transactions?"+new URLSearchParams(Object.entries(args).map(([k,v])=>[k,String(v)]))));
 register("get_transaction","Inspect public transaction, review stage and independently verified GenLayer reasoning when available. Skipped or failed reviews have no finalized reasoning.",{id},args=>call("/explorer/transactions/"+encodeURIComponent(args.id)));
 register("get_agent_card","Read downloadable ATM card identity and real cumulative request/paid-funds statistics. Snapshot timestamp distinguishes this from a live proof.",{id},args=>call("/explorer/agents/"+encodeURIComponent(args.id)+"/card"));
 for(const[name,uri,file,mimeType]of [["protocol","intentguard://protocol","PROTOCOL.md","text/markdown"],["openapi","intentguard://openapi","openapi.json","application/json"]]){
  server.registerResource(name,uri,{description:name==="protocol"?"Self-contained integration, limits, states and trust boundaries":"Complete HTTP request and response schemas",mimeType},async()=>({contents:[{uri,mimeType,text:await readFile(new URL("../resources/"+file,import.meta.url),"utf8")}]}));
 }
 server.registerPrompt("payment_integration",{description:"Plan an IntentGuard integration using the protocol resource before any payment.",argsSchema:{task:z.string().max(4000)}},args=>({messages:[{role:"user",content:{type:"text",text:"Read intentguard://protocol and intentguard://openapi. For this task, inspect get_config and get_my_agent, identify the approved merchant and exact budget, obtain a real vault-bound invoice, and propose one payment with stable idempotency. Preserve user authorization. Task: "+args.task}}]}));
 return server;
}
