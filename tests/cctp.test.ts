import {test} from "node:test";
import assert from "node:assert/strict";
import {encodeEventTopics,encodeAbiParameters,parseAbi,padHex,type Hex,type TransactionReceipt} from "viem";
import {digest,parseAmount,settlementSchema,type CanonicalRequest,type Settlement} from "../packages/shared";
import {CCTP_TESTNETS} from "../packages/shared/assets";
import {normalizeSettlement,paymentDestination,canonicalDestination} from "../apps/web/lib/settlement";
import {parseCctpMessage,verifyCctpMessage,verifyDestinationReceipt,BridgePending,BridgeFailure,Cctp} from "../apps/web/lib/cctp";
import {Worker,requestId} from "../apps/web/lib/worker";
import {MemoryStore} from "../apps/web/lib/store";
import type {Card,Payment} from "../apps/web/lib/models";
import {card,input,owner,invoice,FakeEvm,FakeGenLayer} from "./fixtures";
const settlement:Settlement={asset:"USDC",destinationChainIds:[1952,84532,421614]};
const usdc:Card={...card,chainId:1952,token:CCTP_TESTNETS[1952].token,settlement};
test("Actions empty destination RPC variables use verified testnet defaults and preserve explicit overrides",()=>{
 const bridge=new Cctp({} as any,new MemoryStore());
 for(const [id,key] of [[84532,"BASE_SEPOLIA_RPC_URL"],[421614,"ARBITRUM_SEPOLIA_RPC_URL"]] as const){
  const previous=process.env[key];
  try{
   delete process.env[key];assert.equal(bridge.destination(id).rpc,CCTP_TESTNETS[id].rpcUrl);
   for(const blank of ["","  ","\t\n"]){process.env[key]=blank;assert.equal(bridge.destination(id).rpc,CCTP_TESTNETS[id].rpcUrl);assert.equal(bridge.destination(id).chain.id,id);}
   process.env[key]="  https://testnet-rpc.example  ";assert.equal(bridge.destination(id).rpc,"https://testnet-rpc.example");
  }finally{if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
 }
 assert.throws(()=>bridge.destination(196 as any));assert.throws(()=>bridge.destination(8453 as any));
});
function canonical(destination=84532):CanonicalRequest{return {...input,...canonicalDestination(usdc,{...input,destinationChainId:destination}),cardId:usdc._id,cardAddress:usdc.address,owner,policyHash:usdc.policyHash,token:usdc.token!,chainId:1952,amountAtomic:parseAmount(input.amount).toString(),evidenceHash:"0x"+"44".repeat(32),expiresAt:4102444799}}
function payload(attested=false,r=canonical()){
 const bytes=Buffer.alloc(376),uint=(offset:number,length:number,value:bigint)=>Buffer.from(value.toString(16).padStart(length*2,"0"),"hex").copy(bytes,offset),address=(offset:number,value:string)=>Buffer.from(padHex(value as Hex,{size:32}).slice(2),"hex").copy(bytes,offset);
 uint(0,4,1n);uint(4,4,37n);uint(8,4,BigInt(r.destinationDomain!));uint(12,32,attested?9n:0n);address(44,CCTP_TESTNETS[1952].messenger);address(76,CCTP_TESTNETS[r.destinationChainId as 84532].messenger);uint(140,4,2000n);uint(144,4,attested?2000n:0n);uint(148,4,1n);address(152,usdc.token!);address(184,r.recipient);uint(216,32,BigInt(r.amountAtomic));address(248,usdc.address);return "0x"+bytes.toString("hex");
}
function tamper(message:string,offset:number){const bytes=Buffer.from(message.slice(2),"hex");bytes[offset]^=1;return "0x"+bytes.toString("hex")}
test("native USDC settlement validates only explicit testnet destinations and preserves legacy assets",()=>{
 assert.deepEqual(normalizeSettlement({asset:"USDC",destinationChainIds:[84532,1952]}),{asset:"USDC",destinationChainIds:[1952,84532]});
 for(const value of [{asset:"USDT0",destinationChainIds:[1952]},{asset:"USDC",destinationChainIds:[196]},{asset:"USDC",destinationChainIds:[]},{asset:"USDC",destinationChainIds:[1952,1952]}])assert.throws(()=>normalizeSettlement(value));
 assert.equal(paymentDestination(usdc,{...input,destinationChainId:84532}).domain,6);
 assert.throws(()=>paymentDestination(usdc,{...input,destinationChainId:8453}));
 assert.throws(()=>paymentDestination({...usdc,settlement:{asset:"USDC",destinationChainIds:[1952]}},{...input,destinationChainId:84532}));
 assert.throws(()=>paymentDestination(card,{...input,destinationChainId:84532}));
 assert.equal(paymentDestination(card,input).token,card.token);
});
test("V2 message parser accepts issuer placeholder fields and verifies finalized attestation changes",()=>{
 const source=payload(),attested=payload(true),r=canonical();assert.equal(parseCctpMessage(source).nonce,padHex("0x0",{size:32}));
 assert.equal(verifyCctpMessage(source,usdc,r,false).amount,5000001n);
 assert.equal(verifyCctpMessage(attested,usdc,r,true,source).finalityExecuted,2000);
 for(const index of [0,4,8,44,76,108,140,148,152,184,216,248,280,312,344])assert.throws(()=>verifyCctpMessage(tamper(attested,index),usdc,r,true,source),"tampering at"+index);
 assert.throws(()=>verifyCctpMessage(source,usdc,r,true,source));assert.throws(()=>verifyCctpMessage(attested+"00",usdc,r,true,source));
 assert.throws(()=>verifyCctpMessage(attested,usdc,{...r,settlementHash:digest({asset:"USDC"})},true,source));
});
function receipt(message=payload(true),changes:{mintAmount?:bigint;token?:string;recipient?:string;sourceDomain?:number;status?:"success"|"reverted"}={}):TransactionReceipt{
 const target=CCTP_TESTNETS[84532],v=parseCctpMessage(message),received=parseAbi(["event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)"]),transfer=parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]),hash=("0x"+"77".repeat(32)) as Hex;
 return {status:changes.status??"success",transactionHash:hash,blockNumber:10n,logs:[
 {address:target.transmitter,topics:encodeEventTopics({abi:received,eventName:"MessageReceived",args:{caller:owner as Hex,nonce:v.nonce,finalityThresholdExecuted:2000}}),data:encodeAbiParameters([{type:"uint32"},{type:"bytes32"},{type:"bytes"}],[changes.sourceDomain??37,v.sender,v.body])},
 {address:changes.token??target.token,topics:encodeEventTopics({abi:transfer,eventName:"Transfer",args:{from:("0x"+"0".repeat(40)) as Hex,to:(changes.recipient??input.recipient) as Hex}}),data:encodeAbiParameters([{type:"uint256"}],[changes.mintAmount??v.amount])}
 ]} as unknown as TransactionReceipt;
}
test("paid requires a successful matching Circle nonce and exact native-USDC mint event",()=>{
 const message=payload(true),r=canonical();assert.equal(verifyDestinationReceipt(receipt(message),message,usdc,r),"0x"+"77".repeat(32));
 for(const change of [{mintAmount:5000000n},{token:owner},{recipient:owner},{sourceDomain:6},{status:"reverted" as const}])assert.throws(()=>verifyDestinationReceipt(receipt(message,change),message,usdc,r));
 const duplicated=receipt(message);duplicated.logs.push(duplicated.logs[1]);assert.throws(()=>verifyDestinationReceipt(duplicated,message,usdc,r));
});
test("Iris responses are bound to source transaction and incomplete proof never becomes available",async()=>{
 const s=new MemoryStore(),hash="0x"+"ab".repeat(32),respond=(value:unknown)=>async()=>Response.json(value);
 const service=(value:unknown)=>new Cctp({} as any,s,respond(value) as typeof fetch);
 assert.equal(await service({sourceTxHash:hash,messages:[{cctpVersion:2,status:"pending_confirmations",message:"0x",attestation:"PENDING"}]}).attestation(hash),null);
 await assert.rejects(()=>service({sourceTxHash:"0x"+"00".repeat(32),messages:[]}).attestation(hash),BridgeFailure);
 const item={cctpVersion:2,status:"complete",message:payload(true),attestation:"0x"+"11".repeat(65)};
 assert.equal((await service({sourceTxHash:hash,messages:[item]}).attestation(hash))?.message,item.message);
 await assert.rejects(()=>service({sourceTxHash:hash,messages:[item,item]}).attestation(hash),BridgeFailure);
});
class BridgeEvm extends FakeEvm{
 reconciliations=0;error?:Error;
 async settle(c:Card,p:Payment){const hash=await super.settle(c,p);this.requests.get(p._id)!.status=5;return hash}
 async reconcileBridge(c:Card,p:Payment){this.reconciliations++;if(this.error)throw this.error;const status=this.reconciliations===1?"AWAITING_ATTESTATION":this.reconciliations===2?"MINTING":"PAID";if(status==="PAID")this.requests.get(p._id)!.status=2;return {status,bridge:{...p.bridge,phase:status==="PAID"?"CONFIRMED":status==="MINTING"?"ATTESTED":"ATTESTATION_PENDING"},...(status==="PAID"?{paymentTxHash:"0x"+"88".repeat(32)}:{})}}
}
async function setup(destination=84532){
 const s=new MemoryStore(),evm=new BridgeEvm(),gl=new FakeGenLayer(),paymentInput={...input,destinationChainId:destination};
 await s.create("cards",usdc);await s.create("keys",{_id:"key",cardId:usdc._id,owner,revoked:false});
 const p:Payment={_id:requestId(),owner,cardId:usdc._id,keyId:"key",input:paymentInput,inputHash:digest(paymentInput),status:"QUEUED",createdAt:Date.now(),updatedAt:Date.now()};await s.create("requests",p);
 const worker=new Worker(s,evm,gl,async()=>JSON.stringify({...JSON.parse(invoice()),token:CCTP_TESTNETS[destination as 84532].token,chainId:destination}));
 const step=async()=>{const current=(await s.get<Payment>("requests",p._id))!,values=await worker.payment(current);await s.patch("requests",p._id,values);return (await s.get<Payment>("requests",p._id))!};return {s,evm,gl,p,worker,step};
}
test("owner deposit funds bridge approval while source burn is never reported paid",async()=>{
 const t=await setup();let p=await t.step();assert.equal(p.canonical?.chainId,1952);assert.equal(p.canonical?.destinationChainId,84532);assert.equal(p.canonical?.settlementHash,digest(settlement));
 await t.step();await t.step();await t.step();p=await t.step();assert.equal(p.status,"BRIDGING");assert.equal(p.paymentTxHash,undefined);
 p=await t.step();assert.equal(p.status,"AWAITING_ATTESTATION");p=await t.step();assert.equal(p.status,"MINTING");p=await t.step();assert.equal(p.status,"PAID");assert.equal(t.evm.settlements,1);assert.equal(t.gl.submissions,1);
});
test("revocation, invoice expiry and cancellation after an irreversible burn still reconcile exact mint",async()=>{
 const t=await setup();for(let i=0;i<5;i++)await t.step();await t.s.patch("keys","key",{revoked:true});await t.s.patch("requests",t.p._id,{cancelRequested:true,cancelTarget:"CANCELLED"});
 const values=await t.step();assert.equal(values.status,"AWAITING_ATTESTATION");assert.equal(t.evm.cancellations,0);await t.step();assert.equal((await t.step()).status,"PAID");assert.equal(t.evm.settlements,1);
});
test("crash between source burn and database update is recovered without another burn",async()=>{
 const t=await setup();for(let i=0;i<4;i++)await t.step();const p=(await t.s.get<Payment>("requests",t.p._id))!;await t.evm.settle(usdc,p);assert.equal(p.status,"APPROVED");const result=await t.step();assert.equal(result.status,"AWAITING_ATTESTATION");assert.equal(t.evm.settlements,1);
});
test("bridge outages past review timeout retain irreversible work and never create semantic cancellation",async()=>{
 for(const error of [new BridgePending("DESTINATION_GAS_REQUIRED","Gas required"),new BridgeFailure("BRIDGE_COMMITMENT_MISMATCH","Receipt mismatch"),Error("RPC unavailable")]){
  const t=await setup();for(let i=0;i<5;i++)await t.step();t.evm.error=error;await t.s.patch("requests",t.p._id,{waitStartedAt:Date.now()-3600000,nextAt:0});await t.worker.tick();const p=(await t.s.get<Payment>("requests",t.p._id))!;assert.ok(["BRIDGING","AWAITING_ATTESTATION","MINTING"].includes(p.status));assert.equal(p.cancelTarget,undefined);assert.equal(t.evm.cancellations,0);assert.equal(t.evm.settlements,1);
 }
});
test("source-chain invoice cannot authorize payment of a destination-chain invoice",async()=>{
 const t=await setup(),worker=new Worker(t.s,t.evm,t.gl,async()=>JSON.stringify({...JSON.parse(invoice()),chainId:1952,token:usdc.token}));const result=await worker.payment(t.p);assert.equal(result.status,"NEEDS_EVIDENCE");assert.equal(result.errorCode,"INVOICE_ASSET_MISMATCH");assert.equal(t.evm.reserves,0);
});
