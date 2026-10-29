import {test} from "node:test";
import assert from "node:assert/strict";
import {createExplorer} from "../apps/web/lib/explorer";
import {createApi} from "../apps/web/lib/api";
import {assertApplicationOrigin} from "../apps/web/lib/origins";
import {MemoryStore} from "../apps/web/lib/store";
import {card,input,FakeEvm} from "./fixtures";
import {digest,type ReviewDecision,type CanonicalRequest} from "../packages/shared";
import {CCTP_TESTNETS} from "../packages/shared/assets";
import {paymentRoute} from "../packages/shared/payment-profiles";
import type {Card,Payment} from "../apps/web/lib/models";
process.env.SESSION_SECRET="explorer-test-secret-at-least32-characters";
process.env.APP_URL="http://localhost:3000";
const request=(path:string)=>new Request("https://app.example/api/v1"+path);
async function setup(){
 const store=new MemoryStore();await store.create("cards",card);
 const rows:Payment[]=Array.from({length:7},(_,i)=>({_id:digest("explorer"+i),owner:card.owner,cardId:card._id,keyId:"PRIVATE_KEY_SENTINEL",input:{...input,justification:"PRIVATE_JUSTIFICATION_SENTINEL"},inputHash:digest(input),status:i%2?"PAID":"QUEUED",createdAt:1000,updatedAt:1001}));
 for(const row of rows)await store.create("requests",row);
 return {store,rows,explore:createExplorer(store,new FakeEvm())};
}
test("Vercel aliases accept their own browser Origin and reject cross-site or null origins",()=>{
 const alias=new Request("https://intentguard-ivory.vercel.app/api/v1/auth/challenge",{method:"POST",headers:{Origin:"https://intentguard-ivory.vercel.app","Sec-Fetch-Site":"same-origin"}});
 assert.doesNotThrow(()=>assertApplicationOrigin(alias,"https://intentguard-gen-daves-projects.vercel.app"));
 for(const origin of ["https://evil.example","null"]){assert.throws(()=>assertApplicationOrigin(new Request(alias.url,{method:"POST",headers:{Origin:origin}}),"https://intentguard-gen-daves-projects.vercel.app"))}
 assert.throws(()=>assertApplicationOrigin(new Request(alias.url,{method:"POST",headers:{Origin:"https://intentguard-ivory.vercel.app","Sec-Fetch-Site":"cross-site"}}),"https://intentguard-gen-daves-projects.vercel.app"));
});
test("wallet challenge uses the actual public alias domain",async()=>{
 const api=createApi(new MemoryStore(),new FakeEvm(),{requireConfigured:false}),url="https://intentguard-ivory.vercel.app/api/v1/auth/challenge";
 const response=await api(new Request(url,{method:"POST",headers:{Origin:new URL(url).origin,"Content-Type":"application/json"},body:JSON.stringify({address:card.owner})}),"/auth/challenge");
 assert.equal(response.status,200);assert.match((await response.json()).message,/intentguard-ivory\.vercel\.app/);
});
test("public activity is bounded, stable across equal timestamps and excludes private credentials and justifications",async()=>{
 const {explore}=await setup();let path="/explorer/transactions?limit=4",seen:string[]=[];
 for(let i=0;i<3;i++){const result=await explore(request(path),"/explorer/transactions") as {transactions:{id:string}[];nextCursor:string|null};assert.ok(result.transactions.length<=4);seen.push(...result.transactions.map(row=>row.id));const raw=JSON.stringify(result);assert.ok(!raw.includes("PRIVATE_KEY_SENTINEL"));assert.ok(!raw.includes("PRIVATE_JUSTIFICATION_SENTINEL"));if(!result.nextCursor)break;path="/explorer/transactions?limit=4&cursor="+encodeURIComponent(result.nextCursor)}
 assert.equal(seen.length,7);assert.equal(new Set(seen).size,7);
 const filtered=await explore(request("/explorer/transactions?status=PAID&agentId="+card._id),"/explorer/transactions") as {transactions:{status:string}[]};
 assert.equal(filtered.transactions.length,3);assert.ok(filtered.transactions.every(row=>row.status==="PAID"));
 await assert.rejects(()=>explore(request("/explorer/transactions?limit=500"),"/explorer/transactions"));
 await assert.rejects(()=>explore(request("/explorer/transactions?status=INVENTED"),"/explorer/transactions"));
});
test("public agent failures show unavailable balances rather than fabricated zeros",async()=>{
 const {store}=await setup(),evm=new FakeEvm();evm.view=async()=>{throw Error("RPC unavailable")};
 const result=await createExplorer(store,evm)(request("/explorer/agents"),"/explorer/agents") as {agents:{status:string;balances:unknown}[]};
 assert.equal(result.agents[0].status,"UNAVAILABLE");assert.equal(result.agents[0].balances,null);
});
async function destinationProjection(c:Card,p:Partial<Payment>){
 const store=new MemoryStore();await store.create("cards",c);
 const row:Payment={_id:digest("destination"),owner:c.owner,cardId:c._id,keyId:"private",input:{...input,destinationChainId:84532},inputHash:digest(input),status:"BLOCKED",createdAt:1,updatedAt:2,...p};
 await store.create("requests",row);const explore=createExplorer(store,new FakeEvm());
 const path="/explorer/transactions/"+row._id;
 const detail=await explore(request(path),path) as {transaction:{destinationChainId?:number;destinationToken?:string;chainId:number;token:string}};
 const list=await explore(request("/explorer/transactions"),"/explorer/transactions") as {transactions:typeof detail.transaction[]};
 assert.deepEqual(list.transactions[0].destinationChainId,detail.transaction.destinationChainId);
 assert.deepEqual(list.transactions[0].destinationToken,detail.transaction.destinationToken);
 assert.deepEqual(await store.get("requests",row._id),row,"Public reads must preserve request history");
 return detail.transaction;
}
const usdcCard:Card={...card,chainId:1952,token:CCTP_TESTNETS[1952].token,paymentEnvironment:"testnet",settlement:{asset:"USDC",destinationChainIds:[1952,84532,421614]}};
for(const status of ["BLOCKED","NEEDS_EVIDENCE"] as const)test("early "+status+" preserves the attempted Base Sepolia asset in public detail and activity",async()=>{
 const result=await destinationProjection(usdcCard,{status});
 assert.equal(result.destinationChainId,84532);assert.equal(result.destinationToken,CCTP_TESTNETS[84532].token.toLowerCase());
 assert.equal(result.chainId,1952);assert.equal(result.token,usdcCard.token);
});
test("canonical and bridge identities take precedence over stored input without mixing destination assets",async()=>{
 const bridge:NonNullable<Payment["bridge"]>={protocol:"CCTP_V2",phase:"BURNED",sourceChainId:1952,destinationChainId:421614,destinationDomain:3,sourceToken:usdcCard.token!,destinationToken:CCTP_TESTNETS[421614].token,amount:input.amount,sourceTxHash:digest("burn"),updatedAt:2};
 const fromBridge=await destinationProjection(usdcCard,{bridge});
 assert.equal(fromBridge.destinationChainId,421614);assert.equal(fromBridge.destinationToken,bridge.destinationToken);
 const canonical:CanonicalRequest={...input,destinationChainId:84532,destinationToken:CCTP_TESTNETS[84532].token,cardId:card._id,cardAddress:card.address,owner:card.owner,policyHash:card.policyHash,token:usdcCard.token!,chainId:1952,amountAtomic:"5000001",evidenceHash:digest("evidence"),expiresAt:123};
 const fromCanonical=await destinationProjection(usdcCard,{canonical,bridge});
 assert.equal(fromCanonical.destinationChainId,84532);assert.equal(fromCanonical.destinationToken,canonical.destinationToken);
 const missingCanonicalToken=await destinationProjection(usdcCard,{canonical:{...canonical,destinationToken:undefined},bridge});
 assert.equal(missingCanonicalToken.destinationToken,CCTP_TESTNETS[84532].token.toLowerCase());
});
test("early versioned mainnet attempts resolve their own environment while local payments retain the card token",async()=>{
 const c:Card={...card,token:paymentRoute("mainnet",196).token,paymentEnvironment:"mainnet",settlement:{version:2,paymentEnvironment:"mainnet",asset:"USDC",destinationChainIds:[196,8453]}};
 const result=await destinationProjection(c,{input:{...input,destinationChainId:8453}});
 assert.equal(result.destinationChainId,8453);assert.equal(result.destinationToken,paymentRoute("mainnet",8453).token);
 const local=await destinationProjection(card,{input});assert.equal(local.destinationChainId,196);assert.equal(local.destinationToken,card.token);
});
test("unsupported and wrong-asset attempts remain readable without a fabricated destination token",async()=>{
 for(const [c,destinationChainId] of [[usdcCard,999999],[usdcCard,8453],[card,84532]] as const){
  const result=await destinationProjection(c,{input:{...input,destinationChainId}});
  assert.equal(result.destinationChainId,destinationChainId);assert.equal(result.destinationToken,undefined);
 }
 const usdt0:Card={...card,paymentEnvironment:"mainnet",settlement:{version:2,paymentEnvironment:"mainnet",asset:"USDT0",destinationChainIds:[196]}};
 const result=await destinationProjection(usdt0,{input:{...input,destinationChainId:8453}});assert.equal(result.destinationToken,undefined);
});
test("transaction details display verified contract reasoning and hide unverified persisted reasons",async()=>{
 const {store,rows}=await setup(),p=rows[0];
 const review:ReviewDecision={decision:"APPROVE",requestHash:digest("request"),policyHash:card.policyHash,evidenceHash:digest("evidence"),criteria:[{id:"mission",status:"PASS",reason:"Verified research matches the immutable mission.",sources:[input.evidence[0].url]}],reason:"The finalized contract approved the matching research invoice."};
 await store.patch("requests",p._id,{review,genLayerTxHash:digest("gl")});
 const path="/explorer/transactions/"+p._id;
 const verified=await createExplorer(store,new FakeEvm(),async()=>review)(request(path),path) as {reasoningSource:string;transaction:{review?:ReviewDecision}};
 assert.equal(verified.reasoningSource,"genlayer-finalized-contract");assert.deepEqual(verified.transaction.review,review);
 const failed=await createExplorer(store,new FakeEvm(),async()=>{throw Error("Consensus changed")})(request(path),path) as typeof verified;
 assert.equal(failed.reasoningSource,"unavailable");assert.equal(failed.transaction.review,undefined);
 const pendingPath="/explorer/transactions/"+rows[1]._id,pending=await createExplorer(store,new FakeEvm())(request(pendingPath),pendingPath) as typeof verified;
 assert.equal(pending.reasoningSource,"failed");assert.equal(pending.transaction.review,undefined);
});
