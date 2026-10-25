import assert from "node:assert/strict";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {database,type Doc} from "../apps/web/lib/store";
import {configuration} from "../apps/web/lib/config";
import {GenLayer,PendingFinality} from "../apps/web/lib/genlayer";
import {Evm} from "../apps/web/lib/evm";
import type {Card,Payment,Job} from "../apps/web/lib/models";
import {digest,contentDigest,validateDecision} from "../packages/shared";
const cfg=configuration();
assert.equal(cfg.testnet,true);assert.equal(cfg.chainId,1952);
const store=await database(),gl=new GenLayer(store),source=await readFile("contracts/genlayer/purchase_reviewer.py","utf8");
assert.equal(await gl.client.getChainId(),61999);
const sourceHash=contentDigest(source),probeId=digest({purpose:"reviewer-v2-live-verification",sourceHash});
const actual=await store.get<Card>("cards","0x5265d227519c96e186cda7e45d072d18751dca8da58615ca8832bd78527faf37");
assert.ok(actual);assert.equal(actual.state,"READY");
const originalReviewer=await gl.reviewer(actual);
assert.equal(originalReviewer.toLowerCase(),actual.reviewerAddress!.toLowerCase());
const paid=(await store.find<Payment>("requests",{cardId:actual._id,status:"PAID"},{limit:10})).find(p=>p.canonical&&p.snapshots);
assert.ok(paid?.canonical&&paid.snapshots);
await store.create("verification",{_id:probeId,createdAt:Date.now(),updatedAt:Date.now()});
async function signed<T>(operation:()=>Promise<T>){
 await store.create("locks",{_id:"worker",createdAt:Date.now()});
 const deadline=Date.now()+150000;let lease:Job|null=null;
 while(Date.now()<deadline){lease=await store.claim<Job>("locks",{_id:"worker"},Date.now(),120000);if(lease)break;await new Promise(r=>setTimeout(r,1000))}
 if(!lease)throw Error("Signing coordinator remained busy");
 try{return await operation()}finally{await store.complete("locks","worker",lease.leaseToken!,{nextAt:0})}
}
async function finalized<T>(operation:()=>Promise<T>){const deadline=Date.now()+600000;while(Date.now()<deadline){try{return await operation()}catch(e){if(!(e instanceof PendingFinality))throw e;await new Promise(r=>setTimeout(r,5000))}}throw Error("Live GenLayer finality exceeded the bounded verification window")}
const saved=(await store.get<Doc>("verification",probeId))!;
const probe:Card={...actual,_id:probeId,reviewerVersion:2,reviewerAttempt:0,reviewerTx:saved.reviewerTx as string|undefined,reviewerAddress:undefined};
if(!probe.reviewerTx){probe.reviewerTx=await signed(()=>gl.deployReviewer(probe));await store.patch("verification",probeId,{reviewerTx:probe.reviewerTx,updatedAt:Date.now()})}
probe.reviewerAddress=await finalized(()=>gl.reviewer(probe));
const request={...paid.canonical,category:"intentguard-v2-probe-denied-category"};
const p:Payment={...paid,_id:digest({probeId,test:"deterministic-denial"}),canonical:request,requestHash:digest(request),input:{...paid.input,category:request.category},review:undefined,genLayerTxHash:saved.reviewTx as string|undefined};
if(!p.genLayerTxHash){p.genLayerTxHash=await signed(()=>gl.submit(probe,p));await store.patch("verification",probeId,{reviewTx:p.genLayerTxHash,updatedAt:Date.now()})}
const decision=validateDecision(await finalized(()=>gl.decision(probe,p)),actual.policy,request,p.requestHash!);
assert.equal(decision.decision,"REJECT");assert.ok(decision.criteria.every(c=>c.status==="FAIL"&&c.sources.length===0));
assert.equal(decision.requestHash,digest(request));assert.equal(decision.policyHash,actual.policyHash);
const evm=new Evm(store),guard=await evm.preview(actual,{...paid.input,amount:"3.000001"},Math.min(actual.policy.financial.validUntil,Math.floor(Date.now()/1000)+60));
assert.equal(guard.allow,false);
const report={mode:"LIVE_ACTIONS_TESTNET_NO_PAYMENT_MUTATIONS",verifiedAt:new Date().toISOString(),sourceHash,legacyReviewer:originalReviewer,reviewerVersion:2,reviewerAddress:probe.reviewerAddress,deploymentTx:probe.reviewerTx,reviewTx:p.genLayerTxHash,decision,tapeoutBoundary:guard,applicationRequestsAdded:0,fundsMoved:"0"};
await store.patch("verification",probeId,{report,updatedAt:Date.now()});
await mkdir(".local/reviewer-v2-proof",{recursive:true});await writeFile(".local/reviewer-v2-proof/result.json",JSON.stringify(report,null,2)+"\n");
console.log("LIVE_REVIEWER_V2_VERIFIED",JSON.stringify({reviewer:probe.reviewerAddress,reviewTx:p.genLayerTxHash,decision:decision.decision}));
process.exit(0);
