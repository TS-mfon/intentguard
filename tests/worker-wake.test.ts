import {test} from "node:test";
import assert from "node:assert/strict";
import {MemoryStore} from "../apps/web/lib/store";
import {wakeWorker,hasPendingWork,workerHeartbeat,finishWorker,workerKeepAliveUntil,wakeConfiguration,type WakeConfiguration} from "../apps/web/lib/worker-wake";
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
test("bounded testnet keep-alive dispatches an idle queue once and stops at expiry",async()=>{
 const s=await setup();await s.store.patch("drafts","draft",{state:"FINALIZED"});
 const options={...s.options,config:{...config,keepAliveUntil:200000}};
 const outcomes=await Promise.all(Array.from({length:20},()=>wakeWorker(s.store,options)));
 assert.equal(outcomes.filter(value=>value==="dispatched").length,1);assert.equal(s.calls.filter(call=>call.init?.method==="POST").length,1);
 assert.equal(await hasPendingWork(s.store),false);
 s.setClock(200000);assert.equal(await wakeWorker(s.store,options),"idle");assert.equal(s.calls.length,2);
});
test("keep-alive cannot target mainnet another ref or an invalid or overlong window",async()=>{
 for(const changes of [{workflow:"worker-mainnet.yml"},{ref:"other"},{keepAliveUntil:100000},{keepAliveUntil:NaN},{keepAliveUntil:Infinity},{keepAliveUntil:200000.5},{keepAliveUntil:100001+73*60*60*1000}]){
  const s=await setup();await s.store.patch("drafts","draft",{state:"FINALIZED"});
  assert.equal(await wakeWorker(s.store,{...s.options,config:{...config,keepAliveUntil:200000,...changes}}),"idle");assert.equal(s.calls.length,0);
 }
});
test("idle keep-alive reuses a healthy runner and expired keep-alive retains pending work",async()=>{
 const s=await setup();await s.store.patch("drafts","draft",{state:"FINALIZED"});s.setRuns([{id:7,status:"in_progress",created_at:new Date(1).toISOString()}]);await workerHeartbeat(s.store,"7",300000,99000);
 assert.equal(await wakeWorker(s.store,{...s.options,config:{...config,keepAliveUntil:200000}}),"active");assert.equal(s.calls.length,1);
 const pending=await setup();assert.equal(await wakeWorker(pending.store,{...pending.options,config:{...config,keepAliveUntil:1}}),"dispatched");assert.equal((await pending.store.get("drafts","draft"))?.state,"QUEUED");
});
test("keep-alive accepts only a canonical future UTC deadline within 73 hours",()=>{
 assert.equal(workerKeepAliveUntil(new Date(200000).toISOString(),100000),200000);
 for(const value of [undefined,"","not a date","1970-01-01",new Date(100000).toISOString(),new Date(100001+73*60*60*1000).toISOString()])assert.equal(workerKeepAliveUntil(value,100000),undefined);
});
test("keep-alive environment configuration is limited to the isolated testnet worker",()=>{
 const names=["INTENTGUARD_MODE","INTENTGUARD_PAYMENT_ENV","XLAYER_CHAIN_ID","GITHUB_WORKER_TOKEN","GITHUB_WORKER_REPOSITORY","GITHUB_WORKER_WORKFLOW","GITHUB_WORKER_REF","INTENTGUARD_WORKER_KEEPALIVE_UNTIL","INTENTGUARD_SOURCE_COMMIT","MONGODB_DB","APP_URL","FRONTEND_URL"];
 const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 try{
  Object.assign(process.env,{INTENTGUARD_MODE:"testnet",INTENTGUARD_PAYMENT_ENV:"testnet",XLAYER_CHAIN_ID:"1952",MONGODB_DB:"intentguard",APP_URL:"https://testnet.example",FRONTEND_URL:"https://testnet.example",GITHUB_WORKER_TOKEN:config.token,GITHUB_WORKER_REPOSITORY:config.repository,GITHUB_WORKER_WORKFLOW:"worker.yml",GITHUB_WORKER_REF:"main",INTENTGUARD_WORKER_KEEPALIVE_UNTIL:new Date(Date.now()+600000).toISOString(),INTENTGUARD_SOURCE_COMMIT:"a".repeat(40)});
  assert.ok(wakeConfiguration()?.keepAliveUntil);
  process.env.GITHUB_WORKER_REF="other";assert.equal(wakeConfiguration()?.keepAliveUntil,undefined);
  Object.assign(process.env,{INTENTGUARD_MODE:"mainnet",INTENTGUARD_PAYMENT_ENV:"mainnet",XLAYER_CHAIN_ID:"196",MONGODB_DB:"intentguard_mainnet",GITHUB_WORKER_WORKFLOW:"worker-mainnet.yml",GITHUB_WORKER_REF:"main"});
  assert.equal(wakeConfiguration()?.keepAliveUntil,undefined);
 }finally{for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}}
});
test("an idle keep-alive cannot dispatch after its deadline passes during lookup",async()=>{
 const s=await setup();await s.store.patch("drafts","draft",{state:"FINALIZED"});
 const fetcher:typeof fetch=async(url,init)=>{const response=await s.options.fetcher(url,init);if(init?.method!=="POST")s.setClock(200000);return response;};
 assert.equal(await wakeWorker(s.store,{...s.options,fetcher,config:{...config,keepAliveUntil:200000}}),"idle");assert.equal(s.calls.length,1);
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
