import {test} from "node:test";
import assert from "node:assert/strict";
import {MemoryStore} from "../apps/web/lib/store";
import {wakeWorker,hasPendingWork,workerHeartbeat,finishWorker,type WakeConfiguration} from "../apps/web/lib/worker-wake";
const config:WakeConfiguration={token:"test-only-github-token",repository:"owner/repository",workflow:"worker.yml",ref:"main"};
async function setup(){
 const store=new MemoryStore();await store.create("drafts",{_id:"draft",state:"QUEUED",createdAt:1});
 let clock=100000,runs:unknown[]=[],lookupStatus=200,dispatchStatus=204;
 const calls:{url:string;init?:RequestInit}[]=[];
 const fetcher:typeof fetch=async(url,init)=>{
  calls.push({url:String(url),init});
  return init?.method==="POST"?new Response(dispatchStatus===204?null:"private upstream body",{status:dispatchStatus}):Response.json({workflow_runs:runs},{status:lookupStatus});
 };
 return {store,calls,options:{config,fetcher,now:()=>clock},setClock:(v:number)=>{clock=v},setRuns:(v:unknown[])=>{runs=v},setStatuses:(a:number,b:number)=>{lookupStatus=a;dispatchStatus=b}};
}
test("concurrent admissions produce one dispatch and retain queue work",async()=>{
 const s=await setup(),results=await Promise.all(Array.from({length:20},()=>wakeWorker(s.store,s.options)));
 assert.equal(results.filter(v=>v==="dispatched").length,1);assert.equal(s.calls.filter(c=>c.init?.method==="POST").length,1);
 assert.equal((await s.store.get("drafts","draft"))?.state,"QUEUED");
 const posted=s.calls.find(c=>c.init?.method==="POST")!;
 assert.deepEqual(JSON.parse(String(posted.init?.body)),{ref:"main",inputs:{duration_seconds:"180"}});
 assert.equal(posted.init?.redirect,"error");assert.equal((posted.init?.headers as Record<string,string>).Authorization,"Bearer "+config.token);assert.ok(posted.init?.signal);
});
test("cooldown coalesces a newly dispatched runner before it becomes visible",async()=>{
 const s=await setup();assert.equal(await wakeWorker(s.store,s.options),"dispatched");
 assert.equal(await wakeWorker(s.store,s.options),"coalesced");assert.equal(s.calls.length,2);
 s.setClock(116000);assert.equal(await wakeWorker(s.store,s.options),"dispatched");
});
test("queued and starting runs are reused",async()=>{
 for(const status of ["queued","waiting","requested","pending","in_progress"]){
  const s=await setup();s.setRuns([{id:7,status,created_at:new Date(90000).toISOString()}]);assert.equal(await wakeWorker(s.store,s.options),"active");assert.equal(s.calls.length,1);
 }
});
test("healthy heartbeat reuses an older running worker",async()=>{
 const s=await setup();s.setRuns([{id:7,status:"in_progress",created_at:new Date(1).toISOString()}]);await workerHeartbeat(s.store,"7",200000,99000);
 assert.equal(await wakeWorker(s.store,s.options),"active");assert.equal(s.calls.length,1);
});
test("stale, stopped and nearly ending runners need another run",async()=>{
 for(const values of [{heartbeatAt:1,deadline:200000,state:"running"},{heartbeatAt:99000,deadline:110000,state:"running"},{heartbeatAt:99000,deadline:200000,state:"finished"}]){
  const s=await setup();s.setRuns([{id:7,status:"in_progress",created_at:new Date(1).toISOString()}]);await s.store.put("locks",{_id:"worker-runtime",runId:"7",...values});
  assert.equal(await wakeWorker(s.store,s.options),"dispatched");
 }
});
test("completed runs cannot suppress a wake",async()=>{
 const s=await setup();s.setRuns([{id:7,status:"completed",created_at:new Date(90000).toISOString()}]);assert.equal(await wakeWorker(s.store,s.options),"dispatched");
});
test("empty and terminal queues do not start workers",async()=>{
 const s=await setup();await s.store.patch("drafts","draft",{state:"FINALIZED"});await s.store.create("requests",{_id:"paid",status:"PAID"});await s.store.create("cards",{_id:"ready",state:"READY"});
 assert.equal(await hasPendingWork(s.store),false);assert.equal(await wakeWorker(s.store,s.options),"idle");assert.equal(s.calls.length,0);
});
test("drafts, reviewer setup and active payment states are pending",async()=>{
 for(const [table,fields] of [["drafts",{state:"AWAITING_FINALITY"}],["cards",{state:"SETTING_UP"}],["requests",{status:"REVIEWING"}],["requests",{status:"APPROVED"}]] as const){
  const store=new MemoryStore();await store.create(table,{_id:"job",...fields});assert.equal(await hasPendingWork(store),true);
 }
});
test("GitHub errors retain jobs and allow delayed retry",async()=>{
 for(const [lookup,dispatch] of [[401,204],[200,403],[200,500]]){
  const s=await setup();s.setStatuses(lookup,dispatch);assert.equal(await wakeWorker(s.store,s.options),"failed");assert.equal((await s.store.get("drafts","draft"))?.state,"QUEUED");
  assert.equal((await s.store.get("locks","worker-wake"))?.leaseUntil,0);assert.equal(await wakeWorker(s.store,s.options),"coalesced");
  s.setClock(106000);s.setStatuses(200,204);assert.equal(await wakeWorker(s.store,s.options),"dispatched");
 }
});
test("network exceptions do not expose tokens and release the lease",async()=>{
 const s=await setup();assert.equal(await wakeWorker(s.store,{...s.options,fetcher:async()=>{throw Error("private upstream response "+config.token)}}),"failed");assert.equal((await s.store.get("locks","worker-wake"))?.leaseUntil,0);
});
test("malformed data fails without consuming queue records",async()=>{
 const s=await setup();assert.equal(await wakeWorker(s.store,{...s.options,fetcher:async()=>Response.json({})}),"failed");assert.ok(await s.store.get("drafts","draft"));
});
test("disabled and invalid configuration never call GitHub",async()=>{
 const s=await setup(),previous=process.env.GITHUB_WORKER_TOKEN;delete process.env.GITHUB_WORKER_TOKEN;
 try{assert.equal(await wakeWorker(s.store,{fetcher:s.options.fetcher}),"disabled");}finally{if(previous!==undefined)process.env.GITHUB_WORKER_TOKEN=previous}
 assert.equal(await wakeWorker(s.store,{...s.options,config:{...config,repository:"../bad/path"}}),"failed");assert.equal(s.calls.length,0);
});
test("finish clears cooldown and cannot overwrite another runner",async()=>{
 const store=new MemoryStore();await workerHeartbeat(store,"7",200000,99000);await store.put("locks",{_id:"worker-wake",nextAt:200000});
 await finishWorker(store,"7");assert.equal((await store.get("locks","worker-runtime"))?.state,"finished");assert.equal((await store.get("locks","worker-wake"))?.nextAt,0);
 await workerHeartbeat(store,"8",300000,100000);await finishWorker(store,"7");assert.equal((await store.get("locks","worker-runtime"))?.state,"running");
});
