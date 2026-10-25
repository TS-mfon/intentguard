import {database} from "../web/lib/store";
import {configuration} from "../web/lib/config";
import {Evm} from "../web/lib/evm";
import {GenLayer} from "../web/lib/genlayer";
import {Worker} from "../web/lib/worker";
import {workerHeartbeat,finishWorker} from "../web/lib/worker-wake";
import {runWorker,workerDuration,WorkerConnectivityError} from "./runner";
const durationSeconds=workerDuration(process.argv.slice(2),process.env.INTENTGUARD_WORKER_DURATION_SECONDS);
if(!configuration().configured)throw Error("Configure MongoDB, the payment testnet and GenLayer before running the worker.");
for(const name of ["XLAYER_OPERATOR_PRIVATE_KEY","REVIEW_ATTESTOR_PRIVATE_KEY","GENLAYER_OPERATOR_PRIVATE_KEY"]){
 if(!process.env[name])throw Error(name+" is required");
}
const shutdown=new AbortController();
process.once("SIGTERM",()=>shutdown.abort());process.once("SIGINT",()=>shutdown.abort());
try{
 const store=await database(),worker=new Worker(store,new Evm(store),new GenLayer(store));
 console.log("IntentGuard worker running; durable jobs and real integrations enabled.");
 const runId=process.env.GITHUB_RUN_ID,deadline=durationSeconds===undefined?Number.MAX_SAFE_INTEGER:Date.now()+durationSeconds*1000;
 const summary=await runWorker(async()=>{
  if(runId)await workerHeartbeat(store,runId,deadline);
  return worker.tick();
 },{
  durationSeconds,signal:shutdown.signal,
  onError:()=>console.error("Worker storage/connectivity failure; retrying the durable queue.")
 });
 if(runId)await finishWorker(store,runId);
 console.log("WORKER_RUN_COMPLETED",JSON.stringify(summary));
 // MongoClient owns sockets; each tick released its leases before this exit.
 process.exit(0);
}catch(error){
 console.error(error instanceof WorkerConnectivityError?error.message:"Worker could not initialize or complete its durable run.");
 process.exit(1);
}
