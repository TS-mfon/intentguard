import {test} from "node:test";
import assert from "node:assert/strict";
import {MemoryStore} from "../apps/web/lib/store";
import {createApi} from "../apps/web/lib/api";
import {session,issueKey} from "../apps/web/lib/auth";
import {digest,type Settlement} from "../packages/shared";
import {CCTP_TESTNETS} from "../packages/shared/assets";
import {card,owner,input,policy,FakeEvm} from "./fixtures";
const origin="http://localhost:3000";
Object.assign(process.env,{SESSION_SECRET:"test-session-secret-at-least-32-characters",APP_URL:origin,INTENTGUARD_MODE:"testnet",XLAYER_CHAIN_ID:"1952",PAYMENT_TOKEN:"0x"+"99".repeat(20),CARD_FACTORY_ADDRESS:owner,CCTP_CARD_FACTORY_ADDRESS:input.recipient,GATEWAY_ADDRESS:owner,ATTESTOR_ADDRESS:owner,TAPEOUT_PROCESSOR:owner,TAPEOUT_BEACON:owner,TAPEOUT_IMPLEMENTATION:owner,TAPEOUT_CIRCUIT_ID:"1",TAPEOUT_NETLIST_HASH:"0x"+"11".repeat(32),GENLAYER_INTERPRETER_ADDRESS:owner,MONGODB_URI:"mongodb://test-only.example",DEMO_MERCHANT_ADMIN_KEY:"test-merchant-admin-at-least-32-characters",DEMO_MERCHANT_RECIPIENT:input.recipient});
const settlement:Settlement={asset:"USDC",destinationChainIds:[1952,84532,421614]};
const ownerRequest=(path:string,body?:unknown,account=owner)=>new Request(origin+"/api/v1"+path,{method:body===undefined?"GET":"POST",headers:{Origin:origin,Cookie:"ig_session="+session(account),"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
test("selected USDC destinations persist before proposal and bind activation token and allowed domains",async()=>{
 const s=new MemoryStore(),api=createApi(s,new FakeEvm(),{wake:()=>undefined});
 const body={description:policy.mission,guidance:policy,settlement:{asset:"USDC",destinationChainIds:[421614,1952,84532]}};
 const response=await api(ownerRequest("/owner/drafts",body),"/owner/drafts");assert.equal(response.status,202);
 const id=(await response.json()).id,draft=(await s.get("drafts",id))!;assert.deepEqual(draft.settlement,settlement);assert.equal(draft.inputHash,digest({description:policy.mission,guidance:policy}));assert.equal((draft.input as any).settlement,undefined);
 await s.patch("drafts",id,{state:"FINALIZED",result:{status:"PROPOSED",policy,questions:[],interpretation:"Exact owner permission"}});
 const final=await (await api(ownerRequest("/owner/drafts/"+id),"/owner/drafts/"+id)).json();assert.equal(final.activation.config.token,CCTP_TESTNETS[1952].token);assert.equal(final.activation.kind,"CCTP_V2");assert.deepEqual(final.activation.destinationDomains,[37,6,3]);
 assert.equal((await api(ownerRequest("/owner/drafts/"+id,undefined,input.recipient),"/owner/drafts/"+id)).status,404);
 const registered=await api(ownerRequest("/owner/cards",{draftId:id,cardAddress:card.address,activationTx:card.activationTx}),"/owner/cards");assert.equal(registered.status,201);assert.deepEqual((await s.get("cards",id))?.settlement,settlement);assert.equal((await s.get("cards",id))?.token,CCTP_TESTNETS[1952].token);assert.equal((await s.get("cards",id))?.chainId,1952);
});
test("unsupported assets and missing factory fail before queue admission with machine-readable codes",async()=>{
 const s=new MemoryStore(),api=createApi(s,new FakeEvm(),{wake:()=>undefined}),body={description:policy.mission,guidance:policy};
 const rejected=await api(ownerRequest("/owner/drafts",{...body,settlement:{asset:"USDT0",destinationChainIds:[1952]}}),"/owner/drafts");assert.equal(rejected.status,422);assert.equal((await rejected.json()).error.code,"ASSET_OR_ROUTE_UNSUPPORTED");assert.equal((await s.find("drafts",{})).length,0);
 const old=process.env.CCTP_CARD_FACTORY_ADDRESS;delete process.env.CCTP_CARD_FACTORY_ADDRESS;
 try{const missing=await api(ownerRequest("/owner/drafts",{...body,settlement}),"/owner/drafts");assert.equal(missing.status,503);assert.equal((await missing.json()).error.code,"BRIDGE_NOT_CONFIGURED");assert.equal((await s.find("drafts",{})).length,0);}finally{process.env.CCTP_CARD_FACTORY_ADDRESS=old;}
});
test("destination-chain admission binds idempotency and excludes mainnet or unapproved permissions",async()=>{
 const s=new MemoryStore(),usdc={...card,token:CCTP_TESTNETS[1952].token,chainId:1952,settlement};await s.create("cards",usdc);const key=await issueKey(s,card._id,owner),api=createApi(s,new FakeEvm(),{wake:()=>undefined});
 const post=(destinationChainId:number,idem="one")=>api(new Request(origin+"/api/v1/requests",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json","Idempotency-Key":idem},body:JSON.stringify({...input,destinationChainId})}),"/requests");
 assert.equal((await post(84532)).status,202);assert.equal((await post(84532)).status,202);assert.equal((await post(421614)).status,409);const mainnet=await post(8453,"mainnet");assert.equal(mainnet.status,422);assert.equal((await mainnet.json()).error.code,"DESTINATION_NOT_ALLOWED");assert.equal((await s.find("requests",{})).length,1);
 await s.patch("cards",card._id,{settlement:{asset:"USDC",destinationChainIds:[1952]}});const denied=await post(421614,"arbitrum");assert.equal(denied.status,422);assert.equal((await denied.json()).error.code,"DESTINATION_NOT_ALLOWED");
});
test("merchant invoices accept only paired official destination USDC metadata and preserve exact immutable bytes",async()=>{
 const s=new MemoryStore(),api=createApi(s,new FakeEvm(),{wake:()=>undefined}),body={buyer:card.address,amount:"0.100001",description:"Native USDC settlement verification"},post=(value:unknown)=>api(new Request(origin+"/api/v1/demo/invoices",{method:"POST",headers:{Authorization:"Bearer "+process.env.DEMO_MERCHANT_ADMIN_KEY,"Content-Type":"application/json"},body:JSON.stringify(value)}),"/demo/invoices");
 const incomplete=await post({...body,chainId:84532});assert.equal(incomplete.status,422);assert.equal((await incomplete.json()).error.code,"INVOICE_ASSET_REQUIRED");
 for(const extra of [{chainId:8453,token:CCTP_TESTNETS[84532].token},{chainId:1952,token:"0x779Ded0c9e1022225f8E0630b35a9b54bE713736"}]){const response=await post({...body,...extra});assert.equal(response.status,422);assert.equal((await response.json()).error.code,"ASSET_OR_ROUTE_UNSUPPORTED");}
 const good=await post({...body,chainId:421614,token:CCTP_TESTNETS[421614].token});assert.equal(good.status,201);const result=await good.json();assert.equal(result.invoice.chainId,421614);assert.equal(result.invoice.token,CCTP_TESTNETS[421614].token.toLowerCase());const path=new URL(result.url).pathname.replace("/api/v1",""),response=await api(new Request(result.url),path);assert.deepEqual(await response.json(),result.invoice);
});
