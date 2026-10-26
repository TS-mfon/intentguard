import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {STUDIONET_CONSENSUS,configuration} from "../apps/web/lib/config";
import {publicDeploymentConfiguration} from "../apps/web/lib/capabilities";
import {createApi} from "../apps/web/lib/api";
import {MemoryStore} from "../apps/web/lib/store";
import {FakeEvm} from "./fixtures";
const a="0x"+"11".repeat(20),b="0x"+"22".repeat(20),h="0x"+"33".repeat(32),genesis="0x"+"00".repeat(32);
async function configured(check:(manifest:Record<string,unknown>,path:string)=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),"intentguard-capabilities-")),path=join(dir,"mainnet.json");
 const values={INTENTGUARD_MODE:"mainnet",INTENTGUARD_PAYMENT_ENV:"mainnet",XLAYER_CHAIN_ID:"196",MONGODB_DB:"intentguard_mainnet",GENLAYER_NETWORK:"studionet",GENLAYER_GENESIS_HASH:genesis,GENLAYER_CONSENSUS_ADDRESS:STUDIONET_CONSENSUS,APP_URL:"https://mainnet.intentguard.example",INTENTGUARD_RELEASE_ID:"beta-1",INTENTGUARD_SOURCE_COMMIT:"a".repeat(40),INTENTGUARD_VERIFIED_MANIFEST:path,INTENTGUARD_VERIFIED_MANIFEST_SHA256:"",MONGODB_URI:"mongodb://intentguard_mainnet_api:fixture@localhost/intentguard_mainnet",SESSION_SECRET:"fixture-session-secret-over-32-characters",GATEWAY_ADDRESS:a,ATTESTOR_ADDRESS:b,CARD_FACTORY_ADDRESS:a,CCTP_CARD_FACTORY_ADDRESS:b,TAPEOUT_PROCESSOR:a,TAPEOUT_BEACON:a,TAPEOUT_IMPLEMENTATION:a,TAPEOUT_CIRCUIT_ID:"1",TAPEOUT_NETLIST_HASH:h,GENLAYER_INTERPRETER_ADDRESS:a};
 const prior=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
 try{
  Object.assign(process.env,values);
  const manifest={version:1,paymentEnvironment:"mainnet",paymentChainId:196,releaseId:"beta-1",sourceCommit:"a".repeat(40),applicationOrigin:values.APP_URL,databaseName:values.MONGODB_DB,reviewEnvironment:"testnet",reviewNetwork:"studionet",reviewGenesis:genesis,reviewConsensus:STUDIONET_CONSENSUS,contracts:{factoryAddress:a,cctpFactoryAddress:b,gateway:a,attestor:b,processor:a,beacon:a,expectedImplementation:a,interpreter:a},circuitId:"1",netlistHash:h,codeHashes:{factoryAddress:h,cctpFactoryAddress:h,processor:h,beacon:h,expectedImplementation:h},enabledAssets:["USDC","USDT0"],verifiedDestinationChainIds:[196,42161],verifiedAt:"2026-10-26T00:00:00.000Z"};
  const bytes=JSON.stringify(manifest);await writeFile(path,bytes);process.env.INTENTGUARD_VERIFIED_MANIFEST_SHA256=createHash("sha256").update(bytes).digest("hex");
  await check(manifest,path);
 }finally{for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;await rm(dir,{recursive:true,force:true});}
}
test("mainnet advertises only assets and destinations in its pinned release",()=>configured(async()=>{
 const c=await publicDeploymentConfiguration();assert.equal(configuration().configured,true);assert.equal(c.configured,true);
 assert.deepEqual(c.assets.map(x=>x.asset),["USDC","USDT0"]);assert.deepEqual(c.spendingNetworks.map(x=>x.chainId),[196,42161]);
 assert.equal(c.reviewChainId,61999);assert.equal(c.reviewInfrastructure,"studionet-simulator");assert.equal(c.chainId,196);
}));
test("tampering or cross-environment capability lists suppress all mainnet authority",()=>configured(async(manifest,path)=>{
 for(const change of [{verifiedDestinationChainIds:[1952]},{verifiedDestinationChainIds:[196,196]},{enabledAssets:["USDC","USDC"]},{reviewConsensus:a}]){
  const bytes=JSON.stringify({...manifest,...change});await writeFile(path,bytes);process.env.INTENTGUARD_VERIFIED_MANIFEST_SHA256=createHash("sha256").update(bytes).digest("hex");
  const c=await publicDeploymentConfiguration();assert.equal(c.configured,false);assert.deepEqual(c.assets,[]);assert.deepEqual(c.spendingNetworks,[]);
 }
 const store=new MemoryStore(),api=createApi(store,new FakeEvm());
 const response=await api(new Request("https://mainnet.intentguard.example/api/v1/me"),"/me");assert.equal(response.status,503);
}));
test("health exposes release and worker freshness without sessions or keys",()=>configured(async()=>{
 const store=new MemoryStore(),api=createApi(store,new FakeEvm());
 let response=await api(new Request("https://mainnet.intentguard.example/api/v1/health"),"/health");assert.equal(response.status,503);
 await store.put("locks",{_id:"worker-runtime",heartbeatAt:Date.now()});response=await api(new Request("https://mainnet.intentguard.example/api/v1/health"),"/health");assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.paymentChainId,196);assert.equal(body.reviewChainId,61999);assert.equal(body.sourceCommit,"a".repeat(40));assert.ok(!JSON.stringify(body).includes("fixture"));
}));
