
import type {CardView,PaymentInput,RequestView} from "../shared";
export class IntentGuard{
 constructor(private baseUrl:string,private apiKey:string){}
 private async call<T>(path:string,init:RequestInit={}):Promise<T>{const r=await fetch(this.baseUrl.replace(/\/$/,"")+"/api/v1"+path,{...init,headers:{"Content-Type":"application/json",Authorization:"Bearer "+this.apiKey,...init.headers}});const value=await r.json();if(!r.ok)throw Error(value.error?.message??"IntentGuard request failed");return value as T}
 me(){return this.call<{card:CardView}>("/me")}
 request(payment:PaymentInput,idempotencyKey:string){return this.call<{id:string;status:string}>("/requests",{method:"POST",headers:{"Idempotency-Key":idempotencyKey},body:JSON.stringify(payment)})}
 get(id:string){return this.call<RequestView>("/requests/"+encodeURIComponent(id))}
 async wait(id:string,{timeoutMs=600000,intervalMs=5000}={}){const end=Date.now()+timeoutMs;while(Date.now()<end){const r=await this.get(id);if(["PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","EXPIRED","CANCELLED"].includes(r.status))return r;await new Promise(r=>setTimeout(r,intervalMs))}throw Error("Request remains pending; poll the same request ID")}
}
