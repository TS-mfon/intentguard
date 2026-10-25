import {randomBytes} from "node:crypto";
import {digest,parseAmount,validateDecision,type RequestStatus,type PaymentInput} from "../../../packages/shared";
import type {Store,Doc} from "./store";
import type {Card,Payment,Draft,Job} from "./models";
import {activeStatuses,terminal} from "./models";
import type {EvmPort} from "./evm";
import {PendingFinality,GenLayerTerminalError,type GenLayerPort} from "./genlayer";
import {capture} from "./evidence";
export const requestId=()=>"0x"+randomBytes(32).toString("hex");
export function evidenceAllowed(card:Card,input:PaymentInput){
 const allowed=new Set([...card.policy.evidence.approvedOrigins,...card.policy.merchants.flatMap(m=>m.origins)].map(v=>new URL(v).origin));
 if(input.evidence.some(e=>!allowed.has(new URL(e.url).origin)))throw Error("Evidence origin is outside the owner permissions");
}
export function invoiceExpiry(card:Card,p:Payment,snapshots:Awaited<ReturnType<typeof capture>>,now:number){
 const merchant=card.policy.merchants.find(m=>m.recipient.toLowerCase()===p.input.recipient.toLowerCase());if(!merchant)throw Error("Merchant is not authorized");
 const origins=new Set(merchant.origins.map(o=>new URL(o).origin));
 for(const s of snapshots){if(!origins.has(new URL(s.url).origin))continue;let i;try{i=JSON.parse(s.content)}catch{continue}
 if(i.invoiceId!==p.input.invoiceId)continue;
 if(String(i.buyer).toLowerCase()!==card.address.toLowerCase()||String(i.token).toLowerCase()!==processToken(card)||Number(i.chainId)!==cardChain(card)||String(i.recipient).toLowerCase()!==p.input.recipient.toLowerCase()||parseAmount(String(i.amount))!==parseAmount(p.input.amount))throw Error("Invoice payment fields contradict this request");
 if(!Number.isSafeInteger(i.expiresAt)||!Number.isSafeInteger(i.issuedAt)||i.issuedAt>now||i.issuedAt<now-card.policy.evidence.maxAgeSeconds||i.expiresAt<=now)throw Error("Invoice is stale or expired");
 return Math.min(i.expiresAt,card.policy.financial.validUntil,now+86400);
 }throw Error("Provide a current invoice from the approved merchant origin");
}
function processToken(card:Card){return String(card.token??process.env.PAYMENT_TOKEN??"0x779ded0c9e1022225f8e0630b35a9b54be713736").toLowerCase()}
function cardChain(card:Card){return Number(card.chainId??(process.env.INTENTGUARD_MODE==="local"?process.env.XLAYER_CHAIN_ID??31337:196))}
export class Worker{
 constructor(private store:Store,private evm:EvmPort,private gl:GenLayerPort,private fetcher?:typeof import("./evidence").safeFetch){}
 async tick(){
 // One global durable lease serializes the signing nonces of this installation.
 await this.store.create("locks",{_id:"worker",createdAt:Date.now()});
 const lock=await this.store.claim<Job>("locks",{_id:"worker"},Date.now(),120000);if(!lock)return false;
 try{
 for(const [table,query]of [["drafts",{state:"QUEUED"}],["drafts",{state:"AWAITING_FINALITY"}],["cards",{state:"SETTING_UP"}],["requests",{status:{$in:activeStatuses}}]] as const){
 const job=await this.store.claim<Job>(table,query,Date.now(),120000);if(!job)continue;
 try{const values=table==="drafts"?await this.draft(job as Draft):table==="cards"?await this.card(job as Card):await this.payment(job as Payment);await this.store.complete(table,job._id,job.leaseToken!,{error:null,...values,updatedAt:Date.now(),attempts:0,nextAt:Date.now()+2000});}
 catch(e){
 if(e instanceof GenLayerTerminalError){
  const error=table==="drafts"?"GenLayer could not finalize this proposal successfully. Review the instructions and submit a new proposal.":table==="cards"?"GenLayer reviewer initialization failed. Retry initialization in My agents.":"GenLayer review failed. No payment was authorized; its reservation is being cancelled.";
  const values=table==="requests"?{status:"RETRYING",cancelTarget:"CANCELLED",reviewFailure:error}:{state:"FAILED"};
  await this.store.complete(table,job._id,job.leaseToken!,{...values,error,attempts:0,nextAt:0,updatedAt:Date.now()});
  console.error("GenLayer job reached terminal failure",{table,id:job._id});
 }else{
  const pending=e instanceof PendingFinality;const attempts=Number(job.attempts??0)+1;
  await this.store.complete(table,job._id,job.leaseToken!,{error:pending?null:"Processing is delayed. The worker will retry safely.",attempts,nextAt:Date.now()+(pending?5000:Math.min(60000,1000*2**Math.min(attempts,6))),updatedAt:Date.now()});
  if(!pending)console.error("IntentGuard job failed",{table,id:job._id,error:e instanceof Error?e.message:String(e)});
 }
}
 return true;
 }return false;
 }finally{await this.store.complete("locks","worker",lock.leaseToken!,{nextAt:0});}
 }
 private async draft(d:Draft){if(!d.genLayerTxHash)return {state:"AWAITING_FINALITY",genLayerTxHash:await this.gl.propose(d)};const result=await this.gl.draft(d);return {state:"FINALIZED",result};}
 private async card(c:Card){if(!c.reviewerTx)return {reviewerTx:await this.gl.deployReviewer(c)};return {state:"READY",reviewerAddress:await this.gl.reviewer(c)}}
 async payment(p:Payment):Promise<Record<string,unknown>>{
 const c=await this.store.get<Card>("cards",p.cardId);if(!c)throw Error("Card record missing");
 const chain=await this.evm.request(c,p._id);
 if(chain.status===2)return {status:"PAID",paymentTxHash:this.evm.paidHash?await this.evm.paidHash(c,p):(await this.store.get<Doc>("transactions",p._id+":settle"))?.hash??p.paymentTxHash};
 if(chain.status===3||chain.status===4)return {status:chain.status===4?"EXPIRED":p.cancelTarget??"CANCELLED",...(p.reviewFailure?{error:p.reviewFailure}:{})};
 const key=await this.store.get<Doc>("keys",p.keyId);const now=Math.floor(Date.now()/1000);
 if(p.cancelRequested||!key||key.revoked||(Object.hasOwn(c,"activeKeyId")&&c.activeKeyId!==p.keyId)||p.cancelTarget){await this.evm.cancel(c,p);return {status:p.cancelTarget??"CANCELLED",...(p.reviewFailure?{error:p.reviewFailure}:{})};}
 if(p.canonical&&p.canonical.expiresAt<=now){await this.evm.cancel(c,p);return {status:"EXPIRED"};}
 if(c.state!=="READY")throw new PendingFinality("Reviewer is being initialized");
 if(!p.canonical){
 const expiry=Math.min(c.policy.financial.validUntil,now+86400);
 const guard=await this.evm.preview(c,p.input,expiry);
 if(!guard.allow)return {status:"BLOCKED",guard};
 let snapshots,expiresAt;
 try{evidenceAllowed(c,p.input);snapshots=await capture(p.input,this.fetcher);expiresAt=invoiceExpiry(c,p,snapshots,now);}
 catch{return {status:"NEEDS_EVIDENCE",guard,error:"Provide matching, current public merchant evidence."};}
 const evidenceHash=digest(snapshots);
 const canonical={...p.input,cardId:c._id,cardAddress:c.address,owner:c.owner,policyHash:c.policyHash,token:processToken(c),chainId:cardChain(c),amountAtomic:parseAmount(p.input.amount).toString(),evidenceHash,expiresAt};
 return {canonical,snapshots,evidenceHash,requestHash:digest(canonical),guard};
 }
 // No broadcast until immutable evidence and request commitments were persisted by the prior tick.
 if(chain.status===0){const guard=await this.evm.preview(c,p.input,p.canonical.expiresAt);if(!guard.allow)return {status:"BLOCKED",guard};const txHash=await this.evm.reserve(c,p);return {status:"RESERVED",guard:{allow:true,failures:[],txHash}};}
 if(chain.status!==1)throw Error("Unknown onchain state");
 if(chain.requestHash!==p.requestHash||chain.evidenceHash!==p.evidenceHash||chain.recipient.toLowerCase()!==p.canonical.recipient.toLowerCase()||chain.amount!==BigInt(p.canonical.amountAtomic))throw Error("Reservation commitment mismatch");
 if(!p.genLayerTxHash)return {status:"AWAITING_FINALITY",genLayerTxHash:await this.gl.submit(c,p)};
 const review=validateDecision(await this.gl.decision(c,p),c.policy,p.canonical,p.requestHash!);
 if(review.decision!=="APPROVE"){
 // Persist the cancellation intent before sending; a crashed cancellation retains the semantic result.
 const rejectedStatus=review.decision==="REJECT"?"REJECTED":"NEEDS_EVIDENCE";
 if(!p.cancelTarget)return {review,cancelTarget:rejectedStatus,status:"REVIEWING"};
 await this.evm.cancel(c,p);return {review,status:rejectedStatus};
 }
 if(!p.review)return {status:"APPROVED",review};
 // Finality and exact commitment are rechecked immediately before attesting.
 const latest=validateDecision(await this.gl.decision(c,p),c.policy,p.canonical,p.requestHash!);
 if(digest(latest)!==digest(p.review))throw Error("Finalized stored review changed");
 return {status:"PAID",paymentTxHash:await this.evm.settle(c,{...p,review:latest})};
 }
}
