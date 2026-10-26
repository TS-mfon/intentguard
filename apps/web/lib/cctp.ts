import {createPublicClient,createWalletClient,defineChain,http,parseAbi,encodeFunctionData,encodeAbiParameters,keccak256,padHex,decodeEventLog,parseTransaction,type Hex,type Address,type Abi,type TransactionReceipt} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import artifacts from "../../../contracts/evm/abi.json";
import {CCTP_TESTNETS,CCTP_IRIS_TESTNET,type TestnetChainId} from "../../../packages/shared/assets";
import {digest,type BridgeView,type CanonicalRequest} from "../../../packages/shared";
import {isBridge} from "./settlement";
import type {Evm} from "./evm";
import type {Store,Doc} from "./store";
import type {Card,Payment} from "./models";
const zero=padHex("0x0",{size:32}),addr=(s:string)=>s as Address,hex=(s:string)=>s as Hex;
const transmitterAbi=parseAbi(["function localDomain() view returns (uint32)","function usedNonces(bytes32) view returns (uint256)","function receiveMessage(bytes,bytes) returns (bool)","event MessageSent(bytes message)","event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)"]);
const tokenAbi=parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
const bridgeAbi=artifacts.CctpSpendingCard as Abi;
export class BridgePending extends Error{constructor(public code:string,message:string){super(message)}}
export class BridgeFailure extends Error{constructor(public code:string,message:string){super(message)}}
export function bridgeRouteHash(domain:number,recipient:string,amount:bigint){
 return keccak256(encodeAbiParameters([{type:"uint32"},{type:"bytes32"},{type:"uint64"},{type:"uint256"},{type:"uint32"},{type:"bytes32"}],[domain,padHex(addr(recipient),{size:32}),amount,0n,2000,zero]));
}
function requireValue(condition:unknown,message:string):asserts condition{if(!condition)throw new BridgeFailure("BRIDGE_COMMITMENT_MISMATCH",message)}
export function parseCctpMessage(message:string){
 requireValue(/^0x(?:[0-9a-fA-F]{2})+$/.test(message)&&message.length===2+376*2,"CCTP message must be the exact V2 standard USDC payload without hooks.");
 const at=(offset:number,bytes:number)=>("0x"+message.slice(2+offset*2,2+(offset+bytes)*2)).toLowerCase() as Hex;
 const uint=(offset:number,bytes:number)=>BigInt(at(offset,bytes));
 requireValue(uint(0,4)===1n&&uint(148,4)===1n,"Unsupported CCTP message version.");
 return {sourceDomain:Number(uint(4,4)),destinationDomain:Number(uint(8,4)),nonce:at(12,32),sender:at(44,32),recipient:at(76,32),destinationCaller:at(108,32),minFinality:Number(uint(140,4)),finalityExecuted:Number(uint(144,4)),burnToken:at(152,32),mintRecipient:at(184,32),amount:uint(216,32),messageSender:at(248,32),maxFee:uint(280,32),feeExecuted:uint(312,32),expirationBlock:uint(344,32),message:hex(message),body:hex(message.slice(0,2)+message.slice(2+148*2))};
}
export function verifyCctpMessage(message:string,card:Card,r:CanonicalRequest,attested:boolean,sourceMessage?:string){
 const v=parseCctpMessage(message),source=CCTP_TESTNETS[1952],target=CCTP_TESTNETS[r.destinationChainId as TestnetChainId];
 requireValue(r.chainId===1952&&r.token.toLowerCase()===source.token.toLowerCase()&&card.settlement&&r.settlementHash===digest(card.settlement),"Source asset/settlement differs from the immutable USDC mandate.");
 requireValue(target&&target.chainId!==1952&&r.destinationToken?.toLowerCase()===target.token.toLowerCase()&&r.destinationDomain===target.domain,"Destination token/domain differs from the committed request.");
 requireValue(v.sourceDomain===37&&v.destinationDomain===target.domain&&v.sender===padHex(source.messenger,{size:32}).toLowerCase()&&v.recipient===padHex(target.messenger,{size:32}).toLowerCase(),"CCTP source, destination or messenger mismatch.");
 requireValue(v.destinationCaller===zero&&v.minFinality===2000&&v.burnToken===padHex(source.token,{size:32}).toLowerCase()&&v.mintRecipient===padHex(addr(r.recipient),{size:32}).toLowerCase()&&v.messageSender===padHex(addr(card.address),{size:32}).toLowerCase()&&v.amount===BigInt(r.amountAtomic),"CCTP amount, owner vault or merchant mismatch.");
 requireValue(v.maxFee===0n&&v.feeExecuted===0n&&v.expirationBlock===0n,"This exact-payment standard route does not authorize fees or expiring fast-transfer messages.");
 if(attested)requireValue(v.nonce!==zero&&v.finalityExecuted>=2000,"CCTP attestation is missing finalized standard-transfer evidence.");
 else requireValue(v.nonce===zero&&v.finalityExecuted===0,"Unexpected source nonce/finality placeholders.");
 if(sourceMessage){const original=verifyCctpMessage(sourceMessage,card,r,false);const {nonce:_,finalityExecuted:__,message:___,body:____,...stable}=v;const {nonce:a,finalityExecuted:b,message:d,body:e,...sourceStable}=original;requireValue(Object.entries(stable).every(([key,value])=>String(value)===String(sourceStable[key as keyof typeof sourceStable])),"Iris modified immutable source message fields.");}
 return v;
}
export function verifyDestinationReceipt(receipt:TransactionReceipt,message:string,card:Card,r:CanonicalRequest){
 const v=verifyCctpMessage(message,card,r,true),target=CCTP_TESTNETS[r.destinationChainId as TestnetChainId];
 requireValue(receipt.status==="success","Destination receive transaction reverted.");
 let received=0,minted=0;
 for(const log of receipt.logs){
  if(log.address.toLowerCase()===target.transmitter.toLowerCase()){try{const e=decodeEventLog({abi:transmitterAbi,data:log.data,topics:log.topics});if(e.eventName==="MessageReceived"){const x=e.args as {sourceDomain:number;nonce:string;sender:string;finalityThresholdExecuted:number;messageBody:string};if(x.nonce.toLowerCase()===v.nonce&&x.sourceDomain===37&&x.sender.toLowerCase()===v.sender&&x.finalityThresholdExecuted===v.finalityExecuted&&x.messageBody.toLowerCase()===v.body.toLowerCase())received++;}}catch{}}
  if(log.address.toLowerCase()===target.token.toLowerCase()){try{const e=decodeEventLog({abi:tokenAbi,data:log.data,topics:log.topics});const x=e.args as {from:string;to:string;value:bigint};if(e.eventName==="Transfer"&&x.from.toLowerCase()==="0x"+"0".repeat(40)&&x.to.toLowerCase()===r.recipient.toLowerCase()&&x.value===BigInt(r.amountAtomic))minted++;}catch{}}
 }
 requireValue(received===1&&minted===1,"Destination receipt does not prove the exact authorized message and USDC mint to the merchant.");
 return receipt.transactionHash;
}
export class Cctp{
 constructor(private evm:Evm,private store:Store,private fetcher:typeof fetch=fetch){}
 destination(id:TestnetChainId){const c=CCTP_TESTNETS[id];requireValue(c&&id!==1952,"Unsupported destination testnet.");const rpc=process.env[id===84532?"BASE_SEPOLIA_RPC_URL":"ARBITRUM_SEPOLIA_RPC_URL"]?.trim()||c.rpcUrl,chain=defineChain({id,name:c.name,testnet:true,nativeCurrency:{name:"Ether",symbol:"ETH",decimals:18},rpcUrls:{default:{http:[rpc]}}});return {c,chain,rpc,public:createPublicClient({chain,transport:http(rpc,{timeout:12000,retryCount:0}),cacheTime:0})};}
 async sourceMessage(card:Card,p:Payment){
  const tx=await this.store.get<Doc&{hash:string}>("transactions",p._id+":settle"),sourceHash=p.bridge?.sourceTxHash??tx?.hash;requireValue(sourceHash&&/^0x[0-9a-fA-F]{64}$/.test(sourceHash),"Source burn transaction journal is missing; funds remain in reconciliation.");
  await this.evm.identity();const receipt=await this.evm.public.getTransactionReceipt({hash:hex(sourceHash)});requireValue(receipt.status==="success","Source burn reverted.");requireValue(await this.evm.public.getBlockNumber()>=receipt.blockNumber+1n,"Source burn is awaiting confirmation.");
  const messages:string[]=[];let started=0;
  for(const log of receipt.logs){
   if(log.address.toLowerCase()===CCTP_TESTNETS[1952].transmitter.toLowerCase()){try{const e=decodeEventLog({abi:transmitterAbi,data:log.data,topics:log.topics});if(e.eventName==="MessageSent")messages.push((e.args as {message:string}).message)}catch{}}
   if(log.address.toLowerCase()===card.address.toLowerCase()){try{const e=decodeEventLog({abi:bridgeAbi,data:log.data,topics:log.topics});if(e.eventName==="BridgeStarted"){const x=e.args as unknown as {requestId:string;destinationDomain:number;routeHash:string;recipient:string;amount:bigint;decisionHash:string;genLayerTxHash:string};if(x.requestId.toLowerCase()===p._id.toLowerCase()&&x.destinationDomain===p.canonical!.destinationDomain&&x.routeHash.toLowerCase()===bridgeRouteHash(x.destinationDomain,p.canonical!.recipient,BigInt(p.canonical!.amountAtomic))&&x.recipient.toLowerCase()===p.canonical!.recipient.toLowerCase()&&x.amount===BigInt(p.canonical!.amountAtomic)&&p.review&&x.decisionHash.toLowerCase()===digest(p.review)&&x.genLayerTxHash.toLowerCase()===p.genLayerTxHash?.toLowerCase())started++;}}catch{}}
  }
  requireValue(started===1&&messages.length===1,"Source receipt does not prove a unique authorized CCTP burn.");verifyCctpMessage(messages[0],card,p.canonical!,false);return {sourceHash,message:messages[0]};
 }
 async attestation(sourceHash:string){
  const response=await this.fetcher(CCTP_IRIS_TESTNET+"/v2/messages/37?transactionHash="+encodeURIComponent(sourceHash),{signal:AbortSignal.timeout(12000),redirect:"error",headers:{Accept:"application/json"}});
  if(response.status===404)return null;
  if(!response.ok)throw new BridgePending(response.status===429?"CCTP_RATE_LIMIT":"CCTP_ATTESTATION_UNAVAILABLE","Circle attestation service is temporarily unavailable; the existing burn will be retried.");
  const reader=response.body?.getReader();requireValue(reader,"Circle returned no attestation body.");let size=0;const parts:Uint8Array[]=[];
  while(true){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>131072){await reader.cancel();throw new BridgeFailure("CCTP_INVALID_RESPONSE","Circle attestation response exceeded128KiB.");}parts.push(x.value);}
  let result;try{result=JSON.parse(Buffer.concat(parts).toString())}catch{throw new BridgeFailure("CCTP_INVALID_RESPONSE","Circle attestation returned invalid JSON.");}
  requireValue(typeof result.sourceTxHash==="string"&&result.sourceTxHash.toLowerCase()===sourceHash.toLowerCase()&&Array.isArray(result.messages),"Circle attestation response is not bound to the source burn.");
  const available=result.messages.filter((x:any)=>x.cctpVersion===2&&x.status==="complete"&&typeof x.message==="string"&&/^0x[0-9a-fA-F]+$/.test(x.message)&&typeof x.attestation==="string"&&/^0x(?:[0-9a-fA-F]{130})+$/.test(x.attestation));
  if(!available.length)return null;requireValue(available.length===1,"Ambiguous CCTP burn attestations.");return available[0] as {message:string;attestation:string};
 }
 async sendMint(card:Card,p:Payment,id:TestnetChainId,message:string,attestation:string){
  if(process.env.GITHUB_ACTIONS!=="true")throw new BridgeFailure("ACTIONS_WORKER_REQUIRED","CCTP signing is restricted to the GitHub Actions worker.");
  const d=this.destination(id);requireValue(await d.public.getChainId()===id,"Destination RPC chain mismatch.");
  const privateKey=process.env.XLAYER_OPERATOR_PRIVATE_KEY;requireValue(privateKey,"Worker bridge signing key is unavailable.");const account=privateKeyToAccount(hex(privateKey));requireValue(account.address.toLowerCase()===this.evm.cfg.gateway?.toLowerCase(),"Destination relayer key mismatch.");
  const wallet=createWalletClient({chain:d.chain,account,transport:http(d.rpc,{timeout:12000,retryCount:0})}),key="cctp:"+id+":"+p._id+":receive";
  let saved=await this.store.get<Doc&{hash:Hex;raw:Hex}>("transactions",key),receipt=saved?await d.public.getTransactionReceipt({hash:saved.hash}).catch(()=>null):null;
  if(receipt?.status==="reverted"){await this.store.create("transactions",{...saved!,_id:key+":failed:"+saved!.hash,failedAt:Date.now()});await this.store.take("transactions",key);saved=null;receipt=null;}
  if(!saved){
   if(await d.public.getBalance({address:account.address})===0n)throw new BridgePending("DESTINATION_GAS_REQUIRED","The Actions relayer needs test ETH on the destination chain. The source burn remains durable; it will not be repeated.");
   const nonce=Math.max(...await Promise.all(["latest","pending"].map(blockTag=>d.public.getTransactionCount({address:account.address,blockTag:blockTag as "latest"|"pending"}))));
   const data=encodeFunctionData({abi:transmitterAbi,functionName:"receiveMessage",args:[hex(message),hex(attestation)]}),prepared=await wallet.prepareTransactionRequest({to:d.c.transmitter,data,nonce});prepared.gas=prepared.gas*125n/100n+50000n;
   const raw=await wallet.signTransaction(prepared),candidate={_id:key,hash:keccak256(raw),raw,createdAt:Date.now(),blockStart:(await d.public.getBlockNumber()).toString()};saved=await this.store.create("transactions",candidate)?candidate:await this.store.get("transactions",key);
  }
  requireValue(saved,"Destination transaction persistence failed.");
  if(!receipt){await wallet.sendRawTransaction({serializedTransaction:saved.raw}).catch(async error=>{if(!await d.public.getTransaction({hash:saved!.hash}).catch(()=>null))throw error;});receipt=await d.public.waitForTransactionReceipt({hash:saved.hash,confirmations:2,timeout:25000,pollingInterval:1000});}
  return verifyDestinationReceipt(receipt,message,card,p.canonical!);
 }
 async reconcile(card:Card,p:Payment):Promise<Record<string,unknown>>{
  requireValue(p.canonical&&p.review&&p.requestHash&&isBridge(card,p),"Bridge reconciliation requires a committed reviewed request.");
  const r=p.canonical,d=this.destination(r.destinationChainId as TestnetChainId);requireValue(await d.public.getChainId()===r.destinationChainId,"Destination RPC chain mismatch.");requireValue(await d.public.readContract({address:d.c.transmitter,abi:transmitterAbi,functionName:"localDomain"})===r.destinationDomain,"Destination transmitter domain mismatch.");
  const source=await this.sourceMessage(card,p),base:BridgeView={protocol:"CCTP_V2",phase:"BURNED",sourceChainId:1952,destinationChainId:r.destinationChainId!,destinationDomain:r.destinationDomain!,sourceToken:CCTP_TESTNETS[1952].token,destinationToken:d.c.token,amount:p.input.amount,sourceTxHash:source.sourceHash,updatedAt:Date.now(),...p.bridge};
  let message=p.cctpMessage,attestation=p.cctpAttestation;
  if(!message||!attestation){const proof=await this.attestation(source.sourceHash);if(!proof)return {status:"AWAITING_ATTESTATION",bridge:{...base,phase:"ATTESTATION_PENDING",updatedAt:Date.now()}};const parsed=verifyCctpMessage(proof.message,card,r,true,source.message);return {status:"MINTING",cctpMessage:proof.message,cctpAttestation:proof.attestation,bridge:{...base,phase:"ATTESTED",messageHash:keccak256(hex(proof.message)),nonce:parsed.nonce,updatedAt:Date.now()}};}
  const parsed=verifyCctpMessage(message,card,r,true,source.message),messageHash=keccak256(hex(message));requireValue(!base.messageHash||base.messageHash===messageHash,"Stored attestation hash changed.");
  const receiptInfo=await this.evm.public.readContract({address:addr(card.address),abi:bridgeAbi,functionName:"getBridgeRequest",args:[hex(p._id)]}) as {destinationTxHash:Hex;sourceTxHash:Hex;messageHash:Hex;routeHash:Hex};
  requireValue(receiptInfo.routeHash===bridgeRouteHash(r.destinationDomain!,r.recipient,BigInt(r.amountAtomic)),"Source route commitment changed.");
  let destinationHash=base.destinationTxHash as Hex|undefined;
  const journal=await this.store.get<Doc&{hash:Hex;blockStart?:string}>("transactions","cctp:"+d.c.chainId+":"+p._id+":receive");
  if(!destinationHash&&receiptInfo.destinationTxHash!==zero)destinationHash=receiptInfo.destinationTxHash;
  if(!destinationHash&&journal){const received=await d.public.getTransactionReceipt({hash:journal.hash}).catch(()=>null);if(received?.status==="success")destinationHash=journal.hash;}
  if(!destinationHash){
   const used=await d.public.readContract({address:d.c.transmitter,abi:transmitterAbi,functionName:"usedNonces",args:[parsed.nonce]});
   if(used===0n){
    // The exact attested payload was durably saved on the previous tick.
    await this.sendMint(card,{...p,bridge:base},d.c.chainId, message,attestation);
    const sent=await this.store.get<Doc&{hash:Hex}>("transactions","cctp:"+d.c.chainId+":"+p._id+":receive");requireValue(sent,"Mint transaction journal missing.");destinationHash=sent.hash;
   }else{
    // Any relayer may submit this exact Circle-signed message. Discover its nonce event incrementally.
    const latest=await d.public.getBlockNumber(),to=BigInt(String(p.destinationScanTo??latest)),from=to>4999n?to-4999n:0n,event=transmitterAbi.find(e=>e.type==="event"&&e.name==="MessageReceived")!;
    const logs=await d.public.getLogs({address:d.c.transmitter,event:event as any,args:{nonce:parsed.nonce},fromBlock:from,toBlock:to});
    if(!logs.length){if(from===0n)throw new BridgeFailure("BRIDGE_RECEIPT_UNAVAILABLE","Circle nonce is used but no matching mint receipt was found. Operator reconciliation is required; this burn must not be repeated.");return {status:"MINTING",destinationScanTo:(from-1n).toString(),bridge:{...base,phase:"MINT_SUBMITTED",nonce:parsed.nonce,messageHash,updatedAt:Date.now()},errorCode:"BRIDGE_RECEIPT_DISCOVERY",error:"Destination message was received. The worker is locating its exact receipt."};}
    requireValue(logs.length===1,"Multiple destination events for the CCTP nonce.");destinationHash=logs[0].transactionHash!;
   }
  }
  const receipt=await d.public.getTransactionReceipt({hash:destinationHash});verifyDestinationReceipt(receipt,message,card,r);requireValue(await d.public.getBlockNumber()>=receipt.blockNumber+1n,"Destination mint awaits confirmation.");
  const chain=await this.evm.request(card,p._id);
  if(chain.status===2){requireValue(receiptInfo.sourceTxHash.toLowerCase()===source.sourceHash.toLowerCase()&&receiptInfo.destinationTxHash===destinationHash&&receiptInfo.messageHash===messageHash,"Vault confirmation differs from verified bridge receipts.");return {status:"PAID",paymentTxHash:destinationHash,bridge:{...base,phase:"CONFIRMED",messageHash,nonce:parsed.nonce,destinationTxHash:destinationHash,confirmationTxHash:(await this.store.get<Doc&{hash:Hex}>("transactions",p._id+":bridge-confirm"))?.hash,updatedAt:Date.now()}};}
  // Persist observed destination receipt before issuing an acknowledgement.
  if(!p.bridge?.destinationTxHash)return {status:"MINTING",bridge:{...base,phase:"MINT_SUBMITTED",messageHash,nonce:parsed.nonce,destinationTxHash:destinationHash,updatedAt:Date.now()}};
  const privateKey=process.env.REVIEW_ATTESTOR_PRIVATE_KEY;requireValue(privateKey,"Bridge receipt attestor key is unavailable.");requireValue(process.env.GITHUB_ACTIONS==="true","Bridge acknowledgement must originate from the Actions worker.");const signer=privateKeyToAccount(hex(privateKey));requireValue(signer.address.toLowerCase()===this.evm.cfg.attestor?.toLowerCase(),"Bridge receipt attestor mismatch.");
  const signature=await signer.signTypedData({domain:{name:"IntentGuard",version:"2",chainId:1952,verifyingContract:addr(card.address)},primaryType:"BridgeReceipt",types:{BridgeReceipt:artifacts.bridgeReceipt.fields.map(([name,type])=>({name,type}))},message:{requestId:hex(p._id),requestHash:hex(p.requestHash),routeHash:bridgeRouteHash(r.destinationDomain!,r.recipient,BigInt(r.amountAtomic)),sourceTxHash:hex(source.sourceHash),destinationTxHash:destinationHash,messageHash,amount:BigInt(r.amountAtomic)}});
  const confirmationTxHash=await this.evm.execute(p._id+":bridge-confirm",card.address,"confirmBridge",[hex(p._id),hex(source.sourceHash),destinationHash,messageHash,signature],bridgeAbi);
  return {status:"PAID",paymentTxHash:destinationHash,bridge:{...base,phase:"CONFIRMED",messageHash,nonce:parsed.nonce,destinationTxHash:destinationHash,confirmationTxHash,updatedAt:Date.now()}};
 }
}
