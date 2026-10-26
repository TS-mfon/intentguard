import {PendingFinality} from "./genlayer";
import type {Store,Doc} from "./store";
export async function assertSigningLease(store:Store,table:string,id:string,token?:string){
 if(!token)return; // Explicit operator tools do not masquerade as leased workers.
 const [job,lock]=await Promise.all([store.get<Doc>(table,id),store.get<Doc>("locks","worker")]),now=Date.now();
 if(job?.leaseToken!==token||Number(job?.leaseUntil)<=now||!lock||Number(lock.leaseUntil)<=now)throw new PendingFinality("Worker signing lease is no longer held");
}
