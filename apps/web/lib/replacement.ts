import {digest,canonical,isSettlementV2,type SettlementV2} from "../../../packages/shared";
import {configuration} from "./config";
import {assertCardEnvironment} from "./settlement";
import type {Store} from "./store";
import type {Card,Draft} from "./models";
import {activeStatuses} from "./models";
import type {EvmPort} from "./evm";
export const replacementWarnings=[
 "This creates a new empty vault and resets its spent and reserved accounting. Lifetime budgets are per vault.",
 "No funds move automatically. Resolve old reservations, withdraw from the old vault and deposit into the new vault using your wallet.",
 "The old reviewer, immutable policy and payment history remain unchanged. Revoke old credentials and pause the old vault before switching your agent.",
 "Copied budget numbers apply to the explicitly selected settlement asset. Confirm the amount and merchant permissions before activation."
];
export async function replacementDetails(store:Store,evm:EvmPort,card:Card){
 assertCardEnvironment(card);const view=await evm.view(card),usage=await store.usage(card._id),pending=await store.find("requests",{cardId:card._id,status:{$in:activeStatuses}},{limit:50});
 return {sourceCardId:card._id,sourceAddress:card.address,sourceEnvironment:card.paymentEnvironment??(card.chainId===1952?"testnet":"mainnet"),sourceChainId:card.chainId,reviewEnvironment:"testnet",reviewNetwork:"studionet",sourceReviewerVersion:card.reviewerVersion??(card.settlement?3:1),sourceReviewerAddress:card.reviewerAddress,policy:card.policy,policyHash:card.policyHash,settlement:card.settlement??null,balances:view.balances,keyStatus:card.keyStatus,pendingCount:activeStatuses.reduce((n,status)=>n+(usage.counts[status]??0),0),pendingRequestIds:pending.map(p=>p._id),accountingReset:true,warnings:replacementWarnings,steps:["Revoke the old API key and pause the old vault.","Resolve pending reservations; an irreversible CCTP burn must finish reconciliation.","Select the new settlement and acknowledge that accounting resets.","Activate the copied policy in a new vault with the owner wallet.","Withdraw old funds and deposit into the new vault explicitly.","Wait for the new reviewer, issue a new key and update the agent."]};
}
export async function createReplacementDraft(store:Store,card:Card,settlement:SettlementV2):Promise<Draft>{
 assertCardEnvironment(card);
 if(!isSettlementV2(settlement)||settlement.paymentEnvironment!==configuration().paymentEnvironment||digest(card.policy)!==card.policyHash)throw Error("Replacement policy or environment mismatch");
 const id=digest({kind:"owner-replacement",sourceCardId:card._id,owner:card.owner,settlementHash:digest(settlement)}),now=Date.now(),input={description:"Owner-authorized immutable policy copy from vault "+card.address,guidance:{sourceCardId:card._id,sourcePolicyHash:card.policyHash}};
 const draft:Draft={_id:id,owner:card.owner,input,inputHash:digest(input),state:"FINALIZED",result:{status:"PROPOSED",policy:structuredClone(card.policy),questions:[],interpretation:"Exact copy of the existing owner-approved policy; activation requires a new explicit wallet transaction. Accounting starts at zero."},settlement,replacesCardId:card._id,replacementSource:{address:card.address,chainId:card.chainId,policyHash:card.policyHash,reviewerAddress:card.reviewerAddress??null,reviewerVersion:card.reviewerVersion??1,paymentEnvironment:card.paymentEnvironment??(card.chainId===1952?"testnet":"mainnet")},createdAt:now,updatedAt:now};
 if(await store.create("drafts",draft))return draft;
 const existing=await store.get<Draft>("drafts",id);
 if(!existing||existing.owner!==card.owner||existing.replacesCardId!==card._id||existing.result?.policy===undefined||canonical(existing.result.policy)!==canonical(card.policy)||canonical(existing.settlement)!==canonical(settlement))throw Error("Replacement draft commitment mismatch");
 return existing;
}
