import {test} from "node:test";
import assert from "node:assert/strict";
import {GenLayer,normalizedCalldata,type GenLayerPort} from "../apps/web/lib/genlayer";
import {MemoryStore} from "../apps/web/lib/store";
import {configuration,STUDIONET_CONSENSUS} from "../apps/web/lib/config";
import {Worker} from "../apps/web/lib/worker";
import {assertCardEnvironment,paymentDestination,normalizeSettlement,cardContractVersion} from "../apps/web/lib/settlement";
import {card,FakeEvm,FakeGenLayer} from "./fixtures";
import {sourceToken} from "../packages/shared/payment-profiles";
import type {Card} from "../apps/web/lib/models";
const genesis="0x"+"00".repeat(32),key="0x"+"11".repeat(32);
const values={INTENTGUARD_MODE:"mainnet",INTENTGUARD_PAYMENT_ENV:"mainnet",XLAYER_CHAIN_ID:"196",MONGODB_DB:"intentguard_mainnet",GENLAYER_NETWORK:"studionet",GENLAYER_GENESIS_HASH:genesis,GENLAYER_CONSENSUS_ADDRESS:STUDIONET_CONSENSUS,GENLAYER_OPERATOR_PRIVATE_KEY:key,APP_URL:"https://mainnet.intentguard.example"};
async function env(check:()=>Promise<void>){const prior=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));try{Object.assign(process.env,values);await check()}finally{for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;}}
function mainnetCard(asset:"USDC"|"USDT0"="USDC"):Card{return {...card,token:sourceToken("mainnet",asset),chainId:196,settlement:{version:2,paymentEnvironment:"mainnet",asset,destinationChainIds:asset==="USDC"?[196,8453]:[196]},reviewerVersion:4,paymentEnvironment:"mainnet",reviewNetwork:"studionet",reviewGenesis:genesis,reviewConsensus:STUDIONET_CONSENSUS};}
test("mainnet money uses chain196 while V4 reviewer binds Studionet testnet profile",()=>env(async()=>{
 for(const asset of ["USDC","USDT0"] as const){
  const c=mainnetCard(asset),gl=new GenLayer(new MemoryStore());
  assertCardEnvironment(c);
  const args=normalizedCalldata(gl.reviewerArgs(c)) as unknown[];
  assert.equal(args[3],196);assert.equal(args[4],sourceToken("mainnet",asset));
  assert.deepEqual(JSON.parse(String(args[6])),{version:4,paymentEnvironment:"mainnet",reviewEnvironment:"testnet"});
  assert.match((await gl.reviewerSource(4)).toString(),/def get_settlement_profile_hash/);
 }
}));
test("cross-environment and altered reviewer bindings fail before execution",()=>env(async()=>{
 const c=mainnetCard();
 for(const changed of [{chainId:1952},{paymentEnvironment:"testnet"},{reviewerVersion:3},{reviewNetwork:"bradbury"},{reviewGenesis:"0x"+"11".repeat(32)},{reviewConsensus:card.address},{token:sourceToken("testnet","USDC")},{settlement:{version:2,paymentEnvironment:"testnet",asset:"USDC",destinationChainIds:[1952]}}])assert.throws(()=>assertCardEnvironment({...c,...changed} as Card));
 assert.throws(()=>normalizeSettlement(undefined));
 assert.throws(()=>normalizeSettlement({asset:"USDC",destinationChainIds:[1952]}));
 assert.throws(()=>paymentDestination(c,{...importInput(),destinationChainId:84532}));
 const usdt=mainnetCard("USDT0");assert.equal(cardContractVersion(usdt),1);assert.equal(cardContractVersion(c),4);
 assert.throws(()=>paymentDestination(usdt,{...importInput(),destinationChainId:8453}));
}));
function importInput(){return {recipient:card.owner,amount:"1",purchaseDescription:"Research purchase",justification:"Research",category:"data",invoiceId:"fresh",evidence:[{url:"https://merchant.example/invoice"}]};}
test("worker persists V4 after deploying V4 and does not downgrade its readiness check",()=>env(async()=>{
 const store=new MemoryStore(),c={...mainnetCard(),state:"SETTING_UP",reviewerTx:undefined};const gl:GenLayerPort=new FakeGenLayer();
 await store.create("cards",c);let deployed=0,verified=0;
 gl.deployReviewer=async actual=>{assert.equal(actual.reviewerVersion,4);deployed++;return "0x"+"aa".repeat(32)};
 gl.reviewer=async actual=>{assert.equal(actual.reviewerVersion,4);verified++;return card.address};
 const worker=new Worker(store,new FakeEvm(),gl);await worker.tick();
 assert.equal((await store.get<Card>("cards",c._id))!.reviewerVersion,4);
 await store.patch("cards",c._id,{nextAt:0});await worker.tick();
 assert.equal((await store.get<Card>("cards",c._id))!.state,"READY");assert.equal(deployed,1);assert.equal(verified,1);
}));
test("Studionet identity rejects wrong chain or simulator reset before journal recovery",()=>env(async()=>{
 const store=new MemoryStore(),gl=new GenLayer(store);
 Object.defineProperty(gl,"public",{value:{getChainId:async()=>61999,getBlock:async()=>({hash:genesis})},configurable:true});
 await gl.identity();
 Object.defineProperty(gl,"public",{value:{getChainId:async()=>4221,getBlock:async()=>({hash:genesis})},configurable:true});await assert.rejects(gl.identity(),/review network/);
 Object.defineProperty(gl,"public",{value:{getChainId:async()=>61999,getBlock:async()=>({hash:"0x"+"ff".repeat(32)})},configurable:true});await assert.rejects(gl.identity(),/genesis/);
 Object.defineProperty(gl,"public",{value:{getChainId:async()=>61999,getBlock:async()=>({hash:genesis})},configurable:true});
 await store.create("transactions",{_id:"gl:copied",protocolHash:"0x"+"aa".repeat(32),binding:{paymentEnvironment:"testnet"}});
 await assert.rejects(gl.send("copied",async()=>assert.fail("must not sign")),/another deployment/);
 assert.equal(configuration().chainId,196);
}));
