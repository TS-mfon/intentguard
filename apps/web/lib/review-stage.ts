import type {Payment} from "./models";
export type ReviewStage={status:"PENDING"|"COMPLETE"|"SKIPPED"|"FAILED";reason:string};
export function reviewStage(p:Pick<Payment,"status"|"guard"|"review"|"genLayerTxHash"> & {reviewFailure?:unknown}):ReviewStage{
 if(p.review)return {status:"COMPLETE",reason:"The finalized GenLayer decision is recorded."};
 if(p.guard?.allow===false||p.status==="BLOCKED")return {status:"SKIPPED",reason:"The financial gate blocked this request. Evidence review was not run."};
 if(p.reviewFailure)return {status:"FAILED",reason:"GenLayer could not finalize a successful review. No approval was issued."};
 if(["PAID","REJECTED"].includes(p.status))return {status:"FAILED",reason:"The expected committed review is unavailable. Verify the chain record before relying on this result."};
 if(["CANCELLED","EXPIRED","NEEDS_EVIDENCE"].includes(p.status))return {status:p.genLayerTxHash?"FAILED":"SKIPPED",reason:p.genLayerTxHash?"The request ended without a successful finalized review.":"The request ended before evidence review. No model decision was required."};
 return {status:"PENDING",reason:p.genLayerTxHash?"GenLayer review is awaiting successful finality.":"Evidence review will start after the financial and evidence checks pass."};
}
