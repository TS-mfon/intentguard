import type {CardView,PaymentInput,RequestView} from "../shared";
export type ProtocolErrorDetail={field?:string;code?:string;message?:string};
export class IntentGuardError extends Error{
 constructor(message:string,public status:number,public code:string,public retryable:boolean,public requestId?:string,public retryAfterSeconds?:number,public details?:unknown){super(message);this.name="IntentGuardError";}
}
export class IntentGuard{
 constructor(private baseUrl:string,private apiKey:string){}
 private async call<T>(path:string,init:RequestInit={}):Promise<T>{
  const headers=new Headers(init.headers);headers.set("Accept","application/json");headers.set("Authorization","Bearer "+this.apiKey);if(init.body)headers.set("Content-Type","application/json");
  let r:Response;try{r=await fetch(this.baseUrl.replace(/\/$/,"")+"/api/v1"+path,{...init,headers,signal:init.signal??AbortSignal.timeout(20000),redirect:"error"})}catch{throw new IntentGuardError("IntentGuard transport unavailable. Preserve the operation ID and Idempotency-Key.",0,"TRANSPORT_UNAVAILABLE",true)}
  let value;try{value=await r.json()}catch{throw new IntentGuardError("IntentGuard returned a non-JSON response.",r.status,"INVALID_RESPONSE",true,r.headers.get("x-request-id")??undefined)}
  if(!r.ok){const e=value.error??{};throw new IntentGuardError(String(e.message??"IntentGuard request failed").replaceAll(this.apiKey,"[REDACTED]"),r.status,e.code??"HTTP_ERROR",e.retryable??(r.status===429||r.status>=500),e.requestId??r.headers.get("x-request-id")??undefined,Number(r.headers.get("retry-after"))||undefined,e.details)}
  return value as T;
 }
 me(){return this.call<{card:CardView}>("/me")}
 request(payment:PaymentInput,idempotencyKey:string){return this.call<{id:string;status:string}>("/requests",{method:"POST",headers:{"Idempotency-Key":idempotencyKey},body:JSON.stringify(payment)})}
 get(id:string,signal?:AbortSignal){return this.call<RequestView>("/requests/"+encodeURIComponent(id),{signal})}
 async wait(id:string,{timeoutMs=600000,intervalMs=5000,signal}:{timeoutMs?:number;intervalMs?:number;signal?:AbortSignal}={}){
  if(!Number.isFinite(timeoutMs)||timeoutMs<0||!Number.isFinite(intervalMs)||intervalMs<100)throw new IntentGuardError("Use a nonnegative timeout and polling interval of at least 100 ms.",0,"INVALID_WAIT_OPTIONS",false);
  const end=Date.now()+timeoutMs;
  while(Date.now()<end){
   signal?.throwIfAborted();const r=await this.get(id,signal);if(["PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","EXPIRED","CANCELLED"].includes(r.status))return r;
   const delay=Math.min(intervalMs,Math.max(0,end-Date.now()));
   if(delay)await new Promise<void>((resolve,reject)=>{const cleanup=()=>signal?.removeEventListener("abort",abort),timer=setTimeout(()=>{cleanup();resolve()},delay),abort=()=>{clearTimeout(timer);cleanup();reject(signal?.reason??new Error("Polling aborted"))};signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();});
  }
  throw new IntentGuardError("Request remains pending; poll the same request ID. Do not create a new payment because polling timed out.",0,"POLL_TIMEOUT",true);
 }
}
