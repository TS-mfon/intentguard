import type {Policy,PaymentInput,CanonicalRequest,Snapshot,ReviewDecision,RequestStatus,DraftResult,Settlement,BridgeView} from "../../../packages/shared";
import type {Doc} from "./store";
export type Job=Doc&{leaseToken?:string;leaseUntil?:number;nextAt?:number;createdAt:number;updatedAt:number;attempts?:number;error?:string};
export type Draft=Job&{owner:string;input:{description:string;guidance?:unknown};inputHash:string;state:string;result?:DraftResult;genLayerTxHash?:string;settlement?:Settlement};
export type Card=Job&{owner:string;draftId:string;address:string;activationTx:string;activationBlock:string;policy:Policy;policyHash:string;reviewerAddress?:string;reviewerTx?:string;state:string;keyStatus:string;settlement?:Settlement;token?:string;chainId?:number};
export type Payment=Job&{owner:string;cardId:string;keyId:string;input:PaymentInput;inputHash:string;status:RequestStatus;canonical?:CanonicalRequest;snapshots?:Snapshot[];requestHash?:string;evidenceHash?:string;guard?:{allow:boolean;failures:string[];txHash?:string};review?:ReviewDecision;genLayerTxHash?:string;paymentTxHash?:string;bridge?:BridgeView;cctpMessage?:string;cctpAttestation?:string;cancelTarget?:RequestStatus;cancelRequested?:boolean};
export type ChainRequest={status:number;requestHash:string;evidenceHash:string;invoiceKey:string;recipient:string;amount:bigint;expiresAt:bigint};
export const terminal=new Set<RequestStatus>(["PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","EXPIRED","CANCELLED"]);
export const activeStatuses:RequestStatus[]=["QUEUED","RESERVED","REVIEWING","AWAITING_FINALITY","APPROVED","RETRYING","BRIDGING","AWAITING_ATTESTATION","MINTING"];
