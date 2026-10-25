import {test} from "node:test";
import assert from "node:assert/strict";
import {createApi} from "../apps/web/lib/api";
import {createExplorer} from "../apps/web/lib/explorer";
import {MemoryStore} from "../apps/web/lib/store";
import {reviewStage} from "../apps/web/lib/review-stage";
import {card,FakeEvm,input,invoice,owner,FakeGenLayer} from "./fixtures";
import {digest} from "../packages/shared";
import {issueKey} from "../apps/web/lib/auth";
import {Worker} from "../apps/web/lib/worker";
import type {Payment} from "../apps/web/lib/models";
process.env.SESSION_SECRET="identity-test-secret-with-more-than-32-characters";
const request=(path:string,method="GET",headers:HeadersInit={},body?:string)=>new Request("https://app.example/api/v1"+path,{method,headers,body});
async function setup(){const store=new MemoryStore();await store.create("cards",card);const key=await issueKey(store,card._id,owner);return {store,key,api:createApi(store,new FakeEvm(),{requireConfigured:false,wake:()=>{}})}}
test("card snapshot includes all usage beyond default query limit and only PAID funds with exact decimals",async()=>{
 const {store,api}=await setup();for(let i=0;i<245;i++)await store.create("requests",{_id:digest("usage"+i),owner,cardId:card._id,keyId:"PRIVATE_KEY",input:{...input,amount:"0.000001",justification:"PRIVATE_JUSTIFICATION"},inputHash:digest(input),status:i%2===0?"PAID":"BLOCKED",createdAt:i,updatedAt:i});
 const path="/explorer/agents/"+card._id+"/card",response=await api(request(path),path),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.usage.requestCount,245);assert.equal(body.usage.paidCount,123);assert.equal(body.usage.fundsMoved,"0.000123");assert.equal(body.usage.blockedCount,122);assert.ok(!JSON.stringify(body).includes("PRIVATE_KEY"));assert.ok(!JSON.stringify(body).includes("PRIVATE_JUSTIFICATION"));
 const svg=await api(request(path+".svg"),path+".svg");assert.equal(svg.status,200);assert.match(svg.headers.get("Content-Type")! ,/image\/svg\+xml/);assert.match(svg.headers.get("Content-Disposition")!,/attachment/);assert.match(await svg.text(),/0\.000123/);assert.ok(svg.headers.get("X-Request-Id"));
});
test("standalone card escapes untrusted agent names and exposes no evidence/credential data",async()=>{
 const {store,api}=await setup();await store.patch("cards",card._id,{policy:{...card.policy,name:'<script>alert("name")</script>',mission:"Read & verify"}});
 const path="/explorer/agents/"+card._id+"/card.svg",svg=await (await api(request(path),path)).text();
 assert.ok(!svg.includes("<script>"));assert.match(svg,/&lt;script&gt;/);assert.match(svg,/Read &amp; verify/);assert.ok(!svg.includes("<image"));assert.ok(!svg.includes("ig_"));
});
test("financially blocked and terminal unreviewed requests are never pending",()=>{
 const base={status:"BLOCKED" as const,guard:{allow:false,failures:["Payment limit"]}};
 assert.equal(reviewStage(base).status,"SKIPPED");assert.equal(reviewStage({...base,status:"NEEDS_EVIDENCE",guard:{allow:true,failures:[]}}).status,"SKIPPED");assert.equal(reviewStage({...base,status:"CANCELLED",guard:undefined,genLayerTxHash:digest("failed")}).status,"FAILED");assert.equal(reviewStage({...base,status:"QUEUED",guard:undefined}).status,"PENDING");
});
test("public blocked detail verifies no contract and reports skipped with no review",async()=>{
 const {store}=await setup();const p:Payment={_id:digest("blocked"),owner,cardId:card._id,keyId:"private",input,inputHash:digest(input),status:"BLOCKED",guard:{allow:false,failures:["Payment limit"]},createdAt:1,updatedAt:2};await store.create("requests",p);
 let calls=0;const path="/explorer/transactions/"+p._id;const result=await createExplorer(store,new FakeEvm(),async()=>{calls++;throw Error()})(request(path),path) as any;
 assert.equal(result.reasoningSource,"skipped");assert.equal(result.transaction.reviewStage.status,"SKIPPED");assert.equal(calls,0);
});
test("API returns actionable HTTP statuses, method Allow and correlation without leaking secrets",async()=>{
 const {api,key}=await setup();const auth={Authorization:"Bearer "+key,"Idempotency-Key":"identity-errors"};
 for(const [body,type,status,code]of [["{","application/json",400,"INVALID_JSON"],["{}","text/plain",415,"UNSUPPORTED_MEDIA_TYPE"],[JSON.stringify({...input,amount:"1.0000001"}),"application/json",422,"INVALID_INPUT"]] as const){
 const r=await api(request("/requests","POST",{...auth,"Content-Type":type},body),"/requests"),data=await r.json();assert.equal(r.status,status);assert.equal(data.error.code,code);assert.equal(data.error.requestId,r.headers.get("X-Request-Id"));assert.equal(data.error.retryable,false);assert.ok(!JSON.stringify(data).includes(key));if(status===422){assert.equal(data.error.details[0].field,"amount");assert.match(data.error.message,/6 decimal/)}
 }
 const wrong=await api(request("/config","POST"),"/config");assert.equal(wrong.status,405);assert.equal(wrong.headers.get("Allow"),"GET");assert.equal((await api(request("/does-not-exist"),"/does-not-exist")).status,404);
});
test("agent quota reports actual remaining slots and rate-limit retry timing",async()=>{
 const {api,key}=await setup();for(let i=0;i<60;i++){const r=await api(request("/me","GET",{Authorization:"Bearer "+key}),"/me");assert.equal(r.status,200);assert.equal(r.headers.get("RateLimit-Remaining"),String(59-i))}
 const limited=await api(request("/me","GET",{Authorization:"Bearer "+key}),"/me");assert.equal(limited.status,429);assert.ok(Number(limited.headers.get("Retry-After"))>=0);assert.equal((await limited.json()).error.retryable,true);
});
test("invoice buyer and SHA256 errors are specific and never reserve or submit review",async()=>{
 const {store}=await setup();const p:Payment={_id:digest("invoice-errors"),owner,cardId:card._id,keyId:"key",input,inputHash:digest(input),status:"QUEUED",createdAt:1,updatedAt:1};await store.create("keys",{_id:"key",cardId:card._id,owner,revoked:false});await store.patch("cards",card._id,{activeKeyId:"key"});
 const cases=[{input,fetcher:async()=>JSON.stringify({...JSON.parse(invoice()),buyer:owner}),code:"INVOICE_BUYER_MISMATCH"},{input:{...input,evidence:input.evidence.map(e=>({...e,sha256:"0".repeat(64)}))},fetcher:async()=>invoice(),code:"EVIDENCE_HASH_MISMATCH"}];
 for(const c of cases){const evm=new FakeEvm(),gl=new FakeGenLayer(),result=await new Worker(store,evm,gl,c.fetcher).payment({...p,input:c.input});assert.equal(result.status,"NEEDS_EVIDENCE");assert.equal(result.errorCode,c.code);assert.equal(evm.reserves,0);assert.equal(gl.submissions,0)}
});
