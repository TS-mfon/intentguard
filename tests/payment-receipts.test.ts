import {test} from "node:test";
import assert from "node:assert/strict";
import {encodeEventTopics,encodeAbiParameters,parseAbi,type Hex,type TransactionReceipt} from "viem";
import artifacts from "../contracts/evm/abi.json";
import {digest} from "../packages/shared";
import {Evm} from "../apps/web/lib/evm";
import {Worker,requestId} from "../apps/web/lib/worker";
import {MemoryStore} from "../apps/web/lib/store";
import type {Payment} from "../apps/web/lib/models";
import {card,input,owner,invoice,FakeEvm,FakeGenLayer} from "./fixtures";
const hash=("0x"+"66".repeat(32)) as Hex,transfer=parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
async function prepared(){
 const store=new MemoryStore(),evm=new FakeEvm(),gl=new FakeGenLayer();await store.create("cards",card);await store.create("keys",{_id:"key",cardId:card._id,owner,revoked:false});
 const p:Payment={_id:requestId(),owner,cardId:card._id,keyId:"key",input,inputHash:digest(input),status:"QUEUED",createdAt:Date.now(),updatedAt:Date.now()};await store.create("requests",p);
 const worker=new Worker(store,evm,gl,async()=>invoice());for(let i=0;i<4;i++){const current=(await store.get<Payment>("requests",p._id))!;await store.patch("requests",p._id,await worker.payment(current));}
 return {store,p:(await store.get<Payment>("requests",p._id))!};
}
function receipt(p:Payment):TransactionReceipt{
 return {status:"success",transactionHash:hash,blockNumber:10n,logs:[
 {address:card.address,topics:encodeEventTopics({abi:artifacts.AgentSpendingCard,eventName:"Paid",args:{requestId:p._id as Hex}}),data:encodeAbiParameters([{type:"bytes32"},{type:"bytes32"},{type:"address"},{type:"uint64"}],[digest(p.review) as Hex,p.genLayerTxHash as Hex,input.recipient as Hex,BigInt(p.canonical!.amountAtomic)])},
 {address:card.token,topics:encodeEventTopics({abi:transfer,eventName:"Transfer",args:{from:card.address as Hex,to:input.recipient as Hex}}),data:encodeAbiParameters([{type:"uint256"}],[BigInt(p.canonical!.amountAtomic)])}
 ]} as unknown as TransactionReceipt;
}
function client(store:MemoryStore,result:TransactionReceipt){
 const mock={store,identity:async()=>{},public:{getTransactionReceipt:async()=>result,waitForTransactionReceipt:async()=>result,getBlockNumber:async()=>11n,getLogs:async()=>[]}};
 return Object.setPrototypeOf(mock,Evm.prototype) as Evm;
}
test("S05 an unrelated successful journal receipt cannot establish PAID",async()=>{
 const t=await prepared();await t.store.create("transactions",{_id:t.p._id+":settle",hash});const result=receipt(t.p);result.logs=[];await assert.rejects(client(t.store,result).paidHash(card,t.p));
});
test("exact Paid and token Transfer events establish the direct-payment receipt",async()=>{
 const t=await prepared();await t.store.create("transactions",{_id:t.p._id+":settle",hash});assert.equal(await client(t.store,receipt(t.p)).paidHash(card,t.p),hash);
});

test("wrong token, vault, recipient, amount, decision, duplicate transfer and insufficient confirmation cannot establish payment",async()=>{
 const t=await prepared();await t.store.create("transactions",{_id:t.p._id+":settle",hash});
 for(const variant of ["token","vault","recipient","amount","decision","duplicate","confirmations"]){
  const result=receipt(t.p);
  if(variant==="token")result.logs[1].address=owner as Hex;
  if(variant==="vault")result.logs[0].address=owner as Hex;
  if(variant==="recipient")result.logs[1].topics=encodeEventTopics({abi:transfer,eventName:"Transfer",args:{from:card.address as Hex,to:owner as Hex}}) as [Hex,...Hex[]];
  if(variant==="amount")result.logs[1].data=encodeAbiParameters([{type:"uint256"}],[1n]);
  if(variant==="decision")result.logs[0].data=encodeAbiParameters([{type:"bytes32"},{type:"bytes32"},{type:"address"},{type:"uint64"}],[("0x"+"ff".repeat(32)) as Hex,t.p.genLayerTxHash as Hex,input.recipient as Hex,BigInt(t.p.canonical!.amountAtomic)]);
  if(variant==="duplicate")result.logs.push(result.logs[1]);
  const evm=client(t.store,result);if(variant==="confirmations")(evm.public as any).getBlockNumber=async()=>10n;
  await assert.rejects(evm.paidHash(card,t.p),variant);
 }
});
