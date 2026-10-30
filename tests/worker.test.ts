import {test} from "node:test";
import assert from "node:assert/strict";
import {digest} from "../packages/shared";
import {MemoryStore} from "../apps/web/lib/store";
import {Worker,requestId} from "../apps/web/lib/worker";
import {PendingFinality,GenLayerTerminalError,GenLayer} from "../apps/web/lib/genlayer";
import type {Payment} from "../apps/web/lib/models";
import {card,owner,input,invoice,FakeEvm,FakeGenLayer} from "./fixtures";
async function setup(){const s=new MemoryStore(),evm=new FakeEvm(),gl=new FakeGenLayer();await s.create("cards",card);await s.create("keys",{_id:"key",cardId:card._id,owner,revoked:false});const p:Payment={_id:requestId(),owner,cardId:card._id,keyId:"key",input,inputHash:digest(input),status:"QUEUED",createdAt:Date.now(),updatedAt:Date.now()};await s.create("requests",p);const worker=new Worker(s,evm,gl,async()=>invoice());const step=async()=>{const current=(await s.get<Payment>("requests",p._id))!;const values=await worker.payment(current);await s.patch("requests",p._id,values);return (await s.get<Payment>("requests",p._id))!};return{s,evm,gl,p,worker,step}}
test("successful request persists snapshots before reserve and pays once after finalized review",async()=>{const t=await setup();let p=await t.step();assert.ok(p.canonical);assert.equal(t.evm.reserves,0);assert.equal(p.requestHash,digest(p.canonical));p=await t.step();assert.equal(p.status,"RESERVED");p=await t.step();assert.equal(p.status,"AWAITING_FINALITY");assert.equal(t.evm.settlements,0);p=await t.step();assert.equal(p.status,"APPROVED");p=await t.step();assert.equal(p.status,"PAID");await t.step();assert.equal(t.evm.settlements,1);assert.equal(t.gl.submissions,1)});
test("TapeOut denial avoids evidence fetching and GenLayer fees",async()=>{const t=await setup();t.evm.allow=false;let fetched=0;const worker=new Worker(t.s,t.evm,t.gl,async()=>{fetched++;return invoice()});const values=await worker.payment(t.p);assert.equal(values.status,"BLOCKED");assert.equal(fetched,0);assert.equal(t.gl.submissions,0)});
test("nonfinal review, VM errors and forged commitments cannot release",async()=>{for(const error of [new PendingFinality("accepted"),Error("VM error")]){const t=await setup();await t.step();await t.step();await t.step();t.gl.error=error;await assert.rejects(t.step());assert.equal(t.evm.settlements,0);assert.equal((await t.evm.request(card,t.p._id)).status,1)}const t=await setup();await t.step();await t.step();await t.step();t.gl.modify=r=>({...r,evidenceHash:"0x"+"00".repeat(32)});await assert.rejects(t.step());assert.equal(t.evm.settlements,0)});
test("approve with failed criteria and missing criteria fails closed",async()=>{for(const modify of [(r:any)=>({...r,criteria:[]}), (r:any)=>({...r,criteria:r.criteria.map((c:any)=>({...c,status:"FAIL"}))})]){const t=await setup();await t.step();await t.step();await t.step();t.gl.modify=modify;await assert.rejects(t.step());assert.equal(t.evm.settlements,0)}});
test("semantic rejection or insufficient evidence cancels reserved funds",async()=>{for(const result of ["REJECT","NEEDS_EVIDENCE"] as const){const t=await setup();t.gl.result=result;await t.step();await t.step();await t.step();let p=await t.step();assert.equal(p.cancelTarget,result==="REJECT"?"REJECTED":result);p=await t.step();assert.equal(p.status,result==="REJECT"?"REJECTED":result);assert.equal(t.evm.cancellations,1);assert.equal(t.evm.settlements,0)}});
test("revoked key and expired authorization release reservation without a payment",async()=>{for(const mode of ["revoked","expired"]){const t=await setup();await t.step();await t.step();if(mode==="revoked")await t.s.patch("keys","key",{revoked:true});else{const p=(await t.s.get<Payment>("requests",t.p._id))!;await t.s.patch("requests",p._id,{canonical:{...p.canonical!,expiresAt:1}})}const p=await t.step();assert.equal(p.status,mode==="revoked"?"CANCELLED":"EXPIRED");assert.equal(t.evm.cancellations,1);assert.equal(t.evm.settlements,0)}});
test("merchant invoice contradiction and stale evidence never reserve funds",async()=>{const t=await setup();for(const change of [{amount:"9"},{buyer:owner},{issuedAt:1},{expiresAt:1}]){const worker=new Worker(t.s,t.evm,t.gl,async()=>JSON.stringify({...JSON.parse(invoice()),...change}));const p=await worker.payment(t.p);assert.equal(p.status,"NEEDS_EVIDENCE");assert.equal(t.evm.reserves,0)}});
test("crash after reservation is reconciled without reserving a second time",async()=>{const t=await setup();const p=await t.step();await t.evm.reserve(card,p);const resumed=new Worker(t.s,t.evm,t.gl,async()=>invoice());const values=await resumed.payment(p);assert.equal(values.status,"AWAITING_FINALITY");assert.equal(t.evm.reserves,1)});
test("changing a finalized approval between authorization and settlement fails closed",async()=>{const t=await setup();await t.step();await t.step();await t.step();await t.step();t.gl.modify=r=>({...r,reason:"Different finalized result"});await assert.rejects(t.step());assert.equal(t.evm.settlements,0)});
test("two workers claim one job and write one evidence commitment",async()=>{const t=await setup();const other=new Worker(t.s,t.evm,t.gl,async()=>invoice());const results=await Promise.all([t.worker.tick(),other.tick()]);assert.equal(results.filter(Boolean).length,1);const p=await t.s.get<Payment>("requests",t.p._id);assert.ok(p?.canonical);assert.equal(t.evm.reserves,0)});

