import {test} from "node:test";
import assert from "node:assert/strict";
import {privateKeyToAccount} from "viem/accounts";
import {MemoryStore} from "../apps/web/lib/store";
import {createApi} from "../apps/web/lib/api";
import {challenge,login,session,issueKey,ownerSession,revokeKeys} from "../apps/web/lib/auth";
import {card,owner,input,FakeEvm} from "./fixtures";
process.env.SESSION_SECRET="test-session-secret-with-more-than-32-characters";
process.env.APP_URL="http://localhost:3000";
async function setup(){const s=new MemoryStore();await s.create("cards",card);const key=await issueKey(s,card._id,owner);return {s,key,api:createApi(s,new FakeEvm(),{requireConfigured:false})}}
function req(path:string,key:string,body?:unknown,id="idem-1"){return new Request("http://localhost:3000/api/v1"+path,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json","Idempotency-Key":id},...(body?{body:JSON.stringify(body)}:{})})}
test("valid wallet signature is consumed once and rejects wrong signer",async()=>{const s=new MemoryStore(),a=privateKeyToAccount("0x"+"12".repeat(32) as `0x${string}`),b=privateKeyToAccount("0x"+"13".repeat(32) as `0x${string}`);const {message}=await challenge(s,a.address,"https://intentguard.example");await assert.rejects(login(s,a.address,await b.signMessage({message})));const token=await login(s,a.address,await a.signMessage({message}));assert.equal(ownerSession("ig_session="+token),a.address.toLowerCase());await assert.rejects(login(s,a.address,await a.signMessage({message})));assert.equal(ownerSession("ig_session="+token+"corrupt"),null)});
test("concurrent admission creates one request and conflicts on changed payment",async()=>{const {s,key,api}=await setup();const responses=await Promise.all(Array.from({length:12},()=>api(req("/requests",key,input),"/requests")));for(const r of responses)assert.equal(r.status,202);const bodies=await Promise.all(responses.map(r=>r.json()));assert.equal(new Set(bodies.map(b=>b.id)).size,1);assert.equal((await s.find("requests",{})).length,1);const conflict=await api(req("/requests",key,{...input,amount:"6"}),"/requests");assert.equal(conflict.status,409)});
test("agent keys isolate cards and cannot select another owner/card",async()=>{const {s,key,api}=await setup();const created=await (await api(req("/requests",key,input),"/requests")).json();const other={...card,_id:"other",owner:"0x"+"44".repeat(20),address:"0x"+"55".repeat(20)};await s.create("cards",other);const otherKey=await issueKey(s,other._id,other.owner);assert.equal((await api(req("/requests/"+created.id,otherKey),"/requests/"+created.id)).status,404);assert.equal((await api(req("/requests",key,{...input,cardId:"other"}),"/requests")).status,422);await revokeKeys(s,card._id);assert.equal((await api(req("/me",key),"/me")).status,401)});
test("owner endpoints enforce origin and cross-owner isolation",async()=>{const {api}=await setup();const cookie="ig_session="+session("0x"+"66".repeat(20));const request=new Request("http://localhost:3000/api/v1/owner/cards/"+card._id+"/keys",{method:"POST",headers:{cookie,origin:"http://localhost:3000"}});assert.equal((await api(request,"/owner/cards/"+card._id+"/keys")).status,404);const bad=new Request("http://localhost:3000/api/v1/owner/drafts",{method:"POST",headers:{cookie,origin:"https://evil.example"},body:JSON.stringify({description:"Buy research APIs"})});assert.equal((await api(bad,"/owner/drafts")).status,403)});
test("admission rejects missing idempotency, unapproved origins and oversized input",async()=>{const {key,api}=await setup();const missing=req("/requests",key,input);missing.headers.delete("idempotency-key");assert.equal((await api(missing,"/requests")).status,422);assert.equal((await api(req("/requests",key,{...input,evidence:[{url:"https://unapproved.example/invoice"}]}),"/requests")).status,422);assert.equal((await api(req("/requests",key,{...input,justification:"x".repeat(40000)}),"/requests")).status,413)});
test("revocation marks every pending authorized request for cancellation",async()=>{const {s,key,api}=await setup();const result=await (await api(req("/requests",key,input),"/requests")).json();const r=new Request("http://localhost:3000/api/v1/owner/cards/"+card._id+"/keys",{method:"DELETE",headers:{cookie:"ig_session="+session(owner),origin:"http://localhost:3000"}});assert.equal((await api(r,"/owner/cards/"+card._id+"/keys")).status,204);assert.equal((await s.get("requests",result.id))?.cancelRequested,true)});
test("unconfigured public config is truthful and money APIs fail closed",async()=>{const s=new MemoryStore(),api=createApi(s,new FakeEvm());assert.equal((await api(req("/config","none"),"/config")).status,200);assert.equal((await api(req("/requests","none",input),"/requests")).status,503)});

test("concurrent rotations leave exactly one usable credential",async()=>{const {s,api}=await setup();const keys=await Promise.all([issueKey(s,card._id,owner),issueKey(s,card._id,owner)]);const statuses=await Promise.all(keys.map(key=>api(req("/me",key),"/me").then(r=>r.status)));assert.deepEqual(statuses.sort(),[200,401])});

test("testnet merchant invoices require admin authorization and serve immutable exact bytes",async()=>{
 const previous=Object.fromEntries(["INTENTGUARD_MODE","XLAYER_CHAIN_ID","PAYMENT_TOKEN","DEMO_MERCHANT_ADMIN_KEY","DEMO_MERCHANT_RECIPIENT"].map(k=>[k,process.env[k]]));
 try{
 Object.assign(process.env,{INTENTGUARD_MODE:"testnet",XLAYER_CHAIN_ID:"1952",PAYMENT_TOKEN:card.token,DEMO_MERCHANT_ADMIN_KEY:"merchant-test-only-secret-with-32-characters",DEMO_MERCHANT_RECIPIENT:input.recipient});
 const s=new MemoryStore(),api=createApi(s,new FakeEvm(),{requireConfigured:false});
 const post=(key:string,value:unknown)=>new Request("http://localhost:3000/api/v1/demo/invoices",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(value)});
 const value={buyer:card.address,amount:"1",description:"Approved research dataset"};
 assert.equal((await api(post("wrong",value),"/demo/invoices")).status,401);
 assert.equal((await api(post(process.env.DEMO_MERCHANT_ADMIN_KEY!,{...value,recipient:owner}),"/demo/invoices")).status,422);
 const created=await api(post(process.env.DEMO_MERCHANT_ADMIN_KEY!,value),"/demo/invoices");assert.equal(created.status,201);
 const {invoice,url}=await created.json();assert.equal(invoice.chainId,1952);assert.equal(invoice.token,String(card.token).toLowerCase());assert.equal(invoice.buyer,card.address.toLowerCase());
 const path="/demo/invoices/"+invoice.invoiceId;
 const first=await api(new Request(url),path),bytes=await first.text();assert.deepEqual(JSON.parse(bytes),invoice);
 await s.patch("demoInvoices",invoice.invoiceId,{updatedAt:Date.now()+1000});
 assert.equal(await (await api(new Request(url),path)).text(),bytes);
 assert.match(first.headers.get("cache-control")!,/immutable/);
 assert.equal((await api(new Request(url),"/demo/invoices/"+"00".repeat(16))).status,404);
 }finally{for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v}}
});

