import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createPublicClient,http,parseAbi,decodeEventLog,getAddress,type Abi,type Hex} from "viem";
import {createClient} from "genlayer-js";
import {studionet} from "genlayer-js/chains";
import {TransactionHashVariant,type Hash as GLHash} from "genlayer-js/types";
import artifacts from "../contracts/evm/abi.json";
import {canonical,digest,parseAmount} from "../packages/shared";
import {assertFinalized,normalizedCalldata,normalizeStudioTransaction} from "../apps/web/lib/genlayer";

// Public verification is read-only. --replay repeats one existing operation
// with its exact original idempotency key after checking its private record.
const path=process.argv.find(v=>v.endsWith(".json"))??"docs/audits/live-api-2026-11-04.json";
const audit=JSON.parse(await readFile(path,"utf8"));
const origin=new URL(audit.deployment.apiOrigin).origin;
assert.equal(origin,"https://intentguard-tapeout.vercel.app");
assert.equal(audit.deployment.paymentChainId,1952);
const card=audit.agent,abi=artifacts.AgentSpendingCard as Abi;
const rpc=createPublicClient({transport:http("https://testrpc.xlayer.tech",{timeout:25000,retryCount:2})});
const gl=createClient({chain:studionet,endpoint:"https://studio.genlayer.com/api"});
const tokenAbi=parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
assert.equal(await rpc.getChainId(),1952);

async function api(path:string,key?:string,body?:unknown,idempotency?:string):Promise<{status:number;data:any;content:string}>{
 const headers:Record<string,string>={};if(key)headers.Authorization="Bearer "+key;if(body!==undefined)headers["Content-Type"]="application/json";if(idempotency)headers["Idempotency-Key"]=idempotency;
 let captured:{status:number;data:any;content:string}|undefined;
 for(let attempt=0;attempt<(body===undefined?3:1);attempt++)try{
  const response=await fetch(origin+"/api/v1"+path,{method:body===undefined?"GET":"POST",headers,body:body===undefined?undefined:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(45000)});
  const raw=await response.text();if(key&&raw.includes(key))throw Error("The API response exposed its credential");captured={status:response.status,data:JSON.parse(raw),content:raw};break;
 }catch(error){if(body!==undefined||attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1000));}
 assert.ok(captured);return captured;
}