test("a permanently failed proposal terminates without rebroadcasting its transaction",async()=>{
 const s=new MemoryStore(),gl=new FakeGenLayer(),id=requestId(),tx="0x"+"ab".repeat(32);
 await s.create("drafts",{_id:id,owner,input:{description:"Buy protocol research data"},inputHash:digest({description:"Buy protocol research data"}),genLayerTxHash:tx,state:"AWAITING_FINALITY",createdAt:1,updatedAt:1});
 let reads=0;gl.draft=async()=>{reads++;throw new GenLayerTerminalError("GenLayer VM execution was not successful")};
 const w=new Worker(s,new FakeEvm(),gl);assert.equal(await w.tick(),true);
 const d=await s.get("drafts",id);assert.equal(d?.state,"FAILED");assert.equal(d?.genLayerTxHash,tx);assert.match(String(d?.error),/submit a new proposal/);
 assert.equal(await w.tick(),false);assert.equal(reads,1);assert.equal(gl.submissions,0);
});
test("a permanently failed reviewer is marked failed and cannot initialize indefinitely",async()=>{
 const s=new MemoryStore(),gl=new FakeGenLayer();await s.create("cards",{...card,state:"SETTING_UP",reviewerAddress:undefined,reviewerTx:"0x"+"ab".repeat(32)});
 gl.reviewer=async()=>{throw new GenLayerTerminalError("Validator consensus failed")};
 const w=new Worker(s,new FakeEvm(),gl);await w.tick();const c=await s.get("cards",card._id);assert.equal(c?.state,"FAILED");assert.match(String(c?.error),/Retry initialization/);
 assert.equal(await w.tick(),false);
});
test("terminal generated-proposal diagnostics preserve exact owner input without rebroadcast",async()=>{
 const s=new MemoryStore(),gl=new FakeGenLayer(),id=requestId(),original={description:"Buy protocol research data",guidance:card.policy};
 await s.create("drafts",{_id:id,owner,input:original,inputHash:digest(original),genLayerTxHash:"0x"+"ab".repeat(32),state:"AWAITING_FINALITY",createdAt:1,updatedAt:1});
 gl.draft=async()=>{throw new GenLayerTerminalError("Private provider output",{code:"DRAFT_GENERATION_CHANGED_GUIDANCE",message:"The generated proposal changed explicit owner terms. No policy was authorized; review the saved terms and submit a new proposal."})};
 const worker=new Worker(s,new FakeEvm(),gl);await worker.tick();const result=await s.get("drafts",id);
 assert.equal(result?.state,"FAILED");assert.equal(result?.errorCode,"DRAFT_GENERATION_CHANGED_GUIDANCE");assert.deepEqual(result?.input,original);assert.match(String(result?.error),/changed explicit owner terms/);assert.equal(String(result?.error).includes("Private provider output"),false);assert.equal(await worker.tick(),false);
});
test("terminal payment review failure persists cancellation and never settles",async()=>{
 const t=await setup();await t.step();await t.step();await t.step();t.gl.error=new GenLayerTerminalError("Finalized VM error");
 await t.worker.tick();let p=await t.s.get<Payment>("requests",t.p._id);assert.equal(p?.status,"RETRYING");assert.equal(p?.cancelTarget,"CANCELLED");assert.ok(p?.genLayerTxHash);assert.equal(t.evm.settlements,0);
 // Recover a cancellation that broadcast before its database completion.
 await t.evm.cancel(card,p!);await t.worker.tick();p=await t.s.get<Payment>("requests",t.p._id);
 assert.equal(p?.status,"CANCELLED");assert.match(String(p?.error),/No payment was authorized/);assert.equal(t.evm.settlements,0);assert.equal(t.evm.cancellations,1);assert.equal(await t.worker.tick(),false);
});
test("transient failures and pending finality remain safely retryable",async()=>{
 for(const e of [Error("Temporary RPC timeout"),new PendingFinality("Waiting for validators")]){
  const s=new MemoryStore(),gl=new FakeGenLayer(),id=requestId();
  await s.create("drafts",{_id:id,owner,input:{description:"Buy protocol research data"},inputHash:"hash",genLayerTxHash:"tx",state:"AWAITING_FINALITY",createdAt:1,updatedAt:1});
  gl.draft=async()=>{throw e};const w=new Worker(s,new FakeEvm(),gl);await w.tick();const first=await s.get("drafts",id);
  assert.equal(first?.state,"AWAITING_FINALITY");assert.equal(e instanceof PendingFinality?first?.error:null,null);
  gl.draft=new FakeGenLayer().draft;await s.patch("drafts",id,{nextAt:0});await w.tick();assert.equal((await s.get("drafts",id))?.state,"FINALIZED");
 }
});
test("reviewer retries have distinct journals and the same attempt remains idempotent",async()=>{
 const gl=new GenLayer(new MemoryStore()),ids:string[]=[];
 gl.send=async id=>{ids.push(id);return "0x"+"ab".repeat(32)};
 await gl.deployReviewer(card);await gl.deployReviewer({...card,reviewerAttempt:1});await gl.deployReviewer({...card,reviewerAttempt:1});
 assert.notEqual(ids[0],ids[1]);assert.equal(ids[1],ids[2]);
});

