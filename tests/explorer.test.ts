import {test} from "node:test";
import assert from "node:assert/strict";
import {createExplorer} from "../apps/web/lib/explorer";
import {createApi} from "../apps/web/lib/api";
import {assertApplicationOrigin} from "../apps/web/lib/origins";
import {MemoryStore} from "../apps/web/lib/store";
import {card,input,FakeEvm} from "./fixtures";
import {digest,type ReviewDecision} from "../packages/shared";
import type {Payment} from "../apps/web/lib/models";
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