assert.equal(audit.cases.length,4);assert.equal(audit.apiChecks.length,10);
assert.equal(new Set(audit.cases.map((p:any)=>p.id)).size,4);
for(const check of audit.apiChecks){assert.equal(check.status,check.expectedStatus,check.name);if(check.expectedCode)assert.equal(check.response.error?.code,check.expectedCode);}
for(const probe of audit.cases){
 assert.equal(probe.status,probe.expected);assert.equal(probe.admission.status,202);assert.equal(probe.admission.id,probe.id);
 assert.equal(probe.id,digest({cardId:card.id,idempotency:probe.idempotencyKey}));
 const publicRecord=await api("/explorer/transactions/"+probe.id);assert.equal(publicRecord.status,200);assert.equal(publicRecord.data.transaction.status,probe.status);
 const chain:any=await rpc.readContract({address:card.vault,abi,functionName:"getRequest",args:[probe.id]});assert.equal(chain.status,probe.proof.chainStatus);
 if(chain.status!==0){assert.equal(chain.recipient.toLowerCase(),probe.input.recipient.toLowerCase());assert.equal(chain.amount,parseAmount(probe.input.amount));assert.equal(chain.requestHash,probe.requestHash);assert.equal(chain.evidenceHash,probe.evidenceHash);}
 if(probe.genLayerTxHash){
  const tx=normalizeStudioTransaction(await gl.getTransaction({hash:probe.genLayerTxHash as GLHash}),probe.genLayerTxHash);assertFinalized(tx);
  assert.equal((tx.recipient??tx.to_address)?.toLowerCase(),card.reviewerAddress.toLowerCase());
  const decoded:any=tx.txDataDecoded;assert.equal(decoded.type,"call");const call:any=normalizedCalldata(decoded.callData);assert.equal(call.method,"review");assert.equal(call.args.length,3);assert.equal(call.args[0],probe.id);
  const committed=JSON.parse(call.args[1]),snapshots=JSON.parse(call.args[2]);assert.equal(digest(committed),probe.requestHash);assert.equal(digest(snapshots),probe.evidenceHash);
  assert.equal(committed.policyHash,card.policyHash);assert.equal(committed.cardAddress.toLowerCase(),card.vault.toLowerCase());assert.equal(committed.token.toLowerCase(),card.token.toLowerCase());assert.equal(committed.amountAtomic,parseAmount(probe.input.amount).toString());assert.equal(committed.chainId,1952);
  for(const field of Object.keys(probe.input))assert.equal(canonical(committed[field]),canonical(probe.input[field]),"Committed field: "+field);
  assert.equal(snapshots.length,1);assert.equal(snapshots[0].url,probe.input.evidence[0].url);
  const invoice=await api(new URL(snapshots[0].url).pathname.replace(/^\/api\/v1/,""));assert.equal(invoice.status,200);assert.equal(invoice.content,snapshots[0].content);assert.equal(canonical(invoice.data),canonical(JSON.parse(snapshots[0].content)));
  const review=JSON.parse(String(await gl.readContract({address:getAddress(card.reviewerAddress),functionName:"get_review",args:[probe.id],jsonSafeReturn:true,transactionHashVariant:TransactionHashVariant.LATEST_FINAL})));
  assert.equal(canonical(review),canonical(probe.review));assert.equal(review.requestHash,probe.requestHash);assert.equal(review.policyHash,card.policyHash);assert.equal(review.evidenceHash,probe.evidenceHash);
  assert.deepEqual(new Set(review.criteria.map((c:any)=>c.id)),new Set(card.criteriaIds));
  if(probe.status==="PAID")assert.ok(review.criteria.every((c:any)=>c.status==="PASS"&&c.sources.length>0));
 }
 if(probe.status==="PAID"){
  assert.equal(probe.review.decision,"APPROVE");assert.equal(publicRecord.data.transaction.paymentTxHash,probe.paymentTxHash);
  const receipt=await rpc.getTransactionReceipt({hash:probe.paymentTxHash as Hex});assert.equal(receipt.status,"success");assert.ok((await rpc.getBlockNumber())>=receipt.blockNumber+1n);let paid=0,transferred=0;
  for(const log of receipt.logs){try{
   if(log.address.toLowerCase()===card.vault.toLowerCase()){const event:any=decodeEventLog({abi,data:log.data,topics:log.topics});if(event.eventName==="Paid"&&event.args.requestId===probe.id){assert.equal(event.args.decisionHash,digest(probe.review));assert.equal(event.args.genLayerTxHash,probe.genLayerTxHash);assert.equal(event.args.recipient.toLowerCase(),probe.input.recipient.toLowerCase());assert.equal(event.args.amount,parseAmount(probe.input.amount));paid++;}}
   if(log.address.toLowerCase()===card.token.toLowerCase()){const event:any=decodeEventLog({abi:tokenAbi,data:log.data,topics:log.topics});if(event.eventName==="Transfer"&&event.args.from.toLowerCase()===card.vault.toLowerCase()&&event.args.to.toLowerCase()===probe.input.recipient.toLowerCase()&&event.args.value===parseAmount(probe.input.amount))transferred++;}
  }catch(error){if(error instanceof assert.AssertionError)throw error;}}
  assert.equal(paid,1);assert.equal(transferred,1);
 }else assert.ok(!probe.paymentTxHash);
 if(probe.name==="instruction-bypass"){assert.equal(probe.review.decision,"REJECT");assert.equal(chain.status,3);}
 if(probe.name==="over-payment-limit"){assert.equal(chain.status,0);assert.ok(probe.guard.failures.includes("Payment limit"));assert.equal(probe.reviewStage.status,"SKIPPED");}
 if(probe.name==="wrong-invoice-buyer"){assert.equal(chain.status,0);assert.equal(probe.errorCode,"INVOICE_BUYER_MISMATCH");assert.equal(probe.reviewStage.status,"SKIPPED");}
 console.log("LIVE_API_CASE_VERIFIED",probe.name,probe.status,probe.id);
}
const route=audit.crossChainAttempt;
assert.equal(route.input.destinationChainId,84532);assert.deepEqual(route.allowedDestinationChainIds,[1952]);assert.equal(route.status,422);assert.equal(route.response.error.code,"DESTINATION_NOT_ALLOWED");assert.equal(route.operationReadStatus,404);
const domains=await rpc.readContract({address:card.vault,abi:artifacts.CctpSpendingCard as Abi,functionName:"allowedDomains"});assert.deepEqual(domains,[37]);
const denied:any=await rpc.readContract({address:card.vault,abi,functionName:"getRequest",args:[route.requestId]});assert.equal(denied.status,0);
console.log("LIVE_API_ROUTE_DENIAL_VERIFIED",84532,route.response.error.code);

if(process.argv.includes("--replay")){
 const key=process.env.INTENTGUARD_API_KEY??await new Promise<string>(resolve=>{let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>{input+=chunk;if(input.includes("\n")){process.stdin.pause();resolve(input.split("\n")[0].trim());}});process.stdin.on("end",()=>resolve(input.trim()));});
 if(!/^ig_[A-Za-z0-9_-]+$/.test(key))throw Error("Set INTENTGUARD_API_KEY or supply it through private stdin");
 const me=await api("/me",key);assert.equal(me.status,200);assert.equal(me.data.card.id,card.id,"Replay key must belong to the already tested card");
 const probe=audit.cases.find((p:any)=>p.name==="permitted"),existing=await api("/requests/"+probe.id,key);assert.equal(existing.status,200);assert.equal(existing.data.status,"PAID");assert.equal(canonical(existing.data.request),canonical(probe.input));
 const replay=await api("/requests",key,probe.input,probe.idempotencyKey);assert.equal(replay.status,202);assert.equal(replay.data.id,probe.id);assert.equal(replay.data.status,"PAID");
 console.log("LIVE_API_EXACT_REPLAY_VERIFIED",probe.id);
}
console.log("LIVE_API_AUDIT_VERIFIED",audit.verifiedAt);
