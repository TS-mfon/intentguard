import {parseTransaction,recoverTransactionAddress,keccak256,type Hex,type TransactionSerialized} from "viem";
import {canonical} from "../../../packages/shared";
import type {configuration} from "./config";
export type TransactionBinding={paymentEnvironment:string;paymentChainId:number;gateway:string};
export function transactionBinding(cfg:ReturnType<typeof configuration>):TransactionBinding{
 if(!cfg.gateway)throw Error("Gateway identity is required");
 return {paymentEnvironment:cfg.paymentEnvironment,paymentChainId:cfg.chainId,gateway:cfg.gateway.toLowerCase()};
}
export async function validateTransactionJournal(saved:{raw:Hex;binding?:unknown;hash?:Hex},expected:{chainId:number;to:string;data:Hex;gateway:string;binding:TransactionBinding;requireBinding:boolean}){
 if((expected.requireBinding&&!saved.binding)||(saved.binding&&canonical(saved.binding)!==canonical(expected.binding)))throw Error("Transaction journal environment mismatch");
 if(saved.hash&&saved.hash.toLowerCase()!==keccak256(saved.raw).toLowerCase())throw Error("Transaction journal hash mismatch");
 const tx=parseTransaction(saved.raw);
 if(tx.chainId!==expected.chainId||tx.to?.toLowerCase()!==expected.to.toLowerCase()||tx.data?.toLowerCase()!==expected.data.toLowerCase()||(tx.value??0n)!==0n)throw Error("Signed transaction intent mismatch");
 if((await recoverTransactionAddress({serializedTransaction:saved.raw as TransactionSerialized})).toLowerCase()!==expected.gateway.toLowerCase())throw Error("Signed transaction gateway mismatch");
}
