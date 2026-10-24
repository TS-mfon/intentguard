export type WorkerRunOptions = {
 durationSeconds?:number;
 signal?:AbortSignal;
 pollIntervalMs?:number;
 maxConsecutiveFailures?:number;
 now?:()=>number;
 sleep?:(ms:number,signal?:AbortSignal)=>Promise<void>;
 onError?:(error:unknown)=>void;
};
export type WorkerRunSummary = {ticks:number;processed:number;failures:number;reason:"duration"|"signal"};
export class WorkerConnectivityError extends Error {
 constructor(public summary:WorkerRunSummary){super("Worker stopped after repeated storage or connectivity failures.");}
}
const wait=(ms:number,signal?:AbortSignal)=>new Promise<void>(resolve=>{
 if(signal?.aborted){resolve();return;}
 const done=()=>{clearTimeout(timer);signal?.removeEventListener("abort",done);resolve();};
 const timer=setTimeout(done,ms);signal?.addEventListener("abort",done,{once:true});
});
/** Complete each claimed tick before stopping. Mongo leases and transaction
 * journals recover operations interrupted by the runner's external hard timeout. */
export async function runWorker(tick:()=>Promise<boolean>,options:WorkerRunOptions={}):Promise<WorkerRunSummary>{
 const {durationSeconds,signal}=options;
 if(durationSeconds!==undefined&&(!Number.isInteger(durationSeconds)||durationSeconds<1||durationSeconds>86400))throw Error("Worker duration must be an integer between 1 and 86400 seconds.");
 const poll=options.pollIntervalMs??2000,maxFailures=options.maxConsecutiveFailures??3;
 if(!Number.isFinite(poll)||poll<1||!Number.isInteger(maxFailures)||maxFailures<1)throw Error("Invalid worker polling or failure limit.");
 const now=options.now??(()=>performance.now()),sleep=options.sleep??wait;
 const deadline=durationSeconds===undefined?Infinity:now()+durationSeconds*1000;
 const summary:WorkerRunSummary={ticks:0,processed:0,failures:0,reason:"duration"};
 let consecutiveFailures=0;
 while(!signal?.aborted&&now()<deadline){
  let processed=false;
  try{
   processed=await tick();summary.ticks++;if(processed)summary.processed++;consecutiveFailures=0;
  }catch(error){
   summary.ticks++;summary.failures++;consecutiveFailures++;options.onError?.(error);
   if(consecutiveFailures>=maxFailures)throw new WorkerConnectivityError(summary);
  }
  if(signal?.aborted||now()>=deadline)break;
  if(!processed)await sleep(Math.min(poll,deadline-now()),signal);
 }
 summary.reason=signal?.aborted?"signal":"duration";
 return summary;
}
export function workerDuration(args:string[],environment:string|undefined):number|undefined{
 if(args.some(v=>v!=="--duration-seconds"&&!/^\d+$/.test(v)))throw Error("Use --duration-seconds followed by a positive integer.");
 const index=args.indexOf("--duration-seconds");
 if(index!==-1&&(index!==0||args.length!==2))throw Error("Use --duration-seconds followed by a positive integer.");
 if(index===-1&&args.length)throw Error("Unexpected worker arguments.");
 const raw=index!==-1?args[index+1]:environment;
 if(raw===undefined||raw==="")return undefined;
 if(!/^\d+$/.test(raw))throw Error("Worker duration must be a positive integer.");
 const value=Number(raw);if(!Number.isSafeInteger(value)||value<1||value>86400)throw Error("Worker duration must be between 1 and 86400 seconds.");return value;
}
