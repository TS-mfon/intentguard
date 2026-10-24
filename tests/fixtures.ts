import {digest,type Policy,type PaymentInput,type ReviewDecision,type CardView} from "../packages/shared";
import type {Card,Payment,ChainRequest,Draft} from "../apps/web/lib/models";
import type {EvmPort} from "../apps/web/lib/evm";
import type {GenLayerPort} from "../apps/web/lib/genlayer";
export const owner="0x1111111111111111111111111111111111111111",merchant="0x2222222222222222222222222222222222222222";
export const policy:Policy={version:1,name:"Research Agent",mission:"Purchase verifiable research APIs",taskContext:"Compare protocol revenue",allowedCategories:["data"],prohibitedPurchases:["advertising"],exceptions:[],financial:{totalBudget:"100",perPaymentLimit:"10",periodBudget:"30",periodSeconds:86400,validFrom:1,validUntil:4102444800},merchants:[{name:"Data vendor",recipient:merchant,origins:["https://merchant.example"],products:["Research data"]}],evidence:{requiredTypes:["invoice","product"],approvedOrigins:["https://merchant.example"],maxAgeSeconds:86400},criteria:[{id:"mission",description:"The purchase directly supports research"}]};
export const input:PaymentInput={recipient:merchant,amount:"5.000001",purchaseDescription:"Verified protocol data API",justification:"Needed for this research task",category:"data",invoiceId:"inv-001",evidence:[{url:"https://merchant.example/invoice"}]};
export const card:Card={_id:"0x"+"11".repeat(32),owner,address:"0x3333333333333333333333333333333333333333",draftId:"draft",activationTx:"0x"+"aa".repeat(32),activationBlock:"1",policy,policyHash:digest(policy),state:"READY",keyStatus:"ACTIVE",reviewerAddress:"0x4444444444444444444444444444444444444444",createdAt:1,updatedAt:1,chainId:196,token:"0x779ded0c9e1022225f8e0630b35a9b54be713736"};
export const invoice=()=>JSON.stringify({invoiceId:input.invoiceId,buyer:card.address,token:card.token,chainId:196,recipient:merchant,amount:input.amount,description:"Research data API",issuedAt:Math.floor(Date.now()/1000),expiresAt:Math.floor(Date.now()/1000)+3600});
export class FakeEvm implements EvmPort{
 requests=new Map<string,ChainRequest>();reserves=0;settlements=0;cancellations=0;allow=true;
 async preview(){return {allow:this.allow,failures:this.allow?[]:["Total budget"]}}
 async request(_c:Card,id:string){return this.requests.get(id)??{status:0,requestHash:"",evidenceHash:"",invoiceKey:"",recipient:merchant,amount:0n,expiresAt:0n}}
 async reserve(_c:Card,p:Payment){this.reserves++;this.requests.set(p._id,{status:1,requestHash:p.requestHash!,evidenceHash:p.evidenceHash!,invoiceKey:digest(p.input.recipient+"|"+p.input.invoiceId),recipient:p.input.recipient,amount:BigInt(p.canonical!.amountAtomic),expiresAt:BigInt(p.canonical!.expiresAt)});return "0x"+"55".repeat(32)}
 async cancel(_c:Card,p:Payment){const r=this.requests.get(p._id);if(r&&r.status===1){r.status=3;this.cancellations++}}
 async settle(_c:Card,p:Payment){const r=this.requests.get(p._id);if(!r||r.status!==1)throw Error("Replay");r.status=2;this.settlements++;return "0x"+"66".repeat(32)}
 async view(c:Card):Promise<CardView>{return {id:c._id,name:c.policy.name,mission:c.policy.mission,address:c.address,policyHash:c.policyHash,policy:c.policy,status:"ACTIVE",balances:{funded:"100",spent:"0",reserved:"0",available:"100",periodSpent:"0",periodReserved:"0"},keyStatus:c.keyStatus,chainId:196,token:String(c.token),reviewerAddress:c.reviewerAddress??""}}
 async verifyActivation(){return "1"}
}
export class FakeGenLayer implements GenLayerPort{
 submissions=0;result:"APPROVE"|"REJECT"|"NEEDS_EVIDENCE"="APPROVE";error?:Error;modify?:(r:ReviewDecision)=>ReviewDecision;
 async propose(){return "0x"+"77".repeat(32)}
 async draft(_d:Draft){return {status:"PROPOSED" as const,policy,questions:[],interpretation:"Research purchases within defined limits"}}
 async deployReviewer(){return "0x"+"88".repeat(32)}
 async reviewer(){return card.reviewerAddress!}
 async submit(){this.submissions++;return "0x"+"99".repeat(32)}
 async decision(_c:Card,p:Payment){if(this.error)throw this.error;const r:ReviewDecision={decision:this.result,requestHash:p.requestHash!,policyHash:card.policyHash,evidenceHash:p.evidenceHash!,criteria:[{id:"mission",status:this.result==="APPROVE"?"PASS":"FAIL",reason:"Evidence reviewed",sources:[input.evidence[0].url]}],reason:"Independent test fixture decision"};return this.modify?this.modify(r):r}
}
