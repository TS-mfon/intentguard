import type {Store,Doc} from "./store";
import {activeStatuses} from "./models";

export type WakeConfiguration={token:string;repository:string;workflow:string;ref:string};
export type WakeOutcome="disabled"|"coalesced"|"idle"|"active"|"dispatched"|"failed";
type Runtime=Doc&{runId:string;deadline:number;heartbeatAt:number;state:string};
type Run={id:number;status:string;created_at:string;run_started_at?:string};
type Options={config?:WakeConfiguration;fetcher?:typeof fetch;now?:()=>number};
const queuedStatuses=new Set(["queued","requested","waiting","pending"]);
export async function hasPendingWork(store:Store){
 for(const [table,query] of [["drafts",{state:{$in:["QUEUED","AWAITING_FINALITY"]}}],["cards",{state:"SETTING_UP"}],["requests",{status:{$in:activeStatuses}}]] as const){
  if((await store.find(table,query,{limit:1})).length)return true;
 }
 return false;
}
export function wakeConfiguration():WakeConfiguration|undefined{
 const token=process.env.GITHUB_WORKER_TOKEN,repository=process.env.GITHUB_WORKER_REPOSITORY;
 if(!token||!repository)return undefined;
 return {token,repository,workflow:process.env.GITHUB_WORKER_WORKFLOW??"worker.yml",ref:process.env.GITHUB_WORKER_REF??"main"};
}
/** A durable, short-lived coordinator prevents a burst of API admissions from
 * dispatching one Actions run per request. Queue records remain authoritative. */
export async function wakeWorker(store:Store,options:Options={}):Promise<WakeOutcome>{
 const cfg=options.config??wakeConfiguration();
 if(!cfg)return "disabled";
 if(!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(cfg.repository)||!cfg.workflow||!cfg.ref)return "failed";
 const now=options.now??Date.now,fetcher=options.fetcher??fetch;
 let lock:Doc|null=null,outcome:WakeOutcome="failed";
 try{
  await store.create("locks",{_id:"worker-wake",createdAt:now()});
  lock=await store.claim("locks",{_id:"worker-wake"},now(),30000);
  if(!lock)return "coalesced";
  if(!await hasPendingWork(store)){outcome="idle";return outcome;}
  const base="https://api.github.com/repos/"+cfg.repository+"/actions/workflows/"+encodeURIComponent(cfg.workflow);
  const headers={Accept:"application/vnd.github+json",Authorization:"Bearer "+cfg.token,"X-GitHub-Api-Version":"2022-11-28"};
  const listed=await fetcher(base+"/runs?branch="+encodeURIComponent(cfg.ref)+"&per_page=100",{headers,redirect:"error",signal:AbortSignal.timeout(8000)});
  if(!listed.ok)throw Error("GitHub worker lookup failed");
  const data=await listed.json() as {workflow_runs?:Run[]};
  if(!Array.isArray(data.workflow_runs))throw Error("Invalid GitHub worker response");
  const runtime=await store.get<Runtime>("locks","worker-runtime");
  const active=data.workflow_runs.some(run=>{
   if(queuedStatuses.has(run.status))return true;
   if(run.status!=="in_progress")return false;
   if(runtime?.runId===String(run.id))return runtime.state==="running"&&runtime.heartbeatAt>now()-30000&&runtime.deadline>now()+15000;
   // A fresh runner may still be installing dependencies before its heartbeat.
   const started=Date.parse(run.run_started_at??run.created_at);
   return Number.isFinite(started)&&started>now()-90000;
  });
  if(active){outcome="active";return outcome;}
  const dispatched=await fetcher(base+"/dispatches",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({ref:cfg.ref,inputs:{duration_seconds:"180"}}),redirect:"error",signal:AbortSignal.timeout(8000)});
  if(dispatched.status!==204)throw Error("GitHub worker dispatch failed");
  outcome="dispatched";return outcome;
 }catch{
  // Neither upstream error bodies nor credentials belong in logs or API errors.
  console.error("Worker wake failed; the durable queue is retained for recovery.");
  return "failed";
 }finally{
  if(lock)try{await store.complete("locks","worker-wake",String(lock.leaseToken),{outcome,updatedAt:now(),nextAt:now()+(outcome==="failed"?5000:outcome==="idle"?0:15000)});}catch{console.error("Worker wake coordinator could not release; its lease will expire.");}
 }
}
export async function workerHeartbeat(store:Store,runId:string,deadline:number,now=Date.now()){
 await store.put("locks",{_id:"worker-runtime",runId,deadline,heartbeatAt:now,state:"running",createdAt:now});
}
export async function finishWorker(store:Store,runId:string){
 const runtime=await store.get<Runtime>("locks","worker-runtime");
 if(runtime?.runId===runId)await store.patch("locks","worker-runtime",{state:"finished",deadline:0,heartbeatAt:Date.now()});
 // Clear the short admission cooldown so the ending run can hand off work.
 await store.patch("locks","worker-wake",{nextAt:0});
 await wakeWorker(store);
}
