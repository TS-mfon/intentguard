import {createPublicClient,createWalletClient,defineChain,http,encodeFunctionData,decodeEventLog,keccak256,parseTransaction,type Abi,type Hex,type Address} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import artifacts from "../../../contracts/evm/abi.json";
import {canonical,digest,parseAmount,formatAmount,isSettlementV2,type Policy,type CardView,type Settlement} from "../../../packages/shared";
import {CCTP_TESTNETS} from "../../../packages/shared/assets";
import {settlementFactory,destinationDomains,cardSymbol,isBridge,settlementToken,assertCardEnvironment,cardContractVersion} from "./settlement";
import {Cctp,bridgeRouteHash} from "./cctp";
import {configuration} from "./config";
import {runtimeManifest} from "./deployment-profile";
import {verifyPaymentReceipt} from "./payment-proof";
import {transactionBinding,validateTransactionJournal} from "./transaction-profile";
import type {Card,Payment,ChainRequest} from "./models";
import type {Store,Doc} from "./store";
const cardAbi=artifacts.AgentSpendingCard as Abi,factoryAbi=artifacts.CardFactory as Abi,bridgeAbi=artifacts.CctpSpendingCard as Abi,bridgeFactoryAbi=artifacts.CctpCardFactory as Abi;
function cardAbiFor(card:Card):Abi{return cardContractVersion(card)===4?artifacts.CctpSpendingCardV4 as Abi:cardContractVersion(card)===2?bridgeAbi:cardAbi;}
function factoryAbiFor(s?:Settlement):Abi{return s&&isSettlementV2(s)?(s.asset==="USDC"?artifacts.CctpCardFactoryV4:artifacts.MainnetUsdt0CardFactory) as Abi:s?bridgeFactoryAbi:factoryAbi;}
const uintAbi=(name:string,returns:string,args="")=>[{type:"function",name,stateMutability:"view",inputs:args?[{name:"token",type:args}]:[],outputs:[{type:returns}]}] as Abi;
const asHex=(s:string)=>s as Hex,asAddress=(s:string)=>s as Address;
const failures=["Payment limit","Total budget","Period budget","Policy validity","Merchant permission","Asset permission","Card disabled"];
export function activationConfig(owner:string,policy:Policy,settlement?:Settlement){
 const c=configuration(); if(!c.configured)throw Error("Runtime is not configured");
 return {owner,gateway:c.gateway!,attestor:c.attestor!,token:settlementToken(settlement),processor:c.processor!,circuitId:c.circuitId!,beacon:c.beacon!,expectedImplementation:c.expectedImplementation!,expectedNetlistHash:c.expectedNetlistHash!,policyHash:digest(policy),totalLimit:parseAmount(policy.financial.totalBudget).toString(),perPaymentLimit:parseAmount(policy.financial.perPaymentLimit).toString(),periodLimit:parseAmount(policy.financial.periodBudget).toString(),periodSeconds:String(policy.financial.periodSeconds),validFrom:String(policy.financial.validFrom),validUntil:String(policy.financial.validUntil),allowedRecipients:[...new Set(policy.merchants.map(m=>m.recipient.toLowerCase()))]};
}
export interface EvmPort{
 preview(card:Card,input:Payment["input"],expiresAt:number):Promise<{allow:boolean;failures:string[]}>;
 request(card:Card,id:string):Promise<ChainRequest>;
 reserve(card:Card,p:Payment):Promise<string>;
 cancel(card:Card,p:Payment):Promise<void>;
 settle(card:Card,p:Payment):Promise<string>;
 view(card:Card):Promise<CardView>;
 verifyActivation(owner:string,policy:Policy,address:string,tx:string,settlement?:Settlement):Promise<string>;
 reconcileBridge?(card:Card,p:Payment):Promise<Record<string,unknown>>;
 paidHash(card:Card,p:Payment):Promise<string>;
}
export class Evm implements EvmPort{
 readonly cfg=configuration();
 readonly chain=defineChain({id:this.cfg.chainId,name:this.cfg.local?"IntentGuard local":"X Layer",nativeCurrency:{name:"OKB",symbol:"OKB",decimals:18},rpcUrls:{default:{http:[this.cfg.rpcUrl]}}});
 readonly public=createPublicClient({chain:this.chain,transport:http(this.cfg.rpcUrl,{timeout:15000,retryCount:0}),cacheTime:0});
 constructor(private store:Store){}
 async identity(){if(await this.public.getChainId()!==this.cfg.chainId)throw Error("Unexpected RPC chain");
 if(this.cfg.mainnet){
  if(!this.cfg.configured)throw Error("Mainnet runtime is not configured");
  const manifest=await runtimeManifest(this.cfg);
  for(const[key,expected]of Object.entries(manifest.codeHashes)){
   const code=await this.public.getCode({address:asAddress(manifest.contracts[key as keyof typeof manifest.codeHashes])});
   if(!code||code==="0x"||keccak256(code).toLowerCase()!==expected.toLowerCase())throw Error("Mainnet deployed bytecode mismatch");
  }
 }
 }
 async read(address:string,functionName:string,args:unknown[]=[]){await this.identity();return this.public.readContract({address:asAddress(address),abi:cardAbi,functionName,args});}
 async preview(card:Card,input:Payment["input"],expiresAt:number){assertCardEnvironment(card);const [allow,mask]=await this.read(card.address,"preview",[asAddress(input.recipient),parseAmount(input.amount),BigInt(expiresAt)]) as [boolean,number];return {allow,failures:failures.filter((_,i)=>(Number(mask)&(1<<i))!==0)}}
 async request(card:Card,id:string){assertCardEnvironment(card);return await this.read(card.address,"getRequest",[asHex(id)]) as ChainRequest}
 async execute(key:string,address:string,method:string,args:unknown[],abi:Abi=cardAbi):Promise<string>{
 await this.identity(); const privateKey=process.env.XLAYER_OPERATOR_PRIVATE_KEY;if(!privateKey)throw Error("Gateway signing key is required");
 const account=privateKeyToAccount(asHex(privateKey));if(account.address.toLowerCase()!==this.cfg.gateway?.toLowerCase())throw Error("Gateway key does not match configured signer");
 const wallet=createWalletClient({chain:this.chain,account,transport:http(this.cfg.rpcUrl,{timeout:15000,retryCount:0})});
 const data=encodeFunctionData({abi,functionName:method,args}),binding=transactionBinding(this.cfg);
 let tx=await this.store.get<Doc&{raw:Hex;hash:Hex;binding?:unknown}>("transactions",key);
 if(tx)await validateTransactionJournal(tx,{chainId:this.cfg.chainId,to:address,data,gateway:account.address,binding,requireBinding:this.cfg.mainnet});
 const [latestNonce,pendingNonce]=await Promise.all(["latest","pending"].map(blockTag=>this.public.getTransactionCount({address:account.address,blockTag:blockTag as "latest"|"pending"})));const nonce=Math.max(latestNonce,pendingNonce);
 if(tx&&!await this.public.getTransactionReceipt({hash:tx.hash}).catch(()=>null)&&latestNonce>Number(parseTransaction(tx.raw).nonce)){const stale=await this.store.take("transactions",key);if(stale&&stale.hash!==tx.hash)throw Error("Transaction journal changed during nonce recovery");tx=null;}
 if(!tx){const prepared=await wallet.prepareTransactionRequest({to:asAddress(address),data,nonce});prepared.gas=prepared.gas*125n/100n+50000n;const raw=await wallet.signTransaction(prepared);const candidate={_id:key,raw,hash:keccak256(raw),binding,createdAt:Date.now(),blockStart:(await this.public.getBlockNumber()).toString()};
 if(!await this.store.create("transactions",candidate))tx=await this.store.get("transactions",key);else tx=candidate;}
 if(!tx)throw Error("Transaction persistence failed");
 await validateTransactionJournal(tx,{chainId:this.cfg.chainId,to:address,data,gateway:account.address,binding,requireBinding:this.cfg.mainnet});
 let receipt=await this.public.getTransactionReceipt({hash:tx.hash}).catch(()=>null);
 if(!receipt){await wallet.sendRawTransaction({serializedTransaction:tx.raw}).catch(async e=>{if(!await this.public.getTransaction({hash:tx!.hash}).catch(()=>null))throw e});receipt=await this.public.waitForTransactionReceipt({hash:tx.hash,timeout:25000,confirmations:2,pollingInterval:1000});}
 if(receipt.status!=="success")throw Error("Onchain transaction reverted");return tx.hash;
 }
 async reserve(card:Card,p:Payment){assertCardEnvironment(card);if(!p.canonical||!p.requestHash||!p.evidenceHash)throw Error("Missing commitments");
 const r=p.canonical;const cross=isBridge(card,p);return this.execute(p._id+":reserve",card.address,cross?"reserveBridge":"reserve",[asHex(p._id),asHex(p.requestHash),asHex(p.evidenceHash),asHex(digest(r.recipient.toLowerCase()+"|"+r.invoiceId)),asAddress(r.recipient),BigInt(r.amountAtomic),BigInt(r.expiresAt),...(cross?[r.destinationDomain!]:[])],cardAbiFor(card));}
 async cancel(card:Card,p:Payment){const r=await this.request(card,p._id);if(r.status!==1)return;await this.execute(p._id+":cancel",card.address,Number(r.expiresAt)<=Math.floor(Date.now()/1000)?"expire":"cancel",[asHex(p._id)],cardAbi);}
 async settle(card:Card,p:Payment){assertCardEnvironment(card);if(!p.canonical||!p.review||!p.genLayerTxHash||!p.requestHash||p.review.decision!=="APPROVE")throw Error("No finalized approval");
 const key=process.env.REVIEW_ATTESTOR_PRIVATE_KEY;if(!key)throw Error("Review attestor key is required");const account=privateKeyToAccount(asHex(key));if(account.address.toLowerCase()!==this.cfg.attestor?.toLowerCase())throw Error("Attestor key mismatch");
 const validUntil=BigInt(p.canonical.expiresAt),decisionHash=asHex(digest(p.review)),cross=isBridge(card,p);
 const routeHash=cross?bridgeRouteHash(p.canonical.destinationDomain!,p.canonical.recipient,BigInt(p.canonical.amountAtomic)):undefined;
 if(cross){const route=await this.public.readContract({address:asAddress(card.address),abi:cardAbiFor(card),functionName:"getBridgeRequest",args:[asHex(p._id)]}) as {routeHash:string;destinationDomain:number};if(route.routeHash.toLowerCase()!==routeHash||Number(route.destinationDomain)!==p.canonical.destinationDomain)throw Error("Bridge route commitment mismatch");}
 const signature=await account.signTypedData({domain:{name:"IntentGuard",version:String(cardContractVersion(card)),chainId:this.cfg.chainId,verifyingContract:asAddress(card.address)},primaryType:cross?"BridgeRelease":"Release",types:{[cross?"BridgeRelease":"Release"]:(cross?artifacts.bridgeRelease:artifacts.release).fields.map(([name,type])=>({name,type}))},message:{requestId:asHex(p._id),requestHash:asHex(p.requestHash),policyHash:asHex(card.policyHash),evidenceHash:asHex(p.canonical.evidenceHash),decisionHash,genLayerTxHash:asHex(p.genLayerTxHash),validUntil,...(routeHash?{routeHash}:{})}});
 const hash=await this.execute(p._id+":settle",card.address,"settle",[asHex(p._id),validUntil,decisionHash,asHex(p.genLayerTxHash),signature],cardAbiFor(card));
 if(!cross)await this.confirmPayment(card,p,hash);return hash;
 }
 async confirmPayment(card:Card,p:Payment,hash:string){
  const receipt=await this.public.waitForTransactionReceipt({hash:asHex(hash),confirmations:2,timeout:25000});
  if(receipt.transactionHash.toLowerCase()!==hash.toLowerCase()||await this.public.getBlockNumber()<receipt.blockNumber+1n)throw Error("Payment awaits confirmation");
  return verifyPaymentReceipt(receipt,card,p,String(card.token??this.cfg.token));
 }
 async paidHash(card:Card,p:Payment){
 await this.identity();
 const tx=await this.store.get<Doc&{hash:Hex;blockStart?:string}>("transactions",p._id+":settle");
 if(tx){const receipt=await this.public.getTransactionReceipt({hash:tx.hash}).catch(()=>null);if(receipt?.status==="success")return this.confirmPayment(card,p,tx.hash)}
 const end=await this.public.getBlockNumber(),start=BigInt(tx?.blockStart??card.activationBlock);
 const event=cardAbi.find(v=>v.type==="event"&&v.name==="Paid");if(!event||event.type!=="event")throw Error("Paid event ABI missing");
 for(let to=end;to>=start;){const from=to>start+99n?to-99n:start;
 const logs=await this.public.getLogs({address:asAddress(card.address),event,args:{requestId:asHex(p._id)},fromBlock:from,toBlock:to});
 if(logs.length){const found=logs[logs.length-1];if(end<found.blockNumber+1n)throw Error("Payment awaits confirmation");const verified=await this.confirmPayment(card,p,found.transactionHash);await this.store.patch("requests",p._id,{paymentTxHash:verified});return verified;}if(from===start)break;to=from-1n;}
 throw Error("Paid state has no confirmed matching event");
 }
 async reconcileBridge(card:Card,p:Payment){return new Cctp(this,this.store).reconcile(card,p)}
 async view(card:Card){assertCardEnvironment(card);const [ledger,enabled,revoked]=await Promise.all([this.read(card.address,"ledger"),this.read(card.address,"enabled"),this.read(card.address,"revoked")]);const keys=["funded","spent","reserved","available","periodSpent","periodReserved"] as const;const balances=Object.fromEntries(keys.map((k,i)=>[k,formatAmount((ledger as bigint[])[i])])) as CardView["balances"];
 return {id:card._id,name:card.policy.name,mission:card.policy.mission,address:card.address,policyHash:card.policyHash,policy:card.policy,status:revoked?"REVOKED":enabled?"ACTIVE":"PAUSED",balances,keyStatus:card.keyStatus,chainId:Number(card.chainId??this.cfg.chainId),token:String(card.token??this.cfg.token),paymentSymbol:cardSymbol(card),settlement:card.settlement,reviewerAddress:card.reviewerAddress??"",reviewerTx:card.reviewerTx,activationTx:card.activationTx,setupState:card.state,setupError:card.error??null,paymentEnvironment:card.paymentEnvironment??this.cfg.paymentEnvironment,reviewEnvironment:"testnet",reviewNetwork:"studionet",reviewChainId:61999,reviewerVersion:card.reviewerVersion} as CardView;}
 async verifyActivation(owner:string,policy:Policy,address:string,tx:string,settlement?:Settlement){
 await this.identity();const receipt=await this.public.getTransactionReceipt({hash:asHex(tx)});if(receipt.status!=="success")throw Error("Activation transaction failed");
 if(await this.public.getBlockNumber()<receipt.blockNumber+1n)throw Error("Wait for activation confirmation");
 const expected=activationConfig(owner,policy,settlement),expectedFactory=settlementFactory(settlement),abi=factoryAbiFor(settlement);let found=false;
 for(const log of receipt.logs){if(log.address.toLowerCase()!==expectedFactory?.toLowerCase())continue;try{const event=decodeEventLog({abi,data:log.data,topics:log.topics});const a=event.args as {owner?:string;card?:string;policyHash?:string};if(event.eventName==="CardCreated"&&a.owner?.toLowerCase()===owner.toLowerCase()&&a.card?.toLowerCase()===address.toLowerCase()&&a.policyHash?.toLowerCase()===expected.policyHash)found=true;}catch{}}
 if(!found)throw Error("Card was not created by the configured factory for this owner and policy");
 const actual=await this.read(address,"config") as Record<string,unknown>;
 const normalize=(v:unknown):unknown=>typeof v==="bigint"?v.toString():typeof v==="string"?v.toLowerCase():Array.isArray(v)?v.map(normalize):v;
 for(const [k,v]of Object.entries(expected)){if(canonical(normalize(actual[k]))!==canonical(normalize(v)))throw Error("Activated card configuration mismatch: "+k);}
 if(settlement&&settlement.asset==="USDC"){const actualDomains=await this.public.readContract({address:asAddress(address),abi:settlement&&isSettlementV2(settlement)?artifacts.CctpSpendingCardV4 as Abi:bridgeAbi,functionName:"allowedDomains"}) as number[];if(canonical(actualDomains.map(Number).sort((a,b)=>a-b))!==canonical(destinationDomains(settlement).sort((a,b)=>a-b)))throw Error("Activated destination permissions mismatch");}
 return receipt.blockNumber.toString();
 }
}
