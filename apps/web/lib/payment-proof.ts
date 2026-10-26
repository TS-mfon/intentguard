import {decodeEventLog,parseAbi,type Abi,type TransactionReceipt} from "viem";
import artifacts from "../../../contracts/evm/abi.json";
import {digest,parseAmount} from "../../../packages/shared";
import type {Card,Payment} from "./models";
const paidAbi=artifacts.AgentSpendingCard as Abi,tokenAbi=parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
export function verifyPaymentReceipt(receipt:TransactionReceipt,card:Card,p:Payment,token:string){
 if(receipt.status!=="success"||!p.canonical||!p.review||p.review.decision!=="APPROVE"||!p.requestHash||!p.evidenceHash||!p.genLayerTxHash||digest(p.canonical)!==p.requestHash||p.canonical.policyHash!==card.policyHash||p.canonical.cardAddress.toLowerCase()!==card.address.toLowerCase()||p.canonical.evidenceHash!==p.evidenceHash||p.canonical.token.toLowerCase()!==token.toLowerCase()||p.canonical.recipient.toLowerCase()!==p.input.recipient.toLowerCase()||BigInt(p.canonical.amountAtomic)!==parseAmount(p.input.amount))throw Error("Payment proof commitments are invalid");
 let paid=0,transferred=0;
 for(const log of receipt.logs){
  if(log.address.toLowerCase()===card.address.toLowerCase()){try{const e=decodeEventLog({abi:paidAbi,data:log.data,topics:log.topics}),a=e.args as unknown as {requestId:string;decisionHash:string;genLayerTxHash:string;recipient:string;amount:bigint};if(e.eventName==="Paid"&&a.requestId.toLowerCase()===p._id.toLowerCase()&&a.decisionHash.toLowerCase()===digest(p.review)&&a.genLayerTxHash.toLowerCase()===p.genLayerTxHash.toLowerCase()&&a.recipient.toLowerCase()===p.canonical.recipient.toLowerCase()&&a.amount===BigInt(p.canonical.amountAtomic))paid++;}catch{}}
  if(log.address.toLowerCase()===token.toLowerCase()){try{const e=decodeEventLog({abi:tokenAbi,data:log.data,topics:log.topics}),a=e.args as {from:string;to:string;value:bigint};if(e.eventName==="Transfer"&&a.from.toLowerCase()===card.address.toLowerCase()&&a.to.toLowerCase()===p.canonical.recipient.toLowerCase()&&a.value===BigInt(p.canonical.amountAtomic))transferred++;}catch{}}
 }
 if(paid!==1||transferred!==1)throw Error("Receipt does not prove a unique authorized Paid event and exact token transfer");
 return receipt.transactionHash;
}
