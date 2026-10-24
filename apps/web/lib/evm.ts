import {createPublicClient,createWalletClient,defineChain,http,encodeFunctionData,decodeEventLog,keccak256,parseTransaction,type Abi,type Hex,type Address} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import artifacts from "../../../contracts/evm/abi.json";
import {canonical,digest,parseAmount,formatAmount,type Policy,type CardView} from "../../../packages/shared";
import {configuration} from "./config";
import type {Card,Payment,ChainRequest} from "./models";
import type {Store,Doc} from "./store";
const cardAbi=artifacts.AgentSpendingCard as Abi,factoryAbi=artifacts.CardFactory as Abi;
const asHex=(s:string)=>s as Hex,asAddress=(s:string)=>s as Address;
const failures=["Payment limit","Total budget","Period budget","Policy validity","Merchant permission","Asset permission","Card disabled"];
export function activationConfig(owner:string,policy:Policy){
 const c=configuration(); if(!c.configured)throw Error("Runtime is not configured");
 return {owner,gateway:c.gateway!,attestor:c.attestor!,token:c.token,processor:c.processor!,circuitId:c.circuitId!,beacon:c.beacon!,expectedImplementation:c.expectedImplementation!,expectedNetlistHash:c.expectedNetlistHash!,policyHash:digest(policy),totalLimit:parseAmount(policy.financial.totalBudget).toString(),perPaymentLimit:parseAmount(policy.financial.perPaymentLimit).toString(),periodLimit:parseAmount(policy.financial.periodBudget).toString(),periodSeconds:String(policy.financial.periodSeconds),validFrom:String(policy.financial.validFrom),validUntil:String(policy.financial.validUntil),allowedRecipients:[...new Set(policy.merchants.map(m=>m.recipient.toLowerCase()))]};
}
export interface EvmPort{
 preview(card:Card,input:Payment["input"],expiresAt:number):Promise<{allow:boolean;failures:string[]}>;
 request(card:Card,id:string):Promise<ChainRequest>;
 reserve(card:Card,p:Payment):Promise<string>;
 cancel(card:Card,p:Payment):Promise<void>;
 settle(card:Card,p:Payment):Promise<string>;
 view(card:Card):Promise<CardView>;
 verifyActivation(owner:string,policy:Policy,address:string,tx:string):Promise<string>;
 paidHash?(card:Card,p:Payment):Promise<string>;
}
export class Evm implements EvmPort{
 readonly cfg=configuration();
 readonly chain=defineChain({id:this.cfg.chainId,name:this.cfg.local?"IntentGuard local":"X Layer",nativeCurrency:{name:"OKB",symbol:"OKB",decimals:18},rpcUrls:{default:{http:[this.cfg.rpcUrl]}}});
 readonly public=createPublicClient({chain:this.chain,transport:http(this.cfg.rpcUrl,{timeout:15000,retryCount:0}),cacheTime:0});
 constructor(private store:Store){}
 async identity(){if(await this.public.getChainId()!==this.cfg.chainId)throw Error("Unexpected RPC chain");}
 async read(address:string,functionName:string,args:unknown[]=[]){await this.identity();return this.public.readContract({address:asAddress(address),abi:cardAbi,functionName,args});}
 async preview(card:Card,input:Payment["input"],expiresAt:number){const [allow,mask]=await this.read(card.address,"preview",[asAddress(input.recipient),parseAmount(input.amount),BigInt(expiresAt)]) as [boolean,number];return {allow,failures:failures.filter((_,i)=>(Number(mask)&(1<<i))!==0)}}
 async request(card:Card,id:string){return await this.read(card.address,"getRequest",[asHex(id)]) as ChainRequest}
 async execute(key:string,address:string,method:string,args:unknown[]):Promise<string>{
 await this.identity(); const privateKey=process.env.XLAYER_OPERATOR_PRIVATE_KEY;if(!privateKey)throw Error("Gateway signing key is required");
 const account=privateKeyToAccount(asHex(privateKey));if(account.address.toLowerCase()!==this.cfg.gateway?.toLowerCase())throw Error("Gateway key does not match configured signer");
 const wallet=createWalletClient({chain:this.chain,account,transport:http(this.cfg.rpcUrl,{timeout:15000,retryCount:0})});
 let tx=await this.store.get<Doc&{raw:Hex;hash:Hex}>("transactions",key);
 const [latestNonce,pendingNonce]=await Promise.all(["latest","pending"].map(blockTag=>this.public.getTransactionCount({address:account.address,blockTag:blockTag as "latest"|"pending"})));const nonce=Math.max(latestNonce,pendingNonce);
 if(tx&&!await this.public.getTransactionReceipt({hash:tx.hash}).catch(()=>null)&&latestNonce>Number(parseTransaction(tx.raw).nonce)){const stale=await this.store.take("transactions",key);if(stale&&stale.hash!==tx.hash)throw Error("Transaction journal changed during nonce recovery");tx=null;}
 if(!tx){const data=encodeFunctionData({abi:cardAbi,functionName:method,args});const prepared=await wallet.prepareTransactionRequest({to:asAddress(address),data,nonce});prepared.gas=prepared.gas*125n/100n+50000n;const raw=await wallet.signTransaction(prepared);const candidate={_id:key,raw,hash:keccak256(raw),createdAt:Date.now(),blockStart:(await this.public.getBlockNumber()).toString()};
 if(!await this.store.create("transactions",candidate))tx=await this.store.get("transactions",key);else tx=candidate;}
 if(!tx)throw Error("Transaction persistence failed");
 let receipt=await this.public.getTransactionReceipt({hash:tx.hash}).catch(()=>null);
 if(!receipt){await wallet.sendRawTransaction({serializedTransaction:tx.raw}).catch(async e=>{if(!await this.public.getTransaction({hash:tx!.hash}).catch(()=>null))throw e});receipt=await this.public.waitForTransactionReceipt({hash:tx.hash,timeout:25000,confirmations:2,pollingInterval:1000});}
 if(receipt.status!=="success")throw Error("Onchain transaction reverted");return tx.hash;
 }
 async reserve(card:Card,p:Payment){if(!p.canonical||!p.requestHash||!p.evidenceHash)throw Error("Missing commitments");
 const r=p.canonical;return this.execute(p._id+":reserve",card.address,"reserve",[asHex(p._id),asHex(p.requestHash),asHex(p.evidenceHash),asHex(digest(r.recipient.toLowerCase()+"|"+r.invoiceId)),asAddress(r.recipient),BigInt(r.amountAtomic),BigInt(r.expiresAt)]);}
 async cancel(card:Card,p:Payment){const r=await this.request(card,p._id);if(r.status!==1)return;await this.execute(p._id+":cancel",card.address,Number(r.expiresAt)<=Math.floor(Date.now()/1000)?"expire":"cancel",[asHex(p._id)]);}
 async settle(card:Card,p:Payment){if(!p.canonical||!p.review||!p.genLayerTxHash||!p.requestHash||p.review.decision!=="APPROVE")throw Error("No finalized approval");
 const key=process.env.REVIEW_ATTESTOR_PRIVATE_KEY;if(!key)throw Error("Review attestor key is required");const account=privateKeyToAccount(asHex(key));if(account.address.toLowerCase()!==this.cfg.attestor?.toLowerCase())throw Error("Attestor key mismatch");
 const validUntil=BigInt(p.canonical.expiresAt),decisionHash=asHex(digest(p.review));
 const signature=await account.signTypedData({domain:{name:"IntentGuard",version:"1",chainId:this.cfg.chainId,verifyingContract:asAddress(card.address)},primaryType:"Release",types:{Release:artifacts.release.fields.map(([name,type])=>({name,type}))},message:{requestId:asHex(p._id),requestHash:asHex(p.requestHash),policyHash:asHex(card.policyHash),evidenceHash:asHex(p.canonical.evidenceHash),decisionHash,genLayerTxHash:asHex(p.genLayerTxHash),validUntil}});
 return this.execute(p._id+":settle",card.address,"settle",[asHex(p._id),validUntil,decisionHash,asHex(p.genLayerTxHash),signature]);
 }
 async paidHash(card:Card,p:Payment){
 const tx=await this.store.get<Doc&{hash:Hex;blockStart?:string}>("transactions",p._id+":settle");
 if(tx){const receipt=await this.public.getTransactionReceipt({hash:tx.hash}).catch(()=>null);if(receipt?.status==="success"){await this.public.waitForTransactionReceipt({hash:tx.hash,confirmations:2,timeout:25000});return tx.hash}}
 const end=await this.public.getBlockNumber(),start=BigInt(tx?.blockStart??card.activationBlock);
 const event=cardAbi.find(v=>v.type==="event"&&v.name==="Paid");if(!event||event.type!=="event")throw Error("Paid event ABI missing");
 for(let to=end;to>=start;){const from=to>start+99n?to-99n:start;
 const logs=await this.public.getLogs({address:asAddress(card.address),event,args:{requestId:asHex(p._id)},fromBlock:from,toBlock:to});
 if(logs.length){const found=logs[logs.length-1];if(end<found.blockNumber+1n)throw Error("Payment awaits confirmation");await this.store.patch("requests",p._id,{paymentTxHash:found.transactionHash});return found.transactionHash;}if(from===start)break;to=from-1n;}
 throw Error("Paid state has no confirmed matching event");
 }
 async view(card:Card){const [ledger,enabled,revoked]=await Promise.all([this.read(card.address,"ledger"),this.read(card.address,"enabled"),this.read(card.address,"revoked")]);const keys=["funded","spent","reserved","available","periodSpent","periodReserved"] as const;const balances=Object.fromEntries(keys.map((k,i)=>[k,formatAmount((ledger as bigint[])[i])])) as CardView["balances"];
 return {id:card._id,name:card.policy.name,mission:card.policy.mission,address:card.address,policyHash:card.policyHash,policy:card.policy,status:revoked?"REVOKED":enabled?"ACTIVE":"PAUSED",balances,keyStatus:card.keyStatus,chainId:this.cfg.chainId,token:this.cfg.token,reviewerAddress:card.reviewerAddress??"",reviewerTx:card.reviewerTx,activationTx:card.activationTx} as CardView;}
 async verifyActivation(owner:string,policy:Policy,address:string,tx:string){
 await this.identity();const receipt=await this.public.getTransactionReceipt({hash:asHex(tx)});if(receipt.status!=="success")throw Error("Activation transaction failed");
 if(await this.public.getBlockNumber()<receipt.blockNumber+1n)throw Error("Wait for activation confirmation");
 const expected=activationConfig(owner,policy);let found=false;
 for(const log of receipt.logs){if(log.address.toLowerCase()!==this.cfg.factoryAddress?.toLowerCase())continue;try{const event=decodeEventLog({abi:factoryAbi,data:log.data,topics:log.topics});const a=event.args as {owner?:string;card?:string;policyHash?:string};if(event.eventName==="CardCreated"&&a.owner?.toLowerCase()===owner.toLowerCase()&&a.card?.toLowerCase()===address.toLowerCase()&&a.policyHash?.toLowerCase()===expected.policyHash)found=true;}catch{}}
 if(!found)throw Error("Card was not created by the configured factory for this owner and policy");
 const actual=await this.read(address,"config") as Record<string,unknown>;
 const normalize=(v:unknown):unknown=>typeof v==="bigint"?v.toString():typeof v==="string"?v.toLowerCase():Array.isArray(v)?v.map(normalize):v;
 for(const [k,v]of Object.entries(expected)){if(canonical(normalize(actual[k]))!==canonical(normalize(v)))throw Error("Activated card configuration mismatch: "+k);}
 return receipt.blockNumber.toString();
 }
}