test("a GenLayer finality wait exceeding thirty minutes terminates with an actionable timeout",async()=>{
 const s=new MemoryStore(),gl=new FakeGenLayer(),id=requestId();
 await s.create("drafts",{_id:id,owner,input:{description:"Buy protocol research"},inputHash:"hash",genLayerTxHash:"tx",state:"AWAITING_FINALITY",waitStartedAt:Date.now()-31*60000,createdAt:1,updatedAt:1});
 gl.draft=async()=>{throw new PendingFinality("Network has not finalized")};
 const worker=new Worker(s,new FakeEvm(),gl);await worker.tick();const d=await s.get("drafts",id);assert.equal(d?.state,"FAILED");assert.equal(d?.errorCode,"PROCESSING_TIMEOUT");assert.equal(await worker.tick(),false);
});
test("new reviewers use version two while legacy source remains available for exact readiness checks",async()=>{
 const s=new MemoryStore(),gl=new FakeGenLayer();await s.create("cards",{...card,state:"SETTING_UP",reviewerTx:undefined});
 let version:unknown;gl.deployReviewer=async c=>{version=c.reviewerVersion;return "0x"+"ab".repeat(32)};
 await new Worker(s,new FakeEvm(),gl).tick();assert.equal(version,2);assert.equal((await s.get("cards",card._id))?.reviewerVersion,2);
 const real=new GenLayer(s);const v1=await real.reviewerSource(1),v2=await real.reviewerSource(2);assert.notEqual(v1.toString(),v2.toString());await assert.rejects(()=>real.reviewerSource(9));
});

test("continuous new proposals do not starve admitted payment work",async()=>{
 const t=await setup();for(let i=0;i<12;i++)await t.s.create("drafts",{_id:requestId(),owner,input:{description:"Protocol research proposal "+i},inputHash:digest(i),state:"QUEUED",createdAt:i,updatedAt:i});
 for(let i=0;i<4;i++)await t.worker.tick();
 assert.ok((await t.s.get<Payment>("requests",t.p._id))?.canonical,"Payment must advance despite a backlog of queued proposals");assert.equal(t.evm.settlements,0);
});
