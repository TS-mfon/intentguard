import {randomBytes} from "node:crypto";
import {isSettlementV2,digest,parseAmount,validateDecision,type RequestStatus,type PaymentInput} from "../../../packages/shared";
import type {Store,Doc} from "./store";
import type {Card,Payment,Draft,Job} from "./models";
import {activeStatuses,terminal} from "./models";
import type {EvmPort} from "./evm";
import {PendingFinality,GenLayerTerminalError,type GenLayerPort} from "./genlayer";
import {canonicalDestination,paymentDestination,isBridge,assertCardEnvironment} from "./settlement";
import {BridgePending,BridgeFailure} from "./cctp";
import {capture,EvidenceFailure} from "./evidence";
export const requestId=()=>"0x"+randomBytes(32).toString("hex");
export function evidenceAllowed(card:Card,input:PaymentInput){
 const allowed=new Set([...card.policy.evidence.approvedOrigins,...card.policy.merchants.flatMap(m=>m.origins)].map(v=>new URL(v).origin));
 if(input.evidence.some(e=>!allowed.has(new URL(e.url).origin)))throw Error("Evidence origin is outside the owner permissions");
}
export function invoiceExpiry(card:Card,p:Payment,snapshots:Awaited<ReturnType<typeof capture>>,now:number){
 const merchant=card.policy.merchants.find(m=>m.recipient.toLowerCase()===p.input.recipient.toLowerCase());if(!merchant)throw Error("Merchant is not authorized");
 const origins=new Set(merchant.origins.map(o=>new URL(o).origin));
 for(const s of snapshots){if(!origins.has(new URL(s.url).origin))continue;let i;try{i=JSON.parse(s.content) as Record<string,any>}catch{continue}
 if(i.invoiceId!==p.input.invoiceId)continue;
 if(String(i.buyer).toLowerCase()!==card.address.toLowerCase())throw new EvidenceFailure("INVOICE_BUYER_MISMATCH","Invoice buyer must be this agent's vault address.");
 const destination=paymentDestination(card,p.input);
 if(String(i.token).toLowerCase()!==destination.token||Number(i.chainId)!==destination.chainId)throw new EvidenceFailure("INVOICE_ASSET_MISMATCH","Invoice chain and token must match this agent's immutable payment configuration.");
 if(String(i.recipient).toLowerCase()!==p.input.recipient.toLowerCase())throw new EvidenceFailure("INVOICE_RECIPIENT_MISMATCH","Invoice recipient must match the requested merchant.");
 let invoiceAmount:bigint;try{invoiceAmount=parseAmount(String(i.amount))}catch{throw new EvidenceFailure("INVOICE_AMOUNT_INVALID","Invoice amount must be an exact decimal string with at most six places.");}
 if(invoiceAmount!==parseAmount(p.input.amount))throw new EvidenceFailure("INVOICE_AMOUNT_MISMATCH","Invoice amount must equal the payment request exactly.");
 if(!Number.isSafeInteger(i.expiresAt)||!Number.isSafeInteger(i.issuedAt)||i.issuedAt>now||i.issuedAt<now-card.policy.evidence.maxAgeSeconds||i.expiresAt<=now)throw new EvidenceFailure("INVOICE_STALE","Invoice must be current, unexpired and within the owner-approved evidence age.");
 return Math.min(i.expiresAt,card.policy.financial.validUntil,now+86400);
 }throw new EvidenceFailure("INVOICE_REQUIRED","Provide a matching current invoice from the approved merchant origin.");
}
function processToken(card:Card){return String(card.token??process.env.PAYMENT_TOKEN??"0x779ded0c9e1022225f8e0630b35a9b54be713736").toLowerCase()}
function cardChain(card:Card){return Number(card.chainId??(process.env.INTENTGUARD_MODE==="local"?process.env.XLAYER_CHAIN_ID??31337:196))}
export class Worker{
 constructor(private store:Store,private evm:EvmPort,private gl:GenLayerPort,private fetcher?:typeof import("./evidence").safeFetch){}
 async tick(){
 // One global durable lease serializes the signing nonces of this installation.
 await this.store.create("locks",{_id:"worker",createdAt:Date.now()});
 const lock=await this.store.claim<Job>("locks",{_id:"worker"},Date.now(),120000);if(!lock)return false;
 let nextQueue=Number(lock.nextQueue??0)%4;
 try{
 const queues=[["drafts",{state:"QUEUED"}],["drafts",{state:"AWAITING_FINALITY"}],["cards",{state:"SETTING_UP"}],["requests",{status:{$in:activeStatuses}}]] as const;
 for(let offset=0;offset<queues.length;offset++){
 const index=(Number(lock.nextQueue??0)+offset)%queues.length,[table,query]=queues[index];
 const job=await this.store.claim<Job>(table,query,Date.now(),120000);if(!job)continue;
 nextQueue=(index+1)%queues.length;
 try{const values=table==="drafts"?await this.draft(job as Draft):table==="cards"?await this.card(job as Card):await this.payment(job as Payment);await this.store.complete(table,job._id,job.leaseToken!,{error:null,errorCode:null,waitStartedAt:null,...values,updatedAt:Date.now(),attempts:0,nextAt:Date.now()+2000});}
 catch(e){
 if(table==="requests"&&(e instanceof BridgePending||e instanceof BridgeFailure||["BRIDGING","AWAITING_ATTESTATION","MINTING"].includes(String(job.status)))){
  // A finalized burn cannot be cancelled/refunded by an API status or timeout.
  const attempts=Number(job.attempts??0)+1;await this.store.complete(table,job._id,job.leaseToken!,{status:["BRIDGING","AWAITING_ATTESTATION","MINTING"].includes(String(job.status))?job.status:"BRIDGING",error:e instanceof BridgePending||e instanceof BridgeFailure?e.message:"Bridge processing is delayed. The existing source burn remains in reconciliation.",errorCode:e instanceof BridgePending||e instanceof BridgeFailure?e.code:"BRIDGE_PROCESSING_DELAYED",attempts,nextAt:Date.now()+60000,updatedAt:Date.now()});
 }else if(e instanceof GenLayerTerminalError||Date.now()-Number(job.waitStartedAt??Date.now())>30*60*1000||(table==="requests"&&job.processingStartedAt!==undefined&&Date.now()-Number(job.processingStartedAt)>30*60*1000)){
  const error=table==="drafts"?"GenLayer could not finalize this proposal successfully. Review the instructions and submit a new proposal.":table==="cards"?"GenLayer reviewer initialization failed. Retry initialization in My agents.":"GenLayer review failed. No payment was authorized; its reservation is being cancelled.";
  const timedOut=!(e instanceof GenLayerTerminalError);
  const values=table==="requests"?{status:"RETRYING",cancelTarget:"CANCELLED",reviewFailure:error}:{state:"FAILED"};
  await this.store.complete(table,job._id,job.leaseToken!,{...values,error,errorCode:timedOut?"PROCESSING_TIMEOUT":"GENLAYER_REVIEW_FAILED",attempts:0,nextAt:0,updatedAt:Date.now()});
  console.error("GenLayer job reached terminal failure",{table,id:job._id});
 }else{
  const pending=e instanceof PendingFinality;const attempts=Number(job.attempts??0)+1;
  await this.store.complete(table,job._id,job.leaseToken!,{error:pending?null:"Processing is delayed. The worker will retry safely.",errorCode:pending?null:"PROCESSING_DELAYED",waitStartedAt:job.waitStartedAt??Date.now(),attempts,nextAt:Date.now()+(pending?5000:Math.min(60000,1000*2**Math.min(attempts,6))),updatedAt:Date.now()});
  if(!pending)console.error("IntentGuard job failed",{table,id:job._id,errorType:e instanceof Error?e.name:"UnknownError"});
 }
}
 return true;
 }return false;
 }finally{await this.store.complete("locks","worker",lock.leaseToken!,{nextAt:0,nextQueue});}
 }
 private async draft(d:Draft){if(!d.genLayerTxHash)return {state:"AWAITING_FINALITY",genLayerTxHash:await this.gl.propose(d)};const result=await this.gl.draft(d);return {state:"FINALIZED",result};}
 private async card(c:Card){assertCardEnvironment(c);const reviewerVersion=c.settlement&&isSettlementV2(c.settlement)?4:c.settlement?3:2;if(!c.reviewerTx)return {reviewerTx:await this.gl.deployReviewer({...c,reviewerVersion}),reviewerVersion};return {state:"READY",reviewerAddress:await this.gl.reviewer(c)}}
 async payment(p:Payment):Promise<Record<string,unknown>>{
 const c=await this.store.get<Card>("cards",p.cardId);if(!c)throw Error("Card record missing");assertCardEnvironment(c);
 const chain=await this.evm.request(c,p._id);
 if(chain.status===5||(chain.status===2&&isBridge(c,p))){if(!p.canonical||!p.requestHash||digest(p.canonical)!==p.requestHash||chain.requestHash!==p.requestHash||chain.evidenceHash!==p.evidenceHash||chain.recipient.toLowerCase()!==p.canonical.recipient.toLowerCase()||chain.amount!==BigInt(p.canonical.amountAtomic))throw new BridgeFailure("BRIDGE_COMMITMENT_MISMATCH","The bridge request differs from its immutable source reservation.");if(!this.evm.reconcileBridge)throw new BridgePending("BRIDGE_WORKER_UNAVAILABLE","The bridge worker is not available yet. Preserve this request ID.");try{return await this.evm.reconcileBridge(c,p)}catch(error){if(error instanceof BridgePending||error instanceof BridgeFailure)throw error;throw new BridgePending("BRIDGE_PROCESSING_DELAYED","Bridge processing is delayed. The existing burn remains durable; the worker will resume the same message.");}}
 if(chain.status===2)return {status:"PAID",paymentTxHash:await this.evm.paidHash(c,p)};
 if(chain.status===3||chain.status===4)return {status:chain.status===4?"EXPIRED":p.cancelTarget??"CANCELLED",...(p.reviewFailure?{error:"GenLayer review failed. No payment was authorized; its reservation has been released.",errorCode:p.errorCode??"GENLAYER_REVIEW_FAILED"}:{})};
 const key=await this.store.get<Doc>("keys",p.keyId);const now=Math.floor(Date.now()/1000);
 if(p.cancelRequested||!key||key.revoked||(Object.hasOwn(c,"activeKeyId")&&c.activeKeyId!==p.keyId)||p.cancelTarget){await this.evm.cancel(c,p);return {status:p.cancelTarget??"CANCELLED",...(p.reviewFailure?{error:"GenLayer review failed. No payment was authorized; its reservation has been released.",errorCode:p.errorCode??"GENLAYER_REVIEW_FAILED"}:{})};}
 if(p.canonical&&p.canonical.expiresAt<=now){await this.evm.cancel(c,p);return {status:"EXPIRED"};}
 if(chain.status===1&&Date.now()-Number(p.processingStartedAt??p.createdAt)>=30*60*1000){await this.evm.cancel(c,p);return {status:"CANCELLED",errorCode:"PROCESSING_TIMEOUT",error:"The pre-burn processing deadline elapsed. No payment was authorized; the reservation was released."};}
 if(c.state!=="READY")throw new PendingFinality("Reviewer is being initialized");
 if(!p.canonical){
 const expiry=Math.min(c.policy.financial.validUntil,now+86400);
 const guard=await this.evm.preview(c,p.input,expiry);
 if(!guard.allow)return {status:"BLOCKED",guard};
 let snapshots,expiresAt;
 try{evidenceAllowed(c,p.input);snapshots=await capture(p.input,this.fetcher);expiresAt=invoiceExpiry(c,p,snapshots,Math.floor(Date.now()/1000));}
 catch(error){return {status:"NEEDS_EVIDENCE",guard,error:error instanceof EvidenceFailure?error.message:"Evidence could not be verified. Provide matching, current public merchant evidence and retry with a new idempotency key.",errorCode:error instanceof EvidenceFailure?error.code:"EVIDENCE_UNAVAILABLE"};}
 const evidenceHash=digest(snapshots);
 const {destinationChainId:submittedDestination,...original}=p.input;
 const canonical={...original,...canonicalDestination(c,p.input),cardId:c._id,cardAddress:c.address,owner:c.owner,policyHash:c.policyHash,token:processToken(c),chainId:cardChain(c),amountAtomic:parseAmount(p.input.amount).toString(),evidenceHash,expiresAt};
 return {canonical,snapshots,evidenceHash,requestHash:digest(canonical),guard};
 }
 // No broadcast until immutable evidence and request commitments were persisted by the prior tick.
 if(chain.status===0){const guard=await this.evm.preview(c,p.input,p.canonical.expiresAt);if(!guard.allow)return {status:"BLOCKED",guard};const txHash=await this.evm.reserve(c,p);return {status:"RESERVED",processingStartedAt:Date.now(),guard:{allow:true,failures:[],txHash}};}
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
 // A review may wait on the network while the owner revokes credentials.
 // Reload authorization and commitments after the last asynchronous review.
 const fresh=await this.store.get<Payment>("requests",p._id),current=await this.store.get<Card>("cards",p.cardId);
 if(!fresh||!current)throw Error("Settlement authorization record missing");
 if(p.leaseToken){
  const lock=await this.store.get<Job>("locks","worker");
  if(fresh.leaseToken!==p.leaseToken||Number(fresh.leaseUntil)<=Date.now()||!lock||Number(lock.leaseUntil)<=Date.now())throw new PendingFinality("Worker lease expired before settlement");
 }
 assertCardEnvironment(current);
 const currentKey=await this.store.get<Doc>("keys",fresh.keyId);
 if(fresh.cancelRequested||fresh.cancelTarget||!currentKey||currentKey.revoked||currentKey.cardId!==current._id||currentKey.owner!==current.owner||fresh.keyId!==p.keyId||(Object.hasOwn(current,"activeKeyId")&&current.activeKeyId!==fresh.keyId)){
  await this.evm.cancel(current,fresh);return {status:fresh.cancelTarget??"CANCELLED"};
 }
 if(!fresh.canonical||fresh.canonical.expiresAt<=Math.floor(Date.now()/1000)){await this.evm.cancel(current,fresh);return {status:"EXPIRED"};}
 if(Date.now()-Number(fresh.processingStartedAt??fresh.createdAt)>=30*60*1000){await this.evm.cancel(current,fresh);return {status:"CANCELLED",errorCode:"PROCESSING_TIMEOUT",error:"The pre-burn processing deadline elapsed. No payment was authorized; the reservation was released."};}
 if(current.state!=="READY"||current.owner!==c.owner||fresh.owner!==current.owner||fresh.cardId!==current._id||current.chainId!==c.chainId||current.token!==c.token||digest(current.settlement??null)!==digest(c.settlement??null)||current.address!==c.address||current.policyHash!==c.policyHash||current.reviewerAddress!==c.reviewerAddress||digest(current.policy)!==current.policyHash||fresh.requestHash!==p.requestHash||fresh.evidenceHash!==p.evidenceHash||fresh.genLayerTxHash!==p.genLayerTxHash||digest(fresh.canonical)!==p.requestHash||digest(fresh.input)!==fresh.inputHash||fresh.inputHash!==p.inputHash||digest(fresh.snapshots)!==p.evidenceHash||!fresh.review||digest(fresh.review)!==digest(latest))throw Error("Settlement authorization changed");
 if(isBridge(c,p)){const sourceTxHash=await this.evm.settle(c,{...p,review:latest}),destination=paymentDestination(c,p.input);return {status:"BRIDGING",bridge:{protocol:"CCTP_V2",phase:"BURNED",sourceChainId:cardChain(c),destinationChainId:destination.chainId,destinationDomain:destination.domain,sourceToken:processToken(c),destinationToken:destination.token,amount:p.input.amount,sourceTxHash,updatedAt:Date.now()}};}
 const paid={...p,review:latest};await this.evm.settle(c,paid);return {status:"PAID",paymentTxHash:await this.evm.paidHash(c,paid)};
 }
}