test("draft persists before wake and a failed trigger does not lose it",async()=>{
 const store=new MemoryStore();let wakes=0;
 const api=createApi(store,new FakeEvm(),{requireConfigured:false,wake:async()=>{wakes++;assert.equal((await store.find("drafts",{})).length,1);throw Error("Upstream unavailable")}});
 const r=new Request("http://localhost:3000/api/v1/owner/drafts",{method:"POST",headers:{cookie:"ig_session="+session(owner),origin:"http://localhost:3000","Content-Type":"application/json"},body:JSON.stringify({description:"Purchase research datasets within owner limits"})});
 const result=await api(r,"/owner/drafts");assert.equal(result.status,202);assert.equal(wakes,1);assert.equal((await store.get("drafts",(await result.json()).id))?.state,"QUEUED");
});
test("only authenticated pending draft reads recover a worker",async()=>{
 const store=new MemoryStore(),id="0x"+"99".repeat(32);await store.create("drafts",{_id:id,owner,state:"QUEUED"});let wakes=0;
 const api=createApi(store,new FakeEvm(),{requireConfigured:false,wake:()=>{wakes++}});
 const read=(account:string)=>api(new Request("http://localhost:3000/api/v1/owner/drafts/"+id,{headers:{cookie:"ig_session="+session(account)}}),"/owner/drafts/"+id);
 assert.equal((await read("0x"+"77".repeat(20))).status,404);assert.equal(wakes,0);
 assert.equal((await read(owner)).status,200);assert.equal(wakes,1);
 await store.patch("drafts",id,{state:"FINALIZED"});assert.equal((await read(owner)).status,200);assert.equal(wakes,1);
});
test("requests and active idempotent retries wake after persistence",async()=>{
 const store=new MemoryStore();await store.create("cards",card);const key=await issueKey(store,card._id,owner);let wakes=0;
 const api=createApi(store,new FakeEvm(),{requireConfigured:false,wake:async()=>{assert.equal((await store.find("requests",{})).length,1);wakes++}});
 const first=await api(req("/requests",key,input),"/requests");assert.equal(first.status,202);const id=(await first.json()).id;assert.equal(wakes,1);
 assert.equal((await api(req("/requests",key,input),"/requests")).status,202);assert.equal(wakes,2);
 assert.equal((await api(req("/requests",key,{...input,amount:"6"}),"/requests")).status,409);assert.equal(wakes,2);
 await store.patch("requests",id,{status:"PAID"});assert.equal((await api(req("/requests",key,input),"/requests")).status,202);assert.equal(wakes,2);
});
test("authenticated request polling recovers a worker and preserves isolation",async()=>{
 const store=new MemoryStore();await store.create("cards",card);const key=await issueKey(store,card._id,owner);let wakes=0;
 const api=createApi(store,new FakeEvm(),{requireConfigured:false,wake:()=>{wakes++}});
 const id=(await (await api(req("/requests",key,input),"/requests")).json()).id;
 assert.equal((await api(req("/requests/"+id,"invalid"),"/requests/"+id)).status,401);assert.equal(wakes,1);
 assert.equal((await api(req("/requests/"+id,key),"/requests/"+id)).status,200);assert.equal(wakes,2);
 await store.patch("requests",id,{status:"PAID"});assert.equal((await api(req("/requests/"+id,key),"/requests/"+id)).status,200);assert.equal(wakes,2);
});
test("reviewer setup and revocation schedule recovery",async()=>{
 const store=new MemoryStore();await store.create("cards",card);const key=await issueKey(store,card._id,owner);let wakes=0;
 const api=createApi(store,new FakeEvm(),{requireConfigured:false,wake:()=>{wakes++}});
 await api(req("/requests",key,input),"/requests");assert.equal(wakes,1);
 const del=new Request("http://localhost:3000/api/v1/owner/cards/"+card._id+"/keys",{method:"DELETE",headers:{cookie:"ig_session="+session(owner),origin:"http://localhost:3000"}});
 assert.equal((await api(del,"/owner/cards/"+card._id+"/keys")).status,204);assert.equal(wakes,2);
 await store.patch("cards",card._id,{state:"SETTING_UP"});
 const read=new Request("http://localhost:3000/api/v1/owner/cards",{headers:{cookie:"ig_session="+session(owner)}});
 assert.equal((await api(read,"/owner/cards")).status,200);assert.equal(wakes,3);
});

