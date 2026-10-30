// Server gateway only. Never import this module from a client component.
import {createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {isIP} from "node:net";
import {address,canonical,digest,formatAmount,hash,isSettlementV2,parseAmount,policySchema,type PaymentInput,type Policy,type RequestView} from "../../../packages/shared";
import {CCTP_TESTNETS} from "../../../packages/shared/assets";
import {configuration} from "./config";
import {ApiError} from "./errors";
import {rateLimit,secret} from "./auth";
import {assertApplicationOrigin} from "./origins";
import {assertCardEnvironment} from "./settlement";
import {activeStatuses,type Card,type Payment} from "./models";
import type {Doc,Store} from "./store";
import type {EvmPort} from "./evm";

export const SANDBOX_SCENARIOS=[
 {id:"permitted",label:"Allowed service",expected:"PAID",description:"Buy a native-USDC settlement verification service."},
 {id:"blocked",label:"Over budget",expected:"BLOCKED",description:"Request more than the card's per-payment limit."},
 {id:"prohibited",label:"Prohibited purchase",expected:"REJECTED",description:"Request personal data for advertising, which the owner prohibits."},
 {id:"wrong-buyer",label:"Wrong invoice buyer",expected:"NEEDS_EVIDENCE",description:"Supply an invoice that names a different buyer."}
] as const;
export type SandboxScenario=typeof SANDBOX_SCENARIOS[number]["id"];
const NAME="IntentGuard public sandbox",PRODUCT="Native USDC settlement verification",CATEGORY="protocol-verification";
const NORMAL_AMOUNT="0.000001",BLOCKED_AMOUNT="0.010001",SESSION_MS=3600000,VISITOR_LIMIT=5,GLOBAL_PER_MINUTE=6;
type Settings={cardId:string;owner:string;apiKey:string;keyId:string;scope:string;maxRequests:number};
type Visitor=Doc&{visitorId:string;scope:string;origin:string;expires:number;createdAt:number;expiresAt:Date};
type Binding=Doc&{visitorId:string;scope:string;origin:string;scenario:SandboxScenario;inputHash:string;requestId:string;idempotency:string;input:PaymentInput;invoice:{invoiceId:string;buyer:string;token:string;chainId:number;recipient:string;amount:string;description:string;issuedAt:number;expiresAt:number};slot?:number;visitorSlot?:number;leaseToken?:string;createdAt:number;expiresAt:Date};
type Ports={submit:(req:Request)=>Promise<Response>;view:(p:Payment)=>Promise<RequestView>;wake:()=>Promise<unknown>};

function settings():Settings{
 const c=configuration();
 if(!c.testnet||c.chainId!==1952||c.databaseName==="intentguard_mainnet")throw new ApiError(503,"SANDBOX_TESTNET_ONLY","The visitor sandbox is available only on X Layer testnet.");
 const cardId=process.env.INTENTGUARD_SANDBOX_CARD_ID??"",owner=process.env.INTENTGUARD_SANDBOX_OWNER??"",apiKey=process.env.INTENTGUARD_SANDBOX_API_KEY??"";
 if(!hash.safeParse(cardId).success||!address.safeParse(owner).success||!/^ig_[A-Za-z0-9_-]{43}$/.test(apiKey)||apiKey.startsWith("ig_mainnet_"))throw new ApiError(503,"SANDBOX_NOT_CONFIGURED","The dedicated testnet sandbox agent is not ready yet.");
 const limit=process.env.INTENTGUARD_SANDBOX_MAX_REQUESTS??"30";
 if(!/^[1-9][0-9]*$/.test(limit)||Number(limit)>100)throw new ApiError(503,"SANDBOX_LIMIT_INVALID","The sandbox admission limit is not configured safely.");
 const keyId=digest(apiKey),scope=digest({environment:"testnet",chainId:1952,cardId,owner:owner.toLowerCase(),keyId,apiOrigin:c.origin});
 secret();return {cardId,owner:owner.toLowerCase(),apiKey,keyId,scope,maxRequests:Number(limit)};
}

export function sandboxPolicy(recipient:string,origin:string,now=Math.floor(Date.now()/1000)):Policy{
 return policySchema.parse({version:1,name:NAME,mission:"Verify IntentGuard native testnet USDC payment settlement by purchasing the approved protocol verification service. Never purchase personal data for advertising.",taskContext:"Public visitor testing on X Layer testnet. Testnet tokens have no monetary value; every payment requires both numerical permission and finalized evidence review. This is a reusable permission, not a specific purchase. The vault address is assigned after policy finalization. Each later payment request supplies its exact amount, invoice ID and buyer vault; compare the invoice to those request values during purchase review. Any positive request amount permitted by all financial controls is allowed when every purchase criterion passes. No invoice, fixed purchase amount or vault address is required during policy setup.",allowedCategories:[CATEGORY],prohibitedPurchases:["Personal data for advertising"],exceptions:[],financial:{totalBudget:"1",perPaymentLimit:"0.01",periodBudget:"0.1",periodSeconds:86400,validFrom:now-60,validUntil:now+30*86400},merchants:[{name:"IntentGuard protocol test merchant",recipient:address.parse(recipient).toLowerCase(),origins:[new URL(origin).origin],products:[PRODUCT]}],evidence:{requiredTypes:["merchant invoice"],approvedOrigins:[new URL(origin).origin],maxAgeSeconds:7200},criteria:[{id:"purpose",description:"The invoice describes native USDC settlement verification for the assigned protocol testing mission and does not describe personal data for advertising."},{id:"invoice",description:"For each later payment request, its public current invoice must identify the activated requesting vault as buyer and match that request's merchant recipient, X Layer testnet chain1952, native USDC token, exact amount and invoice ID. These values are supplied at request time, not at policy setup."}]});
}

export function assertSandboxCard(card:Card,owner:string,requireMarker=true,requireCurrentValidity=true){
 const c=configuration();if(!c.testnet||c.chainId!==1952)throw new ApiError(503,"SANDBOX_TESTNET_ONLY","The visitor sandbox requires X Layer testnet.");
 assertCardEnvironment(card);
 const merchant=process.env.DEMO_MERCHANT_RECIPIENT;
 if(!merchant||!address.safeParse(merchant).success)throw new ApiError(503,"SANDBOX_MERCHANT_UNAVAILABLE","The sandbox merchant is not configured.");
 const s=card.settlement;
 if((requireMarker&&card.sandbox!==true)||card.owner.toLowerCase()!==owner.toLowerCase()||card.chainId!==1952||!s||s.asset!=="USDC"||s.destinationChainIds.length!==1||s.destinationChainIds[0]!==1952||(isSettlementV2(s)&&s.paymentEnvironment!=="testnet")||card.token?.toLowerCase()!==CCTP_TESTNETS[1952].token.toLowerCase())throw new ApiError(503,"SANDBOX_CARD_INVALID","The sandbox must use its dedicated local native-USDC testnet card.");
 const p=policySchema.safeParse(card.policy);
 if(!p.success)throw new ApiError(503,"SANDBOX_POLICY_INVALID","The sandbox permission is invalid.");
 const expected=sandboxPolicy(merchant,c.origin),actual=p.data;
 for(const field of ["name","mission","taskContext","allowedCategories","prohibitedPurchases","exceptions","merchants","evidence","criteria"] as const)if(canonical(actual[field])!==canonical(expected[field]))throw new ApiError(503,"SANDBOX_POLICY_INVALID","The sandbox permission must match the dedicated testnet testing policy.");
 const f=actual.financial,now=Math.floor(Date.now()/1000);
 if(parseAmount(f.totalBudget)>parseAmount("1")||parseAmount(f.perPaymentLimit)!==parseAmount("0.01")||parseAmount(f.periodBudget)>parseAmount("0.1")||f.periodSeconds!==86400||(requireCurrentValidity&&(f.validFrom>now||f.validUntil<=now)))throw new ApiError(503,"SANDBOX_POLICY_INVALID","The sandbox numerical limits or validity are unavailable.");
}

async function identity(store:Store,readOnly=false){
 const s=settings(),card=await store.get<Card>("cards",s.cardId);if(!card)throw new ApiError(503,"SANDBOX_CARD_UNAVAILABLE","The dedicated sandbox agent is not available.");
 assertSandboxCard(card,s.owner,true,!readOnly);
 const key=await store.get<Doc>("keys",s.keyId),scope=digest({paymentEnvironment:"testnet",paymentChainId:1952});
 if(!key||key.cardId!==card._id||key.owner!==card.owner||key.credentialScope!==scope||(!readOnly&&(key.revoked!==false||card.activeKeyId!==s.keyId||card.keyStatus!=="ACTIVE")))throw new ApiError(503,"SANDBOX_KEY_UNAVAILABLE","The sandbox credential has been revoked or needs configuration.");
 return {s,card};
}
async function ready(store:Store,evm:EvmPort){
 const {s,card}=await identity(store);
 if(card.state!=="READY")throw new ApiError(503,"SANDBOX_REVIEWER_PENDING","The sandbox reviewer is not ready yet.");
 const view=await evm.view(card);
 if(view.id!==card._id||view.chainId!==1952||view.token.toLowerCase()!==card.token?.toLowerCase()||view.policyHash!==card.policyHash)throw new ApiError(503,"SANDBOX_CARD_INVALID","The sandbox chain view differs from its dedicated testnet card.");
 if(view.status!=="ACTIVE"||parseAmount(view.balances.available)<parseAmount(NORMAL_AMOUNT))throw new ApiError(503,"SANDBOX_CARD_DISABLED","The sandbox agent is paused, expired or out of testnet funds.");
 return {s,card,view};
}

function requestOrigin(req:Request){
 if(req.headers.has("origin"))return assertApplicationOrigin(req,configuration().origin);
 if(req.method!=="GET"||req.headers.get("sec-fetch-site")==="cross-site")throw new ApiError(403,"ORIGIN_DENIED","Use the approved sandbox application.");
 return new URL(req.url).origin;
}
function ipBucket(req:Request){
 // Vercel overwrites its own trusted client-IP header. Ordinary proxy/user headers
 // are deliberately ignored; untrusted/local callers share a conservative bucket.
 const value=process.env.VERCEL==="1"?req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim():undefined;
 return digest(isIP(value??"")?value:"untrusted-client");
}
function tokenFor(visitor:Visitor){
 const payload=Buffer.from(JSON.stringify({id:visitor.visitorId,scope:visitor.scope,origin:visitor.origin,expires:visitor.expires})).toString("base64url");
 return payload+"."+createHmac("sha256",secret()).update("sandbox:"+payload).digest("base64url");
}
async function visitor(store:Store,req:Request,s:Settings){
 const header=req.headers.get("authorization")??"",token=header.startsWith("Sandbox ")?header.slice(8):"";
 if(token.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw new ApiError(401,"SANDBOX_SESSION_REQUIRED","Start a fresh sandbox session.");
 const [payload,supplied]=token.split("."),received=Buffer.from(supplied,"base64url"),expected=createHmac("sha256",secret()).update("sandbox:"+payload).digest();
 if(received.length!==expected.length||!timingSafeEqual(received,expected))throw new ApiError(401,"SANDBOX_SESSION_INVALID","Start a fresh sandbox session.");
 let data:{id:string;scope:string;origin:string;expires:number};try{data=JSON.parse(Buffer.from(payload,"base64url").toString());}catch{throw new ApiError(401,"SANDBOX_SESSION_INVALID","Start a fresh sandbox session.");}
 if(!data||typeof data.id!=="string"||!Number.isSafeInteger(data.expires)||data.expires<=Date.now()||data.expires>Date.now()+SESSION_MS||data.scope!==s.scope||data.origin!==requestOrigin(req))throw new ApiError(401,"SANDBOX_SESSION_EXPIRED","Start a fresh sandbox session at this application.");
 const saved=await store.get<Visitor>("rate","sandbox-session:"+digest(token));
 if(!saved||saved.visitorId!==data.id||saved.scope!==s.scope||saved.origin!==data.origin||saved.expires!==data.expires)throw new ApiError(401,"SANDBOX_SESSION_INVALID","Start a fresh sandbox session.");
 return saved;
}
async function allocate(store:Store,prefix:string,id:string,limit:number,expiresAt?:Date){
 for(let i=0;i<limit;i++){const slot=await store.get<Doc>("rate",prefix+i);if(slot?.bindingId===id)return i;if(!slot&&await store.create("rate",{_id:prefix+i,bindingId:id,slotGroup:prefix,createdAt:Date.now(),...(expiresAt?{expiresAt}:{} )}))return i;}
 throw new ApiError(429,"SANDBOX_LIMIT_REACHED","The sandbox request allowance has been used. Inspect the existing records or create your own agent.",undefined,3600);
}
function safeObject(value:unknown){return !!value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length===1&&typeof (value as {scenario?:unknown}).scenario==="string";}
function buildBinding(s:Settings,card:Card,v:Visitor,idempotency:string,scenario:SandboxScenario):Binding{
 const id=digest({scope:s.scope,visitorId:v.visitorId,idempotency}),invoiceId=id.slice(2,34),amount=scenario==="blocked"?BLOCKED_AMOUNT:NORMAL_AMOUNT;
 const description=scenario==="prohibited"?"Personal data for advertising":PRODUCT,issuedAt=Math.floor(Date.now()/1000),recipient=card.policy.merchants[0].recipient;
 const internalIdempotency="sandbox:"+digest({visitorId:v.visitorId,idempotency}).slice(2);
 const invoice={invoiceId,buyer:(scenario==="wrong-buyer"?card.owner:card.address).toLowerCase(),token:CCTP_TESTNETS[1952].token.toLowerCase(),chainId:1952,recipient:recipient.toLowerCase(),amount,description:description+". Public protocol testnet request; tokens have no monetary value.",issuedAt,expiresAt:issuedAt+7200};
 const input:PaymentInput={destinationChainId:1952,recipient,amount,purchaseDescription:description,justification:scenario==="prohibited"?"Purchase personal data for an advertising campaign.":"Verify the approved native testnet USDC payment and its exact public receipt.",category:CATEGORY,invoiceId,evidence:[{url:configuration().origin+"/api/v1/demo/invoices/"+invoiceId}]};
 return {_id:"sandbox-binding:"+id,visitorId:v.visitorId,scope:s.scope,origin:v.origin,scenario,inputHash:digest({scenario}),requestId:digest({cardId:card._id,idempotency:internalIdempotency}),idempotency:internalIdempotency,input,invoice,createdAt:Date.now(),expiresAt:new Date(v.expires)};
}
function admitted(binding:Binding,p:Payment){return {id:p._id,status:p.status,scenario:binding.scenario,createdAt:p.createdAt,publicUrl:configuration().frontendOrigin+"/transaction?id="+encodeURIComponent(p._id),paymentEnvironment:"testnet",paymentChainId:1952,reviewEnvironment:"testnet",reviewChainId:61999};}

export function createSandbox(store:Store,evm:EvmPort,ports:Ports){return async(req:Request,path:string,body?:unknown):Promise<Response>=>{
 async function fastBlocked(binding:Binding,card:Card,payment:Payment){
  if(binding.scenario!=="blocked"||payment.status!=="QUEUED")return payment;
  // A live numerical denial needs no model or signature. Claim the ordinary
  // queued record so a worker cannot concurrently advance this preflight.
  const job=await store.claim<Payment>("requests",{_id:payment._id,status:"QUEUED"},Date.now(),30000);
  if(!job)return payment;
  try{const guard=await evm.preview(card,job.input,Math.min(card.policy.financial.validUntil,Math.floor(Date.now()/1000)+86400));
   await store.complete("requests",job._id,job.leaseToken!,{...(guard.allow?{}:{status:"BLOCKED",guard}),updatedAt:Date.now(),nextAt:0});
  }catch(error){await store.complete("requests",job._id,job.leaseToken!,{nextAt:0});throw error;}
  return (await store.get<Payment>("requests",payment._id))!;
 }
 const origin=requestOrigin(req);
 if(path==="/sandbox"){
  await rateLimit(store,"sandbox-config:"+digest({origin,ip:ipBucket(req)}),30);
  try{const {s,card,view}=await ready(store,evm),used=(await store.find("rate",{slotGroup:"sandbox-global-slot:"+card._id+":"},{limit:100})).length;if(used>=s.maxRequests)throw new ApiError(429,"SANDBOX_LIMIT_REACHED","The dedicated sandbox allowance has been used; existing requests remain available for inspection.");return Response.json({enabled:true,card:{id:card._id,name:card.policy.name,address:card.address,policy:card.policy,balances:view.balances},scenarios:SANDBOX_SCENARIOS,limits:{requestsPerVisitor:VISITOR_LIMIT,sessionSeconds:SESSION_MS/1000,maxAdmissions:s.maxRequests,admissionsRemaining:s.maxRequests-used,requestsPerMinute:GLOBAL_PER_MINUTE,normalAmount:NORMAL_AMOUNT,blockedAmount:BLOCKED_AMOUNT,maximumAdmittedTransferAmount:formatAmount(BigInt(s.maxRequests))},paymentEnvironment:"testnet",paymentChainId:1952,reviewEnvironment:"testnet",reviewChainId:61999,disclosure:"Real testnet requests. Testnet tokens have no monetary value. Actual review or settlement can be delayed or fail.",credentialHandling:"The dedicated agent API key stays on the server."},{headers:{"Cache-Control":"no-store"}});}catch(e){if(!(e instanceof ApiError))throw e;return Response.json({enabled:false,reasonCode:e.code,message:e.message,scenarios:SANDBOX_SCENARIOS,paymentEnvironment:"testnet",paymentChainId:1952},{headers:{"Cache-Control":"no-store"}});}
 }
 const {s,card}=req.method==="GET"?await identity(store,true):await ready(store,evm);
 if(path==="/sandbox/session"){
  if(body!==undefined&&(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length))throw new ApiError(422,"INVALID_INPUT","Start the sandbox session with an empty JSON object.");
  await rateLimit(store,"sandbox-session-origin:"+digest(origin),10);await rateLimit(store,"sandbox-session-ip:"+digest({origin,ip:ipBucket(req)}),5);
  const now=Date.now(),v:Visitor={_id:"",visitorId:randomBytes(24).toString("hex"),scope:s.scope,origin,expires:now+SESSION_MS,createdAt:now,expiresAt:new Date(now+SESSION_MS)},token=tokenFor(v);v._id="sandbox-session:"+digest(token);
  if(!await store.create("rate",v))throw new ApiError(503,"SANDBOX_SESSION_UNAVAILABLE","Try starting the sandbox session again.");
  return Response.json({visitorToken:token,expiresAt:v.expires,requestsRemaining:VISITOR_LIMIT},{status:201,headers:{"Cache-Control":"no-store"}});
 }
 const v=await visitor(store,req,s);
 const match=path.match(/^\/sandbox\/requests\/(0x[\da-fA-F]{64})$/);
 if(match){
  await rateLimit(store,"sandbox-poll:"+digest({scope:s.scope,visitorId:v.visitorId}),30);
  const p=await store.get<Payment>("requests",match[1]),bindings=await store.find<Binding>("rate",{requestId:match[1],scope:s.scope,visitorId:v.visitorId});
  if(!p||p.cardId!==card._id||bindings.length!==1)throw new ApiError(404,"NOT_FOUND","Sandbox request not found in this visitor session.");
  if(activeStatuses.includes(p.status))await ports.wake();
  return Response.json({...await ports.view(p),scenario:bindings[0].scenario,publicUrl:admitted(bindings[0],p).publicUrl},{headers:{"Cache-Control":"no-store"}});
 }
 if(path!=="/sandbox/requests")throw new ApiError(404,"NOT_FOUND","Sandbox endpoint not found.");
 if(!safeObject(body)||!SANDBOX_SCENARIOS.some(s=>s.id===(body as {scenario:string}).scenario))throw new ApiError(422,"SANDBOX_SCENARIO_INVALID","Choose one of the four sandbox scenarios; arbitrary payment details are not accepted.");
 const idempotency=req.headers.get("idempotency-key");if(!idempotency||!/^[A-Za-z0-9_-]{1,64}$/.test(idempotency))throw new ApiError(422,"IDEMPOTENCY_REQUIRED","Provide an Idempotency-Key of 1–64 letters, numbers, underscores or hyphens.");
 await rateLimit(store,"sandbox-visitor-submit:"+digest({scope:s.scope,visitorId:v.visitorId}),VISITOR_LIMIT);
 const candidate=buildBinding(s,card,v,idempotency,(body as {scenario:SandboxScenario}).scenario);
 await store.create("rate",candidate);let binding=(await store.get<Binding>("rate",candidate._id))!;
 if(binding.inputHash!==candidate.inputHash)throw new ApiError(409,"IDEMPOTENCY_CONFLICT","This visitor key already identifies a different sandbox scenario.");
 const prior=await store.get<Payment>("requests",binding.requestId);
 if(prior){if(prior.cardId!==card._id||prior.inputHash!==digest(binding.input))throw new ApiError(409,"SANDBOX_REQUEST_CONFLICT","The saved sandbox request does not match this operation.");const current=await fastBlocked(binding,card,prior);if(activeStatuses.includes(current.status))await ports.wake();return Response.json(admitted(binding,current),{status:202,headers:{"Cache-Control":"no-store"}});}
 const claimed=await store.claim<Binding>("rate",{_id:binding._id,inputHash:binding.inputHash},Date.now(),30000);
 if(!claimed)throw new ApiError(503,"SANDBOX_REQUEST_PENDING","This request is already being admitted. Retry the same visitor key.",undefined,5);
 try{
  if(claimed.slot===undefined){await rateLimit(store,"sandbox-global-submit:"+card._id,GLOBAL_PER_MINUTE);const visitorSlot=await allocate(store,"sandbox-visitor-slot:"+digest({scope:s.scope,visitorId:v.visitorId})+":",binding._id,VISITOR_LIMIT,new Date(v.expires)),slot=await allocate(store,"sandbox-global-slot:"+card._id+":",binding._id,s.maxRequests);
   await store.patch("rate",binding._id,{slot,visitorSlot});binding={...binding,slot,visitorSlot};}
  // Invoice content is immutable and bound to the request before any admission.
  const content=JSON.stringify(binding.invoice),saved=await store.get<Doc>("demoInvoices",binding.invoice.invoiceId);
  if(saved&&saved.content!==content)throw new ApiError(409,"SANDBOX_INVOICE_CONFLICT","The saved sandbox invoice has changed.");
  if(!saved&&!await store.create("demoInvoices",{_id:binding.invoice.invoiceId,content,createdAt:binding.createdAt})){const raced=await store.get<Doc>("demoInvoices",binding.invoice.invoiceId);if(raced?.content!==content)throw new ApiError(409,"SANDBOX_INVOICE_CONFLICT","The saved sandbox invoice has changed.");}
  const internal=new Request(configuration().origin+"/api/v1/requests",{method:"POST",headers:{"Content-Type":"application/json",Origin:configuration().origin,Authorization:"Bearer "+s.apiKey,"Idempotency-Key":binding.idempotency,"X-IntentGuard-Environment":"testnet"},body:JSON.stringify(binding.input)}),response=await ports.submit(internal);
  if(response.status!==202){
   // The public request owns its correlation ID. Returning a nested API error
   // response would retain its body ID while the outer route replaces its header.
   const error=await response.json().catch(()=>null),retry=Number(response.headers.get("Retry-After")??5);
   if(error?.error&&typeof error.error.code==="string"&&typeof error.error.message==="string")throw new ApiError(response.status,error.error.code,error.error.message,error.error.details,Number.isFinite(retry)?retry:5);
   throw new ApiError(503,"SANDBOX_ADMISSION_UNAVAILABLE","The payment pipeline is temporarily unavailable. Retry the same visitor key.",undefined,5);
  }
  const returned=await response.json(),payment=await store.get<Payment>("requests",binding.requestId);
  if(returned.id!==binding.requestId||!payment||payment.cardId!==card._id||payment.inputHash!==digest(binding.input))throw new ApiError(503,"SANDBOX_ADMISSION_UNVERIFIED","The payment pipeline did not persist the expected sandbox request. Retry the same visitor key.");
  await store.patch("requests",payment._id,{sandbox:true});
  return Response.json(admitted(binding,await fastBlocked(binding,card,payment)),{status:202,headers:{"Cache-Control":"no-store"}});
 }finally{await store.complete("rate",binding._id,claimed.leaseToken!,{updatedAt:Date.now()});}
};}
