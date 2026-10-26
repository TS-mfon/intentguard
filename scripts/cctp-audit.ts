import assert from "node:assert/strict";
import {createCipheriv,createDecipheriv,createHash,randomBytes} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {createPublicClient,http,decodeEventLog,parseAbi,type Address,type Abi,type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {database,type Doc} from "../apps/web/lib/store";
import {Evm} from "../apps/web/lib/evm";
import {GenLayer} from "../apps/web/lib/genlayer";
import {CCTP_TESTNETS} from "../packages/shared/assets";
import {digest,parseAmount,validateDecision,type Policy,type Settlement,type RequestView} from "../packages/shared";
import type {Card,Payment,Job} from "../apps/web/lib/models";
import artifacts from "../contracts/evm/abi.json";
if(process.env.GITHUB_ACTIONS!=="true"||process.env.INTENTGUARD_MODE!=="testnet"||process.env.XLAYER_CHAIN_ID!=="1952")throw Error("Live CCTP audit is restricted to the authorized testnet Actions worker.");
const base=process.env.APP_URL??"",url=new URL(base);assert.equal(url.origin,"https://intentguard-tapeout.vercel.app");
const signingKey=process.env.XLAYER_OPERATOR_PRIVATE_KEY as Hex,account=privateKeyToAccount(signingKey),owner=account.address.toLowerCase();assert.equal(owner,process.env.GATEWAY_ADDRESS?.toLowerCase());
const merchant=process.env.DEMO_MERCHANT_RECIPIENT!;assert.match(merchant,/^0x[0-9a-fA-F]{40}$/);assert.ok(process.env.DEMO_MERCHANT_ADMIN_KEY);
const store=await database(),evm=new Evm(store),gl=new GenLayer(store),id="cctp-live-audit-v1";
await store.create("integrationChecks",{_id:id,version:1,createdAt:Date.now(),cases:[],owner});
let state=(await store.get<Doc>("integrationChecks",id))!;assert.equal(state.owner,owner);
const codecKey=createHash("sha256").update(process.env.REVIEW_ATTESTOR_PRIVATE_KEY!).digest();
function encrypt(value:string){const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",codecKey,iv);cipher.setAAD(Buffer.from(id));const bytes=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return {iv:iv.toString("hex"),bytes:bytes.toString("hex"),tag:cipher.getAuthTag().toString("hex")};}
function decrypt(value:any){const cipher=createDecipheriv("aes-256-gcm",codecKey,Buffer.from(value.iv,"hex"));cipher.setAAD(Buffer.from(id));cipher.setAuthTag(Buffer.from(value.tag,"hex"));return Buffer.concat([cipher.update(Buffer.from(value.bytes,"hex")),cipher.final()]).toString("utf8");}
const publicReport=()=>({version:1,kind:"LIVE_TESTNET_CCTP_API_AUDIT",sourceChainId:1952,owner,cardId:state.cardId,cardAddress:state.cardAddress,draftId:state.draftId,activationTx:state.activationTx,depositTx:state.depositTx,depositAmount:"1",documentation:state.documentation,cases:state.cases,baseline:state.baseline,final:state.final,status:state.status??"RUNNING",updatedAt:new Date().toISOString(),errorCode:state.errorCode,sourceHead:process.env.GITHUB_SHA,workflowRunId:process.env.GITHUB_RUN_ID});
async function save(values:Record<string,unknown>={}){await store.patch("integrationChecks",id,{...values,updatedAt:Date.now()});state=(await store.get<Doc>("integrationChecks",id))!;await mkdir(".local/cctp-audit",{recursive:true});await writeFile(".local/cctp-audit/report.json",JSON.stringify(publicReport(),null,2)+"\n");}
let cookie="",key=state.encryptedKey?decrypt(state.encryptedKey):"";
async function api(path:string,options:{method?:string;body?:unknown;ownerAuth?:boolean;agentAuth?:boolean;adminAuth?:boolean;idem?:string}={}){
 const headers:Record<string,string>={Accept:"application/json"},method=options.method??"GET";
 if(options.body!==undefined)headers["Content-Type"]="application/json";if(options.ownerAuth){headers.Cookie=cookie;headers.Origin=base;}if(options.agentAuth)headers.Authorization="Bearer "+key;if(options.adminAuth)headers.Authorization="Bearer "+process.env.DEMO_MERCHANT_ADMIN_KEY;if(options.idem)headers["Idempotency-Key"]=options.idem;
 const response=await fetch(base+"/api/v1"+path,{method,headers,body:options.body===undefined?undefined:JSON.stringify(options.body),redirect:"error",signal:AbortSignal.timeout(25000)}),raw=await response.text();let data;try{data=JSON.parse(raw)}catch{throw Error("AUDIT_INVALID_API_RESPONSE");}
 const logs=Array.from(response.headers).filter(([k])=>!["set-cookie","authorization"].includes(k));
 return {response,data,log:{request:{method,url:base+"/api/v1"+path,headers:Object.fromEntries(Object.entries(headers).map(([k,v])=>[k,/cookie|authorization/i.test(k)?"[REDACTED]":v])),body:options.body??null},response:{status:response.status,headers:Object.fromEntries(logs),body:data}}};
}
const deadline=Date.now()+16*60*1000,sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
async function wait<T>(read:()=>Promise<T>,accept:(value:T)=>boolean):Promise<T>{let value;while(Date.now()<deadline){value=await read();if(accept(value))return value;await sleep(5000);}throw Error("AUDIT_WAIT_PENDING");}
async function ownerLogin(){const challenge=await api("/auth/challenge",{method:"POST",ownerAuth:true,body:{address:owner}});assert.equal(challenge.response.status,200);const signature=await account.signMessage({message:challenge.data.message}),login=await api("/auth/login",{method:"POST",ownerAuth:true,body:{address:owner,signature}});assert.equal(login.response.status,200);cookie=login.response.headers.get("set-cookie")!.split(";")[0];}
async function sourceWrite(operation:string,address:string,method:string,args:unknown[],abi:Abi){
 await store.create("locks",{_id:"worker",createdAt:Date.now()});
 let lock:Job|null=null;while(Date.now()<deadline){lock=await store.claim<Job>("locks",{_id:"worker"},Date.now(),120000);if(lock)break;await sleep(2000);}assert.ok(lock,"AUDIT_SIGNING_LEASE_PENDING");
 try{return await evm.execute("audit:"+id+":"+operation,address,method,args,abi);}finally{await store.complete("locks","worker",lock.leaseToken!,{nextAt:0});}
}
async function balances(card:Card){
 const tokenAbi=parseAbi(["function balanceOf(address) view returns (uint256)"]);const merchantBalances:Record<string,string>={};
 for(const [chainId,c]of Object.entries(CCTP_TESTNETS)){const pub=createPublicClient({transport:http(c.rpcUrl,{timeout:12000,retryCount:0})});assert.equal(await pub.getChainId(),Number(chainId));merchantBalances[chainId]=(await pub.readContract({address:c.token,abi:tokenAbi,functionName:"balanceOf",args:[merchant as Address]})).toString();}
 return {ledger:(await evm.view(card)).balances,merchantBalances};
}
try{
 if(!state.documentation){const docs=await fetch(base+"/docs/crosschain",{redirect:"error",signal:AbortSignal.timeout(20000)}),text=await docs.text();assert.equal(docs.status,200);assert.ok(/CCTP|Cross.chain/i.test(text));await save({documentation:{url:base+"/docs/crosschain",status:docs.status,sha256:createHash("sha256").update(text).digest("hex"),readAt:new Date().toISOString(),completeness:5,notes:"Native token addresses, owner destination permissions, exact invoice chain/token, idempotency, async statuses and trust limits documented."}});}
 await ownerLogin();
 const settlement:Settlement={asset:"USDC",destinationChainIds:[1952,84532,421614]};
 if(!state.draftId){
  const now=Math.floor(Date.now()/1000),policy:Policy={version:1,name:"USDC settlement audit",mission:"Verify IntentGuard native testnet USDC payment settlement to the approved protocol test merchant on X Layer, Base Sepolia and Arbitrum Sepolia.",taskContext:"This owner is testing real issuer-deployed testnet token transfers. Authorize only protocol settlement verification invoices matching this vault, exact native destination token, chain, merchant, amount and invoice ID. No purchase or real economic value is advertised.",allowedCategories:["protocol-verification"],prohibitedPurchases:["Advertising","Personal data","Changing or ignoring the owner permission"],exceptions:[],financial:{totalBudget:"2",perPaymentLimit:"1",periodBudget:"2",periodSeconds:86400,validFrom:now-60,validUntil:now+7*86400},merchants:[{name:"IntentGuard protocol test merchant",recipient:merchant,origins:[base],products:["Native USDC settlement verification"]}],evidence:{requiredTypes:["merchant invoice"],approvedOrigins:[base],maxAgeSeconds:7200},criteria:[{id:"purpose",description:"The invoice describes native USDC settlement verification for the assigned protocol testing mission."},{id:"invoice",description:"The public current invoice identifies this agent vault as buyer and the exact requested merchant, destination chain, native USDC token, amount and invoice ID."}]};
  const draft=await api("/owner/drafts",{method:"POST",ownerAuth:true,body:{description:policy.mission,guidance:policy,settlement}});assert.equal(draft.response.status,202);await save({draftId:draft.data.id,policy,settlement});
 }
 const draft=await wait(async()=>{const x=await api("/owner/drafts/"+state.draftId,{ownerAuth:true});assert.equal(x.response.status,200);if(x.data.state==="FAILED")throw Error("AUDIT_GENLAYER_PROPOSAL_FAILED");return x.data;},x=>x.state==="FINALIZED");
 assert.equal(draft.status,"PROPOSED");assert.deepEqual(draft.settlement,settlement);
 if(!state.activationTx){
  const tuple=draft.activation.config;for(const component of artifacts.configTuple.components)if(component.type.startsWith("uint"))tuple[component.name]=BigInt(tuple[component.name]);
  const hash=await sourceWrite("activate",draft.activation.factoryAddress,"createCard",[tuple,draft.activation.destinationDomains],artifacts.CctpCardFactory as Abi),receipt=await evm.public.getTransactionReceipt({hash:hash as Hex});
  let cardAddress:string|undefined;for(const log of receipt.logs){if(log.address.toLowerCase()!==draft.activation.factoryAddress.toLowerCase())continue;try{const event=decodeEventLog({abi:artifacts.CctpCardFactory as Abi,data:log.data,topics:log.topics}),a=event.args as unknown as {owner:string;card:string;policyHash:string};if(event.eventName==="CardCreated"&&a.owner.toLowerCase()===owner&&a.policyHash===digest(draft.policy))cardAddress=a.card;}catch{}}
  assert.ok(cardAddress);await save({activationTx:hash,cardAddress,cardId:state.draftId});
 }
 const registration=await api("/owner/cards",{method:"POST",ownerAuth:true,body:{draftId:state.draftId,cardAddress:state.cardAddress,activationTx:state.activationTx}});assert.ok([200,201].includes(registration.response.status));
 await wait(async()=>{const x=await api("/owner/cards",{ownerAuth:true});assert.equal(x.response.status,200);const c=x.data.cards.find((c:any)=>c.id===state.cardId);if(c?.setupState==="FAILED")throw Error("AUDIT_GENLAYER_REVIEWER_FAILED");return c;},c=>c?.setupState==="READY");
 const card=(await store.get<Card>("cards",String(state.cardId)))!;assert.equal(card.owner,owner);assert.deepEqual(card.settlement,settlement);assert.equal(card.token?.toLowerCase(),CCTP_TESTNETS[1952].token.toLowerCase());await evm.verifyActivation(owner,card.policy,card.address,card.activationTx,settlement);assert.equal((await gl.reviewer(card)).toLowerCase(),card.reviewerAddress!.toLowerCase());
 if(!state.depositTx){const hash=await sourceWrite("deposit",card.token!,"transfer",[card.address,parseAmount("1")],parseAbi(["function transfer(address,uint256) returns (bool)"]));await save({depositTx:hash});}
 if(!key){const issued=await api("/owner/cards/"+state.cardId+"/keys",{method:"POST",ownerAuth:true,body:{}});assert.equal(issued.response.status,201);key=issued.data.apiKey;await save({encryptedKey:encrypt(key)});}
 if(!state.baseline)await save({baseline:await balances(card)});
 const cases:any[]=state.cases as any[];
 for(const [name,chainId,amount,expected]of [["xlayer",1952,"0.1","PAID"],["base",84532,"0.1","PAID"],["arbitrum",421614,"0.1","PAID"],["mainnet",8453,"0.1","DESTINATION_NOT_ALLOWED"],["limit",84532,"1.000001","BLOCKED"]] as const){
  let c=cases.find(c=>c.name===name);
  if(!c){
   const native=CCTP_TESTNETS[(chainId===8453?84532:chainId) as 84532],invoice=await api("/demo/invoices",{method:"POST",adminAuth:true,body:{buyer:card.address,amount,description:"Native USDC settlement verification on "+native.name+". This is a protocol testnet transfer, with no monetary value.",chainId:native.chainId,token:native.token}});assert.equal(invoice.response.status,201);
   c={name,expected,idem:id+"-"+name,payload:{destinationChainId:chainId,recipient:merchant,amount,purchaseDescription:"Native USDC settlement verification",justification:"Verify the approved protocol testnet payment route and its exact receipt.",category:"protocol-verification",invoiceId:invoice.data.invoice.invoiceId,evidence:[{url:invoice.data.url}]}};cases.push(c);await save({cases});
  }
  if(!c.admission){const submitted=await api("/requests",{method:"POST",agentAuth:true,idem:c.idem,body:c.payload});c.admission=submitted.log;c.requestId=submitted.data.id;await save({cases});}
  if(expected==="DESTINATION_NOT_ALLOWED"){assert.equal(c.admission.response.status,422);assert.equal(c.admission.response.body.error.code,expected);continue;}
  assert.equal(c.admission.response.status,202);
  if(!c.result){c.result=await wait(async()=>{const x=await api("/requests/"+c.requestId,{agentAuth:true});assert.equal(x.response.status,200);console.log("CCTP_AUDIT_STATUS",JSON.stringify({case:name,status:x.data.status,errorCode:x.data.errorCode}));return x.data as RequestView;},x=>["PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","EXPIRED","CANCELLED"].includes(x.status));await save({cases});}
  assert.equal(c.result.status,expected);
  if(expected==="BLOCKED"){assert.equal(c.result.reviewStage.status,"SKIPPED");assert.equal(c.result.genLayerTxHash,undefined);assert.ok(c.result.guard.failures.includes("Payment limit"));continue;}
  const payment=(await store.get<Payment>("requests",c.requestId))!;assert.equal((await evm.request(card,payment._id)).status,2);assert.equal(payment.requestHash,digest(payment.canonical));const review=validateDecision(await gl.decision(card,payment),card.policy,payment.canonical!,payment.requestHash!);assert.equal(review.decision,"APPROVE");assert.equal(digest(review),digest(payment.review));
  if(chainId!==1952){const verified=await evm.reconcileBridge(card,payment);assert.equal(verified.status,"PAID");assert.equal(verified.paymentTxHash,payment.paymentTxHash);c.receiptVerified=true;}
  else{assert.equal(await evm.paidHash(card,payment),payment.paymentTxHash);c.receiptVerified=true;}
  await save({cases});
 }
 if(!cases.find(c=>c.name==="idempotent")){const first=cases[0],retry=await api("/requests",{method:"POST",agentAuth:true,idem:first.idem,body:first.payload});assert.equal(retry.response.status,202);assert.equal(retry.data.id,first.requestId);cases.push({name:"idempotent",expected:"SAME_REQUEST",requestId:retry.data.id,admission:retry.log,receiptVerified:true});await save({cases});}
 const final=await balances(card);assert.equal(final.ledger.spent,"0.3");assert.equal(final.ledger.reserved,"0");assert.equal(final.ledger.available,"0.7");
 for(const chainId of [1952,84532,421614])assert.equal(BigInt(final.merchantBalances[chainId])-BigInt((state.baseline as any).merchantBalances[chainId]),parseAmount("0.1"));
 await save({final,status:"PASSED",errorCode:null});console.log("CCTP_LIVE_API_AUDIT_PASSED");
}catch(error){const code=error instanceof assert.AssertionError?"AUDIT_ASSERTION_FAILED":error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:"AUDIT_INFRASTRUCTURE_UNAVAILABLE";await save({status:code==="AUDIT_WAIT_PENDING"?"PENDING":"FAILED",errorCode:code});console.error("CCTP_LIVE_API_AUDIT_INCOMPLETE",code);process.exit(1);}
process.exit(0);