test("owner payment reads recover pending work without waking for terminal records",async()=>{
 const store=new MemoryStore();await store.create("cards",card);const key=await issueKey(store,card._id,owner);let wakes=0;
 const api=createApi(store,new FakeEvm(),{requireConfigured:false,wake:()=>{wakes++}});
 const id=(await (await api(req("/requests",key,input),"/requests")).json()).id;
 const read=(path:string)=>api(new Request("http://localhost:3000/api/v1"+path,{headers:{cookie:"ig_session="+session(owner)}}),path);
 assert.equal((await read("/owner/requests")).status,200);assert.equal(wakes,2);
 assert.equal((await read("/owner/requests/"+id)).status,200);assert.equal(wakes,3);
 await store.patch("requests",id,{status:"PAID"});await read("/owner/requests");await read("/owner/requests/"+id);assert.equal(wakes,3);
});

test("only the owning authenticated wallet can retry a failed reviewer",async()=>{
 const s=new MemoryStore();await s.create("cards",{...card,state:"FAILED",reviewerTx:"0x"+"ab".repeat(32),reviewerAddress:undefined});let wakes=0;
 const api=createApi(s,new FakeEvm(),{requireConfigured:false,wake:()=>{wakes++}});
 const path="/owner/cards/"+card._id+"/reviewer";
 const post=(account=owner,origin="http://localhost:3000")=>api(new Request("http://localhost:3000/api/v1"+path,{method:"POST",headers:{cookie:"ig_session="+session(account),origin}}),path);
 assert.equal((await post("0x"+"77".repeat(20))).status,404);assert.equal((await post(owner,"https://evil.example")).status,403);assert.equal(wakes,0);
 const results=await Promise.all([post(),post()]);assert.deepEqual(results.map(r=>r.status).sort(),[202,409]);assert.equal(wakes,1);
 const updated=await s.get("cards",card._id);assert.equal(updated?.state,"SETTING_UP");assert.equal(updated?.address,card.address);assert.equal(updated?.policyHash,card.policyHash);
 assert.equal(updated?.reviewerAttempt,1);assert.equal(updated?.reviewerTx,null);assert.equal(updated?.reviewerAddress,null);
 assert.equal((await post()).status,409);
});
test("failed reviewer blocks credentials with a truthful error and healthy reviewers cannot be retried",async()=>{
 const s=new MemoryStore();await s.create("cards",{...card,state:"FAILED"});const api=createApi(s,new FakeEvm(),{requireConfigured:false});
 const path="/owner/cards/"+card._id+"/keys";
 const response=await api(new Request("http://localhost:3000/api/v1"+path,{method:"POST",headers:{cookie:"ig_session="+session(owner),origin:"http://localhost:3000"}}),path);
 assert.equal(response.status,409);assert.equal((await response.json()).error.code,"REVIEWER_FAILED");assert.equal((await s.find("keys",{})).length,0);
 await s.patch("cards",card._id,{state:"READY"});const retry="/owner/cards/"+card._id+"/reviewer";
 assert.equal((await api(new Request("http://localhost:3000/api/v1"+retry,{method:"POST",headers:{cookie:"ig_session="+session(owner),origin:"http://localhost:3000"}}),retry)).status,409);
});
