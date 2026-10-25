import assert from "node:assert/strict";
import {loadEnvFile} from "node:process";
import {readFile,writeFile,stat} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {parseAbi,decodeEventLog,type Address,type Abi,type Hex} from "viem";
import {canonical,digest,contentDigest,parseAmount,formatAmount,validateDecision} from "../packages/shared";
import {Evm} from "../apps/web/lib/evm";
import {GenLayer,assertFinalized,GenLayerTerminalError,normalizedCalldata} from "../apps/web/lib/genlayer";
import {MemoryStore} from "../apps/web/lib/store";
import type {Card} from "../apps/web/lib/models";
import abi from "../contracts/evm/abi.json";
loadEnvFile(".local/testnet-secrets.env");loadEnvFile(".local/hosting.env");loadEnvFile(".local/audit-agent.env");
assert.equal(process.env.INTENTGUARD_MODE,"testnet");assert.equal(process.env.XLAYER_CHAIN_ID,"1952");
assert.equal((await stat(".local/audit-agent.env")).mode&0o077,0);
const input=await readFile("docs/audits/audit-12-results.json","utf8"),audit=JSON.parse(input),key=process.env.INTENTGUARD_AUDIT_API_KEY!,base=process.env.APP_URL!;
const logs:any[]=[];
async function get(path:string){
 for(let i=0;i<3;i++)try{
  const response=await fetch(base+"/api/v1"+path,{headers:{Authorization:"Bearer "+key},redirect:"error",signal:AbortSignal.timeout(45000)});
  const raw=await response.text();assert.ok(!raw.includes(key));assert.equal(response.status,200);
  logs.push({request:{method:"GET",url:base+"/api/v1"+path,headers:{Authorization:"[REDACTED]"}},response:{status:response.status,headers:Object.fromEntries(response.headers.entries()),body:raw}});
  return JSON.parse(raw);
 }catch(error){if(i===2)throw error;await new Promise(r=>setTimeout(r,2000*(i+1)))}
 throw Error("Read failed");
}
try{
 const store=new MemoryStore(),evm=new Evm(store),gl=new GenLayer(store);
 const me=(await get("/me")).card;assert.equal(me.id,audit.cardId);assert.equal(me.address,audit.cardAddress);assert.equal(me.setupState,"READY");assert.equal(me.status,"ACTIVE");assert.equal(canonical(me.policy),canonical(audit.actualPolicy));assert.equal(me.policyHash,digest(me.policy));
 const config=await evm.read(me.address,"config") as any;
 const card={_id:me.id,address:me.address,owner:config.owner,policy:me.policy,policyHash:me.policyHash,token:me.token,chainId:me.chainId,createdAt:0,updatedAt:0,draftId:me.id,activationBlock:"0",keyStatus:me.keyStatus,state:"READY",reviewerAddress:me.reviewerAddress,reviewerTx:me.reviewerTx,activationTx:me.activationTx} as Card;
 await evm.verifyActivation(card.owner,card.policy,card.address,card.activationTx);
 assert.equal((await gl.reviewer(card)).toLowerCase(),card.reviewerAddress!.toLowerCase());
 const publicRows=(await get("/explorer/transactions?agentId="+card._id+"&limit=50")).transactions;
 const probes=audit.cases.filter((p:any)=>p.requestId&&p.id!==2),ids=probes.map((p:any)=>p.requestId);
 assert.equal(new Set(ids).size,9);assert.deepEqual(publicRows.map((p:any)=>p.id).sort(),ids.slice().sort());
 const privateRows=await Promise.all(ids.map((id:string)=>get("/requests/"+id)));
 const proofs=[];
 for(const probe of probes){
  const p=privateRows.find(row=>row.id===probe.requestId);assert.ok(p);assert.equal(p.cardId,card._id);assert.equal(canonical(p.request),canonical(probe.input));assert.equal(p.status,probe.terminal.status);
  const chain=await evm.request(card,p.id),proof:any={id:p.id,status:p.status,chainStatus:chain.status};
  if(chain.status!==0){assert.equal(chain.requestHash,p.requestHash);assert.equal(chain.evidenceHash,p.evidenceHash);assert.equal(chain.amount,parseAmount(p.request.amount));assert.equal(chain.recipient.toLowerCase(),p.request.recipient.toLowerCase());assert.equal(await evm.read(card.address,"invoiceRequest",[chain.invoiceKey]),chain.status===2?p.id:"0x"+"00".repeat(32));}
  if(p.genLayerTxHash){
   const tx=await gl.client.getTransaction({hash:p.genLayerTxHash as any});proof.genLayer={hash:p.genLayerTxHash,status:tx.statusName,execution:tx.txExecutionResultName,result:tx.resultName};
   if(p.review){
    const decoded=normalizedCalldata((tx.txDataDecoded as any).callData) as any,request=JSON.parse(decoded.args[1]),snapshots=JSON.parse(decoded.args[2]);
    assertFinalized(tx,{target:card.reviewerAddress!,method:"review",args:[p.id,canonical(request),canonical(snapshots)],sender:gl.account().address});
    assert.equal(digest(request),p.requestHash);assert.equal(digest(snapshots),p.evidenceHash);assert.equal(request.policyHash,card.policyHash);assert.equal(request.owner.toLowerCase(),card.owner.toLowerCase());assert.equal(request.cardAddress,card.address);assert.equal(request.amountAtomic,String(chain.amount));assert.equal(request.evidenceHash,p.evidenceHash);
    for(const name of Object.keys(p.request))assert.equal(canonical(request[name]),canonical(p.request[name]));
    const review=validateDecision(JSON.parse(String(await gl.read(card.reviewerAddress!,"get_review",[p.id]))),card.policy,request,p.requestHash);
    assert.equal(canonical(review),canonical(p.review));assert.equal(review.decision,"APPROVE");proof.genLayer.reviewVerified=true;
   }else{assert.throws(()=>assertFinalized(tx),GenLayerTerminalError);assert.equal(p.status,"CANCELLED");proof.genLayer.terminalFailureVerified=true;}
  }
  if(p.status==="PAID"||p.status==="CANCELLED"){
   assert.equal(chain.status,p.status==="PAID"?2:3);
   const hash=p.status==="PAID"?p.paymentTxHash:probe.protocol.cancellationReceipt.hash;
   const receipt=await evm.public.waitForTransactionReceipt({hash,confirmations:2,timeout:90000});assert.equal(receipt.status,"success");
   const expected=p.status==="PAID"?"Paid":"Cancelled",events=receipt.logs.flatMap(log=>{if(log.address.toLowerCase()!==card.address.toLowerCase())return [];try{const e=decodeEventLog({abi:abi.AgentSpendingCard as Abi,data:log.data,topics:log.topics});return e.eventName===expected?[{name:e.eventName,args:e.args}]:[]}catch{return []}});
   const event=events.find(e=>String((e.args as any).requestId)===p.id);assert.ok(event);
   if(p.status==="PAID"){const args=event.args as any;assert.equal(args.amount,parseAmount(p.request.amount));assert.equal(args.recipient.toLowerCase(),p.request.recipient.toLowerCase());assert.equal(args.decisionHash,digest(p.review));assert.equal(args.genLayerTxHash,p.genLayerTxHash);}
   proof.receipt={hash,status:receipt.status,blockNumber:String(receipt.blockNumber),events};
  }else{assert.equal(chain.status,0);assert.ok(["BLOCKED","NEEDS_EVIDENCE"].includes(p.status));assert.equal(p.paymentTxHash,undefined);}
  proofs.push(proof);
 }
 const sum=privateRows.filter(p=>p.status==="PAID").reduce((value,p)=>value+parseAmount(p.request.amount),0n);
 const tokenAbi=parseAbi(["function balanceOf(address) view returns (uint256)"]);
 const [view,merchant,vault,period]=await Promise.all([evm.view(card),evm.public.readContract({address:me.token as Address,abi:tokenAbi,functionName:"balanceOf",args:[me.policy.merchants[0].recipient as Address]}),evm.public.readContract({address:me.token as Address,abi:tokenAbi,functionName:"balanceOf",args:[me.address as Address]}),evm.read(me.address,"currentPeriod")]);
 assert.equal(sum,parseAmount("3.000001"));assert.equal(merchant-BigInt(audit.baseline.merchantAtomic),sum);assert.equal(BigInt(audit.baseline.vaultAtomic)-vault,sum);assert.equal(parseAmount(view.balances.spent),sum);assert.equal(view.balances.reserved,"0");assert.equal(view.balances.periodReserved,"0");assert.equal(String(period),audit.baseline.period);assert.ok(parseAmount(view.balances.periodSpent)<=parseAmount(me.policy.financial.periodBudget));
 const calls=JSON.parse(await readFile("docs/audits/audit-12-raw-logs.json","utf8")).requests.filter((r:any)=>r.request.method==="POST"&&r.request.url===base+"/api/v1/requests");assert.equal(calls.length,12);assert.equal(calls.filter((r:any)=>r.response.status!==null).length,11);assert.equal(audit.cases[1].requestId,audit.cases[0].requestId);
 const runs=JSON.parse(execFileSync("gh",["api","repos/TS-mfon/intentguard/actions/workflows/worker.yml/runs?per_page=30"],{stdio:["ignore","pipe","pipe"]}).toString()).workflow_runs;
 const workerRuns=audit.workerRuns.map((w:any)=>{const actual=runs.find((r:any)=>r.id===w.id);assert.ok(actual);assert.equal(actual.status,"completed");assert.equal(actual.conclusion,"success");assert.equal(actual.head_sha,w.head_sha);return {id:actual.id,status:actual.status,conclusion:actual.conclusion,head_sha:actual.head_sha,html_url:actual.html_url}});
 await writeFile("docs/audits/audit-12-remote-verification.json",JSON.stringify({mode:"FRESH_HOSTED_API_AND_ONCHAIN_VERIFICATION",verifiedAt:new Date().toISOString(),resultArtifactSha256:contentDigest(input),paymentPostCount:0,originalPaymentPostAttempts:calls.length,capturedPaymentResponses:11,uniqueLedgerRecords:privateRows.length,transferred:formatAmount(sum),final:{ledger:view.balances,merchantAtomic:String(merchant),vaultAtomic:String(vault),period:String(period)},proofs,workerRuns,rawGetLogs:logs},(_key,value)=>typeof value==="bigint"?value.toString():value,2)+"\n");
 console.log("AUDIT_REMOTE_PROTOCOL_EVIDENCE_VERIFIED");process.exit(0);
}catch(error){console.error("AUDIT_REMOTE_VERIFICATION_FAILED",error instanceof Error?error.message.split(key).join("[REDACTED]"):"Read-only verification failed");process.exit(1);}
