import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {createApi} from "../apps/web/lib/api";
import {session} from "../apps/web/lib/auth";
import {MemoryStore} from "../apps/web/lib/store";
import {STUDIONET_CONSENSUS} from "../apps/web/lib/config";
import {card,input,owner,FakeEvm} from "./fixtures";
import {digest} from "../packages/shared";
import type {Draft} from "../apps/web/lib/models";
const origin="https://testnet.intentguard.example",a=owner,b=input.recipient,h="0x"+"33".repeat(32),genesis="0x"+"00".repeat(32);
async function fixture(check:(t:{store:MemoryStore;api:ReturnType<typeof createApi>;original:typeof card})=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),"intentguard-replacement-")),path=join(directory,"release.json");
 const values={INTENTGUARD_MODE:"testnet",INTENTGUARD_PAYMENT_ENV:"testnet",XLAYER_CHAIN_ID:"1952",MONGODB_DB:"intentguard",APP_URL:origin,GENLAYER_NETWORK:"studionet",GENLAYER_GENESIS_HASH:genesis,GENLAYER_CONSENSUS_ADDRESS:STUDIONET_CONSENSUS,INTENTGUARD_RELEASE_ID:"testnet-replacement",INTENTGUARD_SOURCE_COMMIT:"a".repeat(40),INTENTGUARD_VERIFIED_MANIFEST:path,INTENTGUARD_VERIFIED_MANIFEST_SHA256:"",SESSION_SECRET:"replacement-test-session-over-32-characters",CARD_FACTORY_ADDRESS:a,CCTP_CARD_FACTORY_ADDRESS:b,GATEWAY_ADDRESS:a,ATTESTOR_ADDRESS:b,TAPEOUT_PROCESSOR:a,TAPEOUT_BEACON:a,TAPEOUT_IMPLEMENTATION:a,TAPEOUT_CIRCUIT_ID:"1",TAPEOUT_NETLIST_HASH:h,GENLAYER_INTERPRETER_ADDRESS:a};
 const prior=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
 try{
  Object.assign(process.env,values);
  const manifest={version:1,paymentEnvironment:"testnet",paymentChainId:1952,releaseId:values.INTENTGUARD_RELEASE_ID,sourceCommit:values.INTENTGUARD_SOURCE_COMMIT,applicationOrigin:origin,databaseName:"intentguard",reviewEnvironment:"testnet",reviewNetwork:"studionet",reviewGenesis:genesis,reviewConsensus:STUDIONET_CONSENSUS,contracts:{factoryAddress:a,cctpFactoryAddress:b,gateway:a,attestor:b,processor:a,beacon:a,expectedImplementation:a,interpreter:a},circuitId:"1",netlistHash:h,codeHashes:{factoryAddress:h,cctpFactoryAddress:h,processor:h,beacon:h,expectedImplementation:h},enabledAssets:["USDC"],verifiedDestinationChainIds:[1952,84532],verifiedAt:"2026-10-26T00:00:00.000Z"};
  const bytes=JSON.stringify(manifest);await writeFile(path,bytes);process.env.INTENTGUARD_VERIFIED_MANIFEST_SHA256=createHash("sha256").update(bytes).digest("hex");
  const original={...card,chainId:1952,reviewerVersion:1},store=new MemoryStore();await store.create("cards",original);
  await check({store,api:createApi(store,new FakeEvm(),{requireConfigured:false,wake:()=>{}}),original});
 }finally{for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;await rm(directory,{recursive:true,force:true});}
}
function request(path:string,account=owner,value?:unknown,requestOrigin=origin){return new Request(origin+"/api/v1"+path,{method:value===undefined?"GET":"POST",headers:{cookie:"ig_session="+session(account),Origin:requestOrigin,"Content-Type":"application/json"},...(value===undefined?{}:{body:JSON.stringify(value)})});}
const selected={version:2,paymentEnvironment:"testnet",asset:"USDC",destinationChainIds:[1952,84532]};
test("replacement details require the owning session and disclose pending work and accounting reset",()=>fixture(async t=>{
 const path="/owner/cards/"+card._id+"/replacement";await t.store.create("requests",{_id:"pending",cardId:card._id,status:"RESERVED",input,createdAt:1});
 assert.equal((await t.api(request(path,input.recipient),path)).status,404);
 assert.equal((await t.api(new Request(origin+"/api/v1"+path),path)).status,401);
 const response=await t.api(request(path),path);assert.equal(response.status,200);const value=await response.json();assert.equal(value.sourceEnvironment,"testnet");assert.equal(value.sourceReviewerVersion,1);assert.equal(value.pendingCount,1);assert.equal(value.accountingReset,true);assert.ok(value.warnings.some((s:string)=>s.includes("Lifetime budgets")));
}));
test("explicit owner replacement copies policy once while leaving funds, reviewer and history untouched",()=>fixture(async t=>{
 const path="/owner/cards/"+card._id+"/replacement",historic={_id:"history",cardId:card._id,status:"PAID",input,createdAt:1};await t.store.create("requests",historic);
 const body={settlement:selected,acknowledgeAccountingReset:true},responses=await Promise.all([t.api(request(path,owner,body),path),t.api(request(path,owner,body),path)]);
 for(const response of responses)assert.equal(response.status,201);
 const values=await Promise.all(responses.map(response=>response.json()));assert.equal(values[0].id,values[1].id);
 const drafts=await t.store.find<Draft>("drafts",{});assert.equal(drafts.length,1);assert.equal(drafts[0].replacesCardId,card._id);assert.equal(drafts[0].state,"FINALIZED");assert.equal(digest(drafts[0].result!.policy),card.policyHash);assert.deepEqual(drafts[0].settlement,selected);
 assert.deepEqual(await t.store.get("cards",card._id),t.original);assert.deepEqual(await t.store.get("requests","history"),historic);assert.equal((await t.store.find("keys",{})).length,0);assert.equal((await t.store.find("transactions",{})).length,0);
}));
test("replacement refuses missing acknowledgement, cross-origin, extra policy overrides and cross-environment settlement",()=>fixture(async t=>{
 const path="/owner/cards/"+card._id+"/replacement";
 for(const body of [{settlement:selected},{settlement:selected,acknowledgeAccountingReset:true,policy:{...card.policy}},{settlement:{...selected,paymentEnvironment:"mainnet",destinationChainIds:[196]},acknowledgeAccountingReset:true}])assert.equal((await t.api(request(path,owner,body),path)).status,422);
 assert.equal((await t.api(request(path,owner,{settlement:selected,acknowledgeAccountingReset:true},"https://evil.example"),path)).status,403);
 assert.equal((await t.store.find("drafts",{})).length,0);
}));
