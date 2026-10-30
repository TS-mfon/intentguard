import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {loadEnvFile} from "node:process";
import {readFile,writeFile,mkdir,rename,chmod} from "node:fs/promises";
import {randomBytes,createHash} from "node:crypto";
import {createPublicClient,createWalletClient,defineChain,http,parseAbi,encodeFunctionData,decodeEventLog,keccak256,parseTransaction,type Abi,type Address,type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import type {Hash as GLHash} from "genlayer-js/types";
import {canonical,digest,parseAmount,policySchema,validateDecision,type Policy,type PaymentInput,type RequestView,type CardView,type DraftResult,type CanonicalRequest,type Snapshot} from "../packages/shared";
import {GenLayer,assertFinalized,normalizedCalldata} from "../apps/web/lib/genlayer";
import {MemoryStore,database} from "../apps/web/lib/store";
import {Evm} from "../apps/web/lib/evm";
import type {Card,Draft,Payment} from "../apps/web/lib/models";
import exported from "../contracts/evm/abi.json";

const root=new URL("../",import.meta.url);
for(const file of [".local/testnet-secrets.env",".local/hosting.env"])loadEnvFile(new URL(file,root));
const base=(process.env.APP_URL??"").replace(/\/$/,"");
assert.equal(new URL(base).protocol,"https:","Hosted check requires HTTPS");
assert.equal(process.env.INTENTGUARD_MODE,"testnet");
assert.equal(Number(process.env.XLAYER_CHAIN_ID),1952);
const secretKey=process.env.XLAYER_OPERATOR_PRIVATE_KEY as Hex;
if(!/^0x[0-9a-fA-F]{64}$/.test(secretKey??""))throw Error("Owner test key missing or malformed");
const owner=privateKeyToAccount(secretKey),merchant=process.env.DEMO_MERCHANT_RECIPIENT as Address;
assert.match(merchant??"",/^0x[0-9a-fA-F]{40}$/,"Demo merchant recipient missing");
assert.notEqual(merchant.toLowerCase(),owner.address.toLowerCase(),"Merchant must be independent of owner");
const repo=process.env.INTENTGUARD_GITHUB_REPO??"TS-mfon/intentguard";
const statePath=new URL(".local/hosted-state.json",root),reportPath=new URL(".local/hosted-report.json",root);
type Invoice={invoiceId:string;buyer:string;token:string;chainId:number;recipient:string;amount:string;description:string;issuedAt:number;expiresAt:number};
type Case={attempt?:number;invoice?:Invoice;url?:string;input?:PaymentInput;idempotency?:string;id?:string;terminal?:RequestView};
type State={version:1;runId:string;base:string;owner:string;merchant:string;phase:string;startedAt:string;cookie?:string;apiKey?:string;guidance?:Policy;draftId?:string;draftHash?:string;draftResult?:DraftResult;cardAddress?:string;reviewerTx?:string;registered?:boolean;ownerTransactions:Record<string,{raw:Hex;hash:Hex;confirmed?:boolean}>;recipientBalanceBefore?:string;cases:Record<string,Case>;workerRuns:{id:number;url:string;status:string;conclusion?:string|null}[];pendingDispatchAt?:number;completedAt?:string;findings?:string[];lastError?:string;privateError?:string};
let state:State;
try{
 const saved=await readFile(statePath,"utf8");
 try{state=JSON.parse(saved) as State;}catch{throw Error("HOSTED_PRIVATE_STATE_INVALID_JSON");}
}catch(error){
 if((error as NodeJS.ErrnoException).code!=="ENOENT")throw Error("HOSTED_PRIVATE_STATE_UNREADABLE");
 state={version:1,runId:randomBytes(12).toString("hex"),base,owner:owner.address,merchant,phase:"INITIALIZED",startedAt:new Date().toISOString(),ownerTransactions:{},cases:{},workerRuns:[]};
}
if(!state||state.version!==1||state.base!==base||typeof state.runId!=="string"||typeof state.phase!=="string"||typeof state.startedAt!=="string"||typeof state.owner!=="string"||state.owner.toLowerCase()!==owner.address.toLowerCase()||typeof state.merchant!=="string"||state.merchant.toLowerCase()!==merchant.toLowerCase()||!state.ownerTransactions||typeof state.ownerTransactions!=="object"||!state.cases||typeof state.cases!=="object"||!Array.isArray(state.workerRuns))throw Error("HOSTED_PRIVATE_STATE_INVALID_OR_OTHER_DEPLOYMENT");
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
async function atomic(path:URL,value:unknown,privateFile=false){
 await mkdir(new URL(".local/",root),{recursive:true});const temp=new URL(path.href+".tmp");
 await writeFile(temp,JSON.stringify(value,null,2)+"\n",{mode:privateFile?0o600:0o644});
 if(privateFile)await chmod(temp,0o600);await rename(temp,path);if(privateFile)await chmod(path,0o600);
}
function publicReport(){
 return {mode:"REAL_HOSTED_TESTNET_ACCEPTANCE",appUrl:base,repository:"https://github.com/"+repo,chainId:1952,genLayerChainId:61999,runId:state.runId,phase:state.phase,startedAt:state.startedAt,completedAt:state.completedAt,owner:state.owner,merchant:state.merchant,draftId:state.draftId,draftTransaction:state.draftHash,cardAddress:state.cardAddress,reviewerTransaction:state.reviewerTx,ownerTransactions:Object.fromEntries(Object.entries(state.ownerTransactions).map(([id,tx])=>[id,{hash:tx.hash,confirmed:!!tx.confirmed}])),requests:Object.fromEntries(Object.entries(state.cases).map(([name,item])=>[name,{id:item.id,status:item.terminal?.status,requestHash:item.terminal?.requestHash,evidenceHash:item.terminal?.evidenceHash,guard:item.terminal?.guard,review:item.terminal?.review,genLayerTxHash:item.terminal?.genLayerTxHash,paymentTxHash:item.terminal?.paymentTxHash,invoiceUrl:item.url}])),workerRuns:state.workerRuns,findings:state.findings,lastError:state.lastError};
}
async function save(){await atomic(statePath,state,true);await atomic(reportPath,publicReport());}
async function phase(value:string,details:Record<string,unknown>={}){
 if(state.phase!==value){state.phase=value;delete state.lastError;await save();console.log(JSON.stringify({phase:value,...details}));}
}
class Failure extends Error{constructor(readonly code:string,readonly status?:number){super(code)}}
/** curl config, including authentication and JSON-RPC data, travels over stdin.
 * Neither secrets nor signed bytes appear in process arguments or diagnostics. */
async function curlFetch(request:Request):Promise<Response>{
 const body=request.method==="GET"||request.method==="HEAD"?"":await request.text();
 const lines=["url = "+JSON.stringify(request.url),"request = "+JSON.stringify(request.method)];
 request.headers.forEach((value,name)=>lines.push("header = "+JSON.stringify(name+": "+value)));
 if(body)lines.push("data-binary = "+JSON.stringify(body));
 return new Promise<Response>((resolve,reject)=>{
  const child=spawn("curl",["--config","-","--silent","--show-error","--compressed","--max-time","40","--dump-header","-","--write-out","\n%{http_code}"],{stdio:["pipe","pipe","pipe"]});
  const chunks:Buffer[]=[];let size=0;
  const abort=()=>child.kill("SIGTERM");request.signal.addEventListener("abort",abort,{once:true});
  child.stdout.on("data",chunk=>{size+=chunk.length;if(size>2097152)abort();else chunks.push(chunk)});
  child.stderr.resume();child.once("error",()=>reject(new Failure("TRANSPORT_START_FAILED")));
  child.once("close",code=>{
   request.signal.removeEventListener("abort",abort);
   if(code!==0)return reject(new Failure("TRANSPORT_FAILED"));
   const output=Buffer.concat(chunks).toString("utf8"),at=output.lastIndexOf("\n"),status=Number(output.slice(at+1));
   if(at<0||!Number.isInteger(status)||status<100||status>599)return reject(new Failure("TRANSPORT_INVALID_RESPONSE"));
   let payload=output.slice(0,at),final="",headerBytes=0;
   // curl writes proxy/interim/origin header blocks before the body. Capture all
   // bytes in memory: opening Node's extra stdio socket through /dev/fd fails.
   while(payload.startsWith("HTTP/")){
    const boundary=/\r?\n\r?\n/.exec(payload);
    if(!boundary)return reject(new Failure("TRANSPORT_INVALID_HEADERS"));
    headerBytes+=boundary.index+boundary[0].length;
    if(headerBytes>131072)return reject(new Failure("TRANSPORT_HEADERS_TOO_LARGE"));
    final=payload.slice(0,boundary.index);payload=payload.slice(boundary.index+boundary[0].length);
   }
   const responseHeaders=new Headers();
   for(const line of final.split(/\r?\n/).slice(1)){const colon=line.indexOf(":");if(colon>0)responseHeaders.append(line.slice(0,colon).trim(),line.slice(colon+1).trim());}
   resolve(new Response(status===204||status===304?null:payload,{status,headers:responseHeaders}));
  });
  child.stdin.on("error",()=>{});child.stdin.end(lines.join("\n")+"\n");
 });
}
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init),host=new URL(request.url).hostname;
 if([new URL(base).hostname,"testrpc.xlayer.tech","xlayertestrpc.okx.com","studio.genlayer.com"].includes(host))return curlFetch(request);
 return nativeFetch(input,init);
};
const chain=defineChain({id:1952,name:"X Layer Testnet",nativeCurrency:{name:"Test OKB",symbol:"OKB",decimals:18},rpcUrls:{default:{http:[process.env.XLAYER_RPC_URL!]}},testnet:true});
const transport=http(process.env.XLAYER_RPC_URL!,{timeout:45000,retryCount:0});
const pub=createPublicClient({chain,transport,cacheTime:0,pollingInterval:1500});
const wallet=createWalletClient({chain,transport,account:owner});
const token=process.env.PAYMENT_TOKEN as Address,factory=process.env.CARD_FACTORY_ADDRESS as Address;
const tokenAbi=parseAbi(["function mint(address to,uint256 amount)","function transfer(address to,uint256 amount) returns (bool)","function balanceOf(address account) view returns (uint256)"]);
const factoryAbi=exported.CardFactory as Abi,cardAbi=exported.AgentSpendingCard as Abi;
const deadline=Date.now()+Number(process.env.HOSTED_ACCEPTANCE_TIMEOUT_MS??5400000);
let githubCheckedAt=0,lastObservation="";
async function gh(args:string[]){
 return new Promise<string>((resolve,reject)=>{
  const child=spawn("gh",args,{cwd:root,stdio:["ignore","pipe","pipe"]});let output="",size=0;
  const timer=setTimeout(()=>child.kill("SIGTERM"),30000);
  child.stdout.on("data",chunk=>{size+=chunk.length;if(size>262144)child.kill("SIGTERM");else output+=chunk.toString()});child.stderr.resume();
  child.once("error",()=>{clearTimeout(timer);reject(new Failure("GITHUB_CLI_START_FAILED"))});
  child.once("close",code=>{clearTimeout(timer);if(code!==0)reject(new Failure("GITHUB_CLI_FAILED"));else resolve(output)});
 });
}
async function ensureWorker(){
 if(Date.now()-githubCheckedAt<15000)return;githubCheckedAt=Date.now();
 const rows=JSON.parse(await gh(["run","list","--repo",repo,"--workflow","worker.yml","--limit","10","--json","databaseId,status,conclusion,url,createdAt"])) as {databaseId:number;status:string;conclusion:string|null;url:string;createdAt:string}[];
 for(const old of state.workerRuns){const found=rows.find(row=>row.databaseId===old.id);if(found){old.status=found.status;old.conclusion=found.conclusion;}}
 const active=rows.find(row=>["queued","in_progress","waiting","requested","pending"].includes(row.status));
 if(active){if(!state.workerRuns.some(row=>row.id===active.databaseId)){state.workerRuns.push({id:active.databaseId,url:active.url,status:active.status,conclusion:active.conclusion});console.log(JSON.stringify({phase:state.phase,workerRun:active.url,status:active.status}));}delete state.pendingDispatchAt;await save();return;}
 if(state.pendingDispatchAt&&Date.now()-state.pendingDispatchAt<60000){await save();return;}
 state.pendingDispatchAt=Date.now();await save();
 await gh(["workflow","run","worker.yml","--repo",repo,"-f","duration_seconds=240"]);
 console.log(JSON.stringify({phase:state.phase,worker:"burst requested",durationSeconds:240}));await save();
}
async function rawApi(path:string,{method="GET",body,ownerSession=false,agent=false,admin=false}:{method?:string;body?:unknown;ownerSession?:boolean;agent?:boolean;admin?:boolean}={}){
 const headers:Record<string,string>={"Content-Type":"application/json",Origin:base};
 if(ownerSession&&state.cookie)headers.Cookie=state.cookie;
 if(agent){if(!state.apiKey)throw new Failure("AGENT_KEY_MISSING");headers.Authorization="Bearer "+state.apiKey;}
 if(admin){if(!process.env.DEMO_MERCHANT_ADMIN_KEY)throw new Failure("DEMO_ADMIN_MISSING");headers.Authorization="Bearer "+process.env.DEMO_MERCHANT_ADMIN_KEY;}
 const response=await fetch(base+"/api/v1"+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 let value:unknown=null;if(response.status!==204){try{value=await response.json()}catch{throw new Failure("HOSTED_API_NON_JSON",response.status)}}
 return {response,value};
}
async function authenticate(force=false){
 if(state.cookie&&!force){const checked=await rawApi("/auth/session",{ownerSession:true});if(checked.response.ok&&(checked.value as {address?:string}).address?.toLowerCase()===owner.address.toLowerCase())return;}
 const challenged=await rawApi("/auth/challenge",{method:"POST",body:{address:owner.address}});
 if(!challenged.response.ok)throw new Failure((challenged.value as {error?:{code?:string}})?.error?.code??"LOGIN_CHALLENGE_FAILED",challenged.response.status);
 const message=(challenged.value as {message:string}).message;assert.ok(message.includes("Chain ID: 1952"),"Hosted challenge uses wrong chain");
 const signature=await owner.signMessage({message});
 const logged=await rawApi("/auth/login",{method:"POST",body:{address:owner.address,signature}});
 if(!logged.response.ok)throw new Failure("OWNER_LOGIN_FAILED",logged.response.status);
 const cookie=logged.response.headers.get("set-cookie")?.split(";")[0];assert.ok(cookie?.startsWith("ig_session="),"Missing owner session cookie");
 state.cookie=cookie;await save();
}
async function api<T>(path:string,options:Parameters<typeof rawApi>[1]={}):Promise<T>{
 let result=await rawApi(path,options);
 if(options?.ownerSession&&result.response.status===401){await authenticate(true);result=await rawApi(path,options);}
 if(!result.response.ok)throw new Failure((result.value as {error?:{code?:string}})?.error?.code??"HOSTED_API_FAILED",result.response.status);
 return result.value as T;
}
function transient(error:unknown){return error instanceof Failure&&(error.code==="TRANSPORT_FAILED"||[408,429,502,503,504].includes(error.status??0));}
async function poll<T>(name:string,read:()=>Promise<T>,done:(value:T)=>boolean,describe:(value:T)=>string){
 let retries=0;
 while(Date.now()<deadline){
  let value:T;
  try{value=await read();retries=0;}
  catch(error){
   if(!transient(error))throw error;
   retries++;console.log(JSON.stringify({phase:state.phase,observation:name+": temporary API failure; journal preserved",retry:retries,error:(error as Failure).code}));
   await ensureWorker();await pause(Math.min(30000,5000*retries));continue;
  }
  const observation=name+": "+describe(value);
  if(observation!==lastObservation){lastObservation=observation;console.log(JSON.stringify({phase:state.phase,observation}));}
  if(done(value))return value;
  await ensureWorker();await pause(5000);
 }
 throw new Failure("HOSTED_ACCEPTANCE_TIMEOUT");
}
async function ownerTransaction(id:string,address:Address,abi:Abi,method:string,args:unknown[]){
 assert.equal(await pub.getChainId(),1952);
 const data=encodeFunctionData({abi,functionName:method,args});let saved=state.ownerTransactions[id];
 if(saved){
  const signed=parseTransaction(saved.raw);assert.equal(signed.to?.toLowerCase(),address.toLowerCase());assert.equal(signed.data?.toLowerCase(),data.toLowerCase());assert.equal(signed.chainId,1952);
 }else{
  const [latest,pending]=await Promise.all(["latest","pending"].map(blockTag=>pub.getTransactionCount({address:owner.address,blockTag:blockTag as "latest"|"pending"})));
  const prepared=await wallet.prepareTransactionRequest({to:address,data,nonce:Math.max(latest,pending)});
  prepared.gas=prepared.gas*125n/100n+50000n;
  const raw=await wallet.signTransaction(prepared);saved={raw,hash:keccak256(raw)};state.ownerTransactions[id]=saved;await save();
 }
 let receipt=await pub.getTransactionReceipt({hash:saved.hash}).catch(()=>null);
 if(!receipt){
  const nonce=parseTransaction(saved.raw).nonce,latest=await pub.getTransactionCount({address:owner.address,blockTag:"latest"});
  if(nonce!==undefined&&latest>nonce)throw new Failure("OWNER_NONCE_CONSUMED_WITHOUT_RECEIPT");
  await wallet.sendRawTransaction({serializedTransaction:saved.raw}).catch(async()=>{if(!await pub.getTransaction({hash:saved.hash}).catch(()=>null))throw new Failure("OWNER_TRANSACTION_SUBMISSION_FAILED")});
 }
 receipt=await pub.waitForTransactionReceipt({hash:saved.hash,confirmations:2,timeout:180000,pollingInterval:1500});
 assert.equal(receipt.status,"success","Owner testnet transaction reverted");saved.confirmed=true;await save();
 console.log(JSON.stringify({phase:state.phase,ownerOperation:id,transactionHash:saved.hash}));return receipt;
}
async function checkProtocol(){
 assert.equal(await pub.getChainId(),1952);
 const config=await api<{mode:string;chainId:number;token:string;factoryAddress:string;configured:boolean}>("/config");
 assert.equal(config.mode,"testnet");assert.equal(config.chainId,1952);assert.equal(config.configured,true,"Hosted service is unconfigured");
 assert.equal(config.token.toLowerCase(),token.toLowerCase());assert.equal(config.factoryAddress.toLowerCase(),factory.toLowerCase());
 const legacy=JSON.parse(await readFile(new URL("docs/deployments/testnet.json",root),"utf8"));
 const replacement=JSON.parse(await readFile(new URL("docs/production/interpreter-v2-deployment.json",root),"utf8"));
 const v2=process.env.GENLAYER_INTERPRETER_ADDRESS!.toLowerCase()===replacement.interpreterAddress.toLowerCase();
 const manifest=v2?{interpreterTx:replacement.deploymentTransaction,interpreter:replacement.interpreterAddress}:legacy;
 const source=await readFile(new URL(v2?replacement.sourceFile:"contracts/genlayer/permission_interpreter.py",root),"utf8");
 if(v2){assert.equal(replacement.reviewChainId,61999);assert.equal(replacement.paymentChainId,1952);assert.equal(createHash("sha256").update(source).digest("hex"),replacement.sourceSha256);}
 const gl=new GenLayer(new MemoryStore());assert.equal(await gl.client.getChainId(),61999);
 const tx=await gl.client.getTransaction({hash:manifest.interpreterTx});assertFinalized(tx);
 const decoded=tx.txDataDecoded;assert.ok(decoded&&decoded.type==="deploy"&&"contractAddress"in decoded);
 assert.equal(decoded.code,source);
 const args=normalizedCalldata(decoded.constructorArgs) as {args?:unknown[]};assert.equal(canonical(args.args),canonical([owner.address.toLowerCase()]));
 assert.equal(decoded.contractAddress?.toLowerCase(),process.env.GENLAYER_INTERPRETER_ADDRESS!.toLowerCase());
 if(v2)assert.equal(Number(await gl.read(manifest.interpreter,"get_version")),2);
}
function makeGuidance():Policy{
 const now=Math.floor(Date.now()/1000);
 return policySchema.parse({version:1,name:"Hosted Research Agent "+state.runId.slice(0,6),mission:"Purchase verified protocol revenue research data from the approved research-data merchant.",taskContext:"Testnet-only end-to-end verification of controlled research spending.",allowedCategories:["data"],prohibitedPurchases:["Personal entertainment and purchases unrelated to research."],exceptions:[],financial:{totalBudget:"10",perPaymentLimit:"5",periodBudget:"10",periodSeconds:86400,validFrom:now-60,validUntil:now+2*86400},merchants:[{name:"IntentGuard research-data merchant",recipient:merchant,origins:[base],products:["Protocol revenue research datasets"]}],evidence:{requiredTypes:["invoice"],approvedOrigins:[base],maxAgeSeconds:86400},criteria:[{id:"research-invoice",description:"The public merchant invoice must match the buyer card, payment chain, token, recipient and exact amount, and its described research data must directly support the assigned mission. Personal entertainment is prohibited."}]});
}
const description="Create a testnet spending permission for this research agent. It may buy protocol revenue research data only from the specified research-data merchant. Preserve all supplied structured guidance exactly. The total budget is 10 USDT, maximum 5 USDT per payment, and 10 USDT per 86400-second period. Personal entertainment and purchases unrelated to research are prohibited. Require an exact matching public merchant invoice and evidence that the purchase directly supports the research mission.";
async function draftAndCard(){
 await phase("OWNER_AUTHENTICATION");await authenticate();
 if(!state.guidance){state.guidance=makeGuidance();await save();}
 if(!state.draftId){
  await phase("GENLAYER_DRAFT_SUBMISSION");
  const result=await api<{id:string}>("/owner/drafts",{method:"POST",ownerSession:true,body:{description,guidance:state.guidance}});state.draftId=result.id;await save();
 }
 await phase("GENLAYER_DRAFT_FINALITY",{draftId:state.draftId});
 const proposed=await poll("draft",()=>api<{id:string;state:string;status:string;policy:Policy|null;questions:string[];interpretation:string;genLayerTxHash?:string;activation?:{factoryAddress:string;config:Record<string,unknown>}}>("/owner/drafts/"+state.draftId,{ownerSession:true}),value=>value.state==="FINALIZED",value=>value.state+"/"+value.status);
 if(proposed.status!=="PROPOSED"||!proposed.policy||!proposed.activation)throw new Failure("DRAFT_NEEDS_CLARIFICATION");
 const input={description,guidance:state.guidance};
 const persisted=await database(),draft=await persisted.get<Draft>("drafts",state.draftId!);
 assert.ok(draft,"Hosted draft must exist in the verified testnet database");
 assert.equal(draft.owner,owner.address.toLowerCase());assert.equal(draft.inputHash,digest(input));
 assert.equal(canonical(draft.input),canonical(input));assert.equal(draft.genLayerTxHash,proposed.genLayerTxHash);
 assert.equal(draft.state,"FINALIZED");
 const gl=new GenLayer(persisted),verified=await gl.draft(draft);
 assert.equal(canonical(verified.policy),canonical(proposed.policy),"Hosted proposed policy differs from finalized consensus");
 for(const key of ["totalBudget","perPaymentLimit","periodBudget"] as const)assert.equal(parseAmount(proposed.policy.financial[key]),parseAmount(state.guidance.financial[key]),"Proposal changed financial permissions: "+key);
 for(const key of ["periodSeconds","validFrom","validUntil"] as const)assert.equal(proposed.policy.financial[key],state.guidance.financial[key],"Proposal changed financial permissions: "+key);
 assert.equal(canonical(proposed.policy.merchants),canonical(state.guidance.merchants),"Proposal changed merchant permissions");
 assert.deepEqual(proposed.policy.allowedCategories,["data"]);assert.equal(canonical(proposed.policy.prohibitedPurchases),canonical(state.guidance.prohibitedPurchases));
 state.draftHash=proposed.genLayerTxHash;state.draftResult=verified;await save();
 await phase("OWNER_CARD_ACTIVATION");
 const tuple=Object.fromEntries(exported.configTuple.components.map(component=>{const value=proposed.activation!.config[component.name];assert.notEqual(value,undefined);return [component.name,component.type.startsWith("uint")?BigInt(String(value)):value]}));
 assert.equal(String(tuple.owner).toLowerCase(),owner.address.toLowerCase());assert.equal(String(tuple.token).toLowerCase(),token.toLowerCase());
 const receipt=await ownerTransaction("activate",factory,factoryAbi,"createCard",[tuple]);
 let cardAddress:string|undefined;
 for(const log of receipt.logs){if(log.address.toLowerCase()!==factory.toLowerCase())continue;try{const decoded=decodeEventLog({abi:factoryAbi,data:log.data,topics:log.topics});if(decoded.eventName==="CardCreated"){const values=decoded.args as unknown as {owner:string;card:string;policyHash:string};if(values.owner.toLowerCase()===owner.address.toLowerCase()&&values.policyHash.toLowerCase()===digest(proposed.policy))cardAddress=values.card;}}catch{}}
 assert.ok(cardAddress,"Missing matching card creation event");
 if(state.cardAddress)assert.equal(state.cardAddress.toLowerCase(),cardAddress.toLowerCase());state.cardAddress=cardAddress;await save();
 if(!state.registered){await api("/owner/cards",{method:"POST",ownerSession:true,body:{draftId:state.draftId,cardAddress,activationTx:receipt.transactionHash}});state.registered=true;await save();}
 await phase("OWNER_CARD_FUNDING");
 await ownerTransaction("faucet",token,tokenAbi,"mint",[owner.address,parseAmount("10")]);
 await ownerTransaction("fund",token,tokenAbi,"transfer",[cardAddress,parseAmount("10")]);
 await phase("GENLAYER_REVIEWER_FINALITY");
 const ready=await poll("reviewer",()=>api<{cards:(CardView&{reviewerTx?:string})[]}>("/owner/cards",{ownerSession:true}),value=>!!value.cards.find(item=>item.id===state.draftId)?.reviewerAddress,value=>value.cards.find(item=>item.id===state.draftId)?.reviewerAddress?"READY":"SETTING_UP");
 const view=ready.cards.find(item=>item.id===state.draftId);assert.ok(view?.reviewerAddress);assert.equal(view.address.toLowerCase(),cardAddress.toLowerCase());
 assert.equal(canonical(view.policy),canonical(proposed.policy));assert.equal(view.policyHash,digest(proposed.policy));assert.equal(view.chainId,1952);assert.equal(view.token.toLowerCase(),token.toLowerCase());
 const reviewerTx=view.reviewerTx??state.reviewerTx??process.env.HOSTED_REVIEWER_DEPLOYMENT_TX;
 if(!reviewerTx||!/^0x[0-9a-fA-F]{64}$/.test(reviewerTx))throw new Failure("REVIEWER_DEPLOYMENT_PROVENANCE_MISSING");
 state.reviewerTx=reviewerTx;await save();
 const card:Card={_id:state.draftId!,owner:owner.address.toLowerCase(),draftId:state.draftId!,address:view.address.toLowerCase(),activationTx:receipt.transactionHash,activationBlock:receipt.blockNumber.toString(),policy:view.policy,policyHash:view.policyHash,reviewerAddress:view.reviewerAddress,reviewerTx,state:"READY",keyStatus:view.keyStatus,chainId:1952,token,createdAt:0,updatedAt:0};
 const verifiedReviewer=await gl.reviewer(card);assert.equal(verifiedReviewer.toLowerCase(),card.reviewerAddress!.toLowerCase());
 if(!state.apiKey){await phase("AGENT_KEY_ISSUANCE");const result=await api<{apiKey:string}>("/owner/cards/"+state.draftId+"/keys",{method:"POST",ownerSession:true});assert.match(result.apiKey,/^ig_/);state.apiKey=result.apiKey;await save();}
 const me=await api<{card:CardView}>("/me",{agent:true});assert.equal(me.card.id,state.draftId);assert.equal(me.card.address.toLowerCase(),cardAddress.toLowerCase());
 if(state.recipientBalanceBefore===undefined){state.recipientBalanceBefore=(await pub.readContract({address:token,abi:tokenAbi,functionName:"balanceOf",args:[merchant]})).toString();await save();}
 return card;
}
async function scenario(name:string,amount:string,purchaseDescription:string,justification:string,expected:string){
 let item=state.cases[name];if(!item){item={};state.cases[name]=item;await save();}
 if(!item.invoice){
  const result=await api<{invoice:Invoice;url:string}>("/demo/invoices",{method:"POST",admin:true,body:{buyer:state.cardAddress,amount,description:purchaseDescription}});
  assert.equal(result.invoice.chainId,1952);assert.equal(result.invoice.token.toLowerCase(),token.toLowerCase());assert.equal(result.invoice.recipient.toLowerCase(),merchant.toLowerCase());assert.equal(result.invoice.buyer.toLowerCase(),state.cardAddress!.toLowerCase());
  item.invoice=result.invoice;item.url=result.url;await save();
 }
 if(!item.input){
  item.input={recipient:merchant,amount,purchaseDescription,justification,category:"data",invoiceId:item.invoice.invoiceId,evidence:[{url:item.url!}]};
  item.idempotency="hosted-"+state.runId+"-"+name+(item.attempt?"-attempt"+item.attempt:"");item.id=digest({cardId:state.draftId,idempotency:item.idempotency});await save();
 }
 const response=await fetch(base+"/api/v1/requests",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+state.apiKey,"Idempotency-Key":item.idempotency!},body:JSON.stringify(item.input)});
 const admitted=await response.json() as {id?:string;error?:{code?:string}};
 if(!response.ok)throw new Failure(admitted.error?.code??"AGENT_SUBMISSION_FAILED",response.status);assert.equal(admitted.id,item.id);
 const result=await poll(name,()=>api<RequestView>("/requests/"+item.id,{agent:true}),value=>["PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","EXPIRED","CANCELLED"].includes(value.status),value=>value.status);
 item.terminal=result;await save();assert.equal(result.status,expected,"Unexpected terminal result for "+name);return result;
}
async function verifyPayment(card:Card,view:RequestView,expected:"APPROVE"|"REJECT"){
 assert.ok(view.genLayerTxHash&&view.review&&view.requestHash&&view.evidenceHash);
 const gl=new GenLayer(new MemoryStore()),tx=await gl.client.getTransaction({hash:view.genLayerTxHash as GLHash});assertFinalized(tx);
 const decoded=tx.txDataDecoded;assert.ok(decoded&&decoded.type==="call"&&"callData"in decoded);
 const call=normalizedCalldata(decoded.callData) as {method?:string;args?:unknown[]};assert.equal(call.method,"review");assert.equal(call.args?.length,3);assert.equal(call.args?.[0],view.id);
 assert.equal(typeof call.args?.[1],"string");assert.equal(typeof call.args?.[2],"string");
 const committed=JSON.parse(call.args![1] as string) as CanonicalRequest,snapshots=JSON.parse(call.args![2] as string) as Snapshot[];
 assert.equal(canonical(committed),call.args![1]);assert.equal(canonical(snapshots),call.args![2]);
 const local=Object.values(state.cases).find(item=>item.id===view.id);assert.ok(local?.input&&local.invoice&&local.url);assert.equal(canonical(view.request),canonical(local.input));
 const bound={...local.input,cardId:card._id,cardAddress:card.address,owner:card.owner,policyHash:card.policyHash,token:token.toLowerCase(),chainId:1952,amountAtomic:parseAmount(local.input.amount).toString(),evidenceHash:view.evidenceHash,expiresAt:committed.expiresAt};
 assert.equal(canonical(committed),canonical(bound),"GenLayer input differs from the owner's actual payment input");
 assert.equal(digest(committed),view.requestHash);assert.equal(digest(snapshots),view.evidenceHash);assert.equal(snapshots.length,1);assert.equal(snapshots[0].url,local.url);
 assert.equal(canonical(JSON.parse(snapshots[0].content)),canonical(local.invoice));assert.ok(committed.expiresAt<=local.invoice.expiresAt&&committed.expiresAt<=card.policy.financial.validUntil);
 const payment:Payment={_id:view.id,owner:card.owner,cardId:card._id,keyId:"hosted-acceptance",input:local.input,inputHash:digest(local.input),canonical:committed,snapshots,requestHash:view.requestHash,evidenceHash:view.evidenceHash,review:view.review,genLayerTxHash:view.genLayerTxHash,status:view.status,createdAt:view.createdAt,updatedAt:view.updatedAt};
 const review=validateDecision(await gl.decision(card,payment),card.policy,committed,view.requestHash);
 assert.equal(review.decision,expected);assert.equal(canonical(review),canonical(view.review),"Portal review differs from finalized consensus");
 const reservation=await new Evm(new MemoryStore()).request(card,view.id);assert.equal(reservation.requestHash,view.requestHash);assert.equal(reservation.evidenceHash,view.evidenceHash);assert.equal(reservation.recipient.toLowerCase(),merchant.toLowerCase());assert.equal(reservation.amount,parseAmount(local.input.amount));
 if(expected==="APPROVE"){
  assert.ok(view.paymentTxHash);const receipt=await pub.waitForTransactionReceipt({hash:view.paymentTxHash as Hex,confirmations:2,timeout:90000});assert.equal(receipt.status,"success");
  const paid=receipt.logs.some(log=>{if(log.address.toLowerCase()!==card.address.toLowerCase())return false;try{const event=decodeEventLog({abi:cardAbi,data:log.data,topics:log.topics});const values=event.args as unknown as {requestId:string;recipient:string;amount:bigint};return event.eventName==="Paid"&&values.requestId.toLowerCase()===view.id.toLowerCase()&&values.recipient.toLowerCase()===merchant.toLowerCase()&&values.amount===parseAmount("1")}catch{return false}});
  assert.ok(paid,"Receipt has no exact matching merchant payment");
 }
}
async function retryApproved(){
 const prior=state.cases.approved;assert.ok(prior?.id&&state.cardAddress&&state.apiKey);
 const latest=await api<RequestView>("/requests/"+prior.id,{agent:true});
 assert.equal(latest.status,"NEEDS_EVIDENCE");assert.equal(latest.genLayerTxHash,undefined);assert.equal(latest.paymentTxHash,undefined);assert.ok(!latest.requestHash&&!latest.evidenceHash);
 const request=await pub.readContract({address:state.cardAddress as Address,abi:cardAbi,functionName:"getRequest",args:[prior.id]}) as {status:number};assert.equal(request.status,0,"Earlier attempt has an onchain reservation");
 assert.equal(await pub.readContract({address:token,abi:tokenAbi,functionName:"balanceOf",args:[merchant]}),BigInt(state.recipientBalanceBefore!),"Merchant balance changed before replacement");
 prior.terminal=latest;const attempt=(prior.attempt??1)+1,archive="approved_evidence_attempt"+(attempt-1);assert.equal(state.cases[archive],undefined);
 state.cases[archive]=prior;state.cases.approved={attempt};await save();console.log(JSON.stringify({phase:state.phase,preservedRequest:prior.id,replacementAttempt:attempt}));
}
async function run(){
 await phase("HOSTED_PROTOCOL_VERIFICATION");await checkProtocol();
 const card=await draftAndCard();
 await phase("APPROVED_PURCHASE");
 const approved=await scenario("approved","1","Verified protocol revenue research dataset for the approved research mission.","Necessary protocol revenue evidence for the approved research comparison.","PAID");
 await verifyPayment(card,approved,"APPROVE");
 const before=BigInt(state.recipientBalanceBefore!),balance=()=>pub.readContract({address:token,abi:tokenAbi,functionName:"balanceOf",args:[merchant]});
 assert.equal((await balance())-before,parseAmount("1"));
 await phase("CIRCUIT_BUDGET_REJECTION");
 const blocked=await scenario("budget","6","A larger protocol revenue research dataset.","Research dataset exceeds the per-payment maximum.","BLOCKED");
 assert.ok(blocked.guard?.failures.includes("Payment limit"));assert.equal(blocked.genLayerTxHash,undefined);assert.equal(blocked.paymentTxHash,undefined);
 assert.equal((await new Evm(new MemoryStore()).request(card,blocked.id)).status,0,"Blocked request obtained a reservation");
 await phase("GENLAYER_SEMANTIC_REJECTION");
 const rejected=await scenario("semantic","1","Personal entertainment movie-streaming subscription unrelated to protocol research.","I want personal entertainment; this purchase does not support the assigned research mission.","REJECTED");
 await verifyPayment(card,rejected,"REJECT");assert.equal(rejected.paymentTxHash,undefined);
 await phase("IDEMPOTENCY_AND_LEDGER_VERIFICATION");
 const original=state.cases.approved;
 const retry=await fetch(base+"/api/v1/requests",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+state.apiKey,"Idempotency-Key":original.idempotency!},body:JSON.stringify(original.input)});
 assert.equal(retry.status,202);assert.equal((await retry.json()).id,approved.id);
 assert.equal((await balance())-before,parseAmount("1"));
 const me=await api<{card:CardView}>("/me",{agent:true});assert.equal(me.card.balances.spent,"1");assert.equal(me.card.balances.reserved,"0");assert.equal(me.card.balances.available,"9");
 const evm=new Evm(new MemoryStore());assert.equal((await evm.request(card,approved.id)).status,2);assert.equal((await evm.request(card,rejected.id)).status,3);
 const ownerLedger=await api<{requests:RequestView[]}>("/owner/requests",{ownerSession:true});assert.ok(Object.values(state.cases).filter(item=>item.id).every(item=>ownerLedger.requests.some(row=>row.id===item.id)));
 await phase("PUBLIC_EXPLORER_REASONING_VERIFICATION");
 for(const view of [approved,rejected]){
  const publicView=await api<{transaction:{id:string;status:string;review?:RequestView["review"]};reasoningSource:string}>("/explorer/transactions/"+view.id);
  assert.equal(publicView.transaction.id,view.id);assert.equal(publicView.transaction.status,view.status);assert.equal(publicView.reasoningSource,"genlayer-finalized-contract");assert.equal(canonical(publicView.transaction.review),canonical(view.review));
 }
 state.completedAt=new Date().toISOString();state.findings=["Real finalized GenLayer policy interpretation verified.","Owner funded testnet vault through signed transactions.","Per-card reviewer code, constructor, policy and network verified.","Actual one-token merchant payment, exact Paid event and balance delta verified.","Six-token request blocked by genuine NAND spending circuit before review.","Personal entertainment request rejected by finalized GenLayer review; reservation cancelled.","Identical retry reused its original request and created no duplicate payout.","GitHub Actions alone processed durable jobs; spent1/reserved0/available9.","Public explorer reasoning matches the actual finalized GenLayer contract decisions."];if(Object.keys(state.cases).some(name=>name.startsWith("approved_evidence_attempt")))state.findings.push("The earlier unreserved NEEDS_EVIDENCE attempt is preserved in the ledger; its replacement used a new idempotency key and fresh invoice.");
 await phase("COMPLETE");await save();console.log("HOSTED_END_TO_END_ACCEPTANCE_PASSED");console.log(JSON.stringify(publicReport(),null,2));
}
const command=process.argv[2]??"--check";
if(command==="--status"){console.log(JSON.stringify(publicReport(),null,2));}
else if(command==="--check"){assert.ok(process.env.DEMO_MERCHANT_ADMIN_KEY);assert.ok(process.env.MONGODB_URI);console.log("HOSTED_DRIVER_CONFIGURATION_READY");}
else if(command==="--run"||command==="--retry-approved"){
 try{if(command==="--retry-approved")await retryApproved();await run();process.exit(0);}
 catch(error){state.privateError=error instanceof Error?error.stack??error.message:String(error);state.lastError=error instanceof Failure?error.code+(error.status?" HTTP"+error.status:""):error instanceof assert.AssertionError?"ACCEPTANCE_ASSERTION_FAILED":"HOSTED_RUNTIME_FAILED";await save();console.error(JSON.stringify({phase:state.phase,error:state.lastError,report:".local/hosted-report.json",state:".local/hosted-state.json"}));process.exit(1);}
}else throw new Failure("Use --check, --status, --run or --retry-approved");
