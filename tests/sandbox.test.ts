import {test} from "node:test";
import assert from "node:assert/strict";
import {createApi} from "../apps/web/lib/api";
import {MemoryStore} from "../apps/web/lib/store";
import {issueKey,session} from "../apps/web/lib/auth";
import {sandboxPolicy} from "../apps/web/lib/sandbox";
import {Worker} from "../apps/web/lib/worker";
import {CCTP_TESTNETS} from "../packages/shared/assets";
import {digest,parseAmount,type CardView,type ReviewDecision} from "../packages/shared";
import type {Card,Payment} from "../apps/web/lib/models";
import {card as fixtureCard,merchant,owner,FakeEvm,FakeGenLayer} from "./fixtures";

const origin="https://sandbox.example",envNames=["INTENTGUARD_MODE","INTENTGUARD_PAYMENT_ENV","XLAYER_CHAIN_ID","MONGODB_DB","APP_URL","FRONTEND_URL","SESSION_SECRET","DEMO_MERCHANT_RECIPIENT","INTENTGUARD_SANDBOX_CARD_ID","INTENTGUARD_SANDBOX_OWNER","INTENTGUARD_SANDBOX_API_KEY","INTENTGUARD_SANDBOX_MAX_REQUESTS","VERCEL"];
class SandboxEvm extends FakeEvm{
 enabled=true;
 async preview(c?:Card,input?:Payment["input"]){if(!c||!input)return super.preview();const allow=parseAmount(input.amount)<=parseAmount(c.policy.financial.perPaymentLimit);return {allow,failures:allow?[]:["Payment limit"]};}
 async view(c:Card):Promise<CardView>{return {...await super.view(c),chainId:1952,status:this.enabled?"ACTIVE":"PAUSED",balances:{funded:"0.001",spent:"0",reserved:"0",available:"0.001",periodSpent:"0",periodReserved:"0"}};}
}
async function setup(run:(f:Awaited<ReturnType<typeof fixture>>)=>Promise<void>){
 const saved=Object.fromEntries(envNames.map(n=>[n,process.env[n]]));
 try{Object.assign(process.env,{INTENTGUARD_MODE:"testnet",INTENTGUARD_PAYMENT_ENV:"testnet",XLAYER_CHAIN_ID:"1952",MONGODB_DB:"intentguard",APP_URL:origin,FRONTEND_URL:origin,SESSION_SECRET:"sandbox-test-secret-that-is-longer-than-32-characters",DEMO_MERCHANT_RECIPIENT:merchant,INTENTGUARD_SANDBOX_OWNER:owner,INTENTGUARD_SANDBOX_MAX_REQUESTS:"30"});delete process.env.VERCEL;await run(await fixture());}finally{for(const name of envNames){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}}
}
async function fixture(){
 const store=new MemoryStore(),evm=new SandboxEvm(),policy=sandboxPolicy(merchant,origin),card:Card={...fixtureCard,_id:digest("dedicated-sandbox"),draftId:digest("dedicated-sandbox"),chainId:1952,token:CCTP_TESTNETS[1952].token,paymentEnvironment:"testnet",policy,policyHash:digest(policy),settlement:{asset:"USDC",destinationChainIds:[1952]},sandbox:true};
 await store.create("cards",card);const key=await issueKey(store,card._id,owner);process.env.INTENTGUARD_SANDBOX_CARD_ID=card._id;process.env.INTENTGUARD_SANDBOX_API_KEY=key;
 let wakes=0;const api=createApi(store,evm,{requireConfigured:false,wake:()=>{wakes++;}});
 const call=async(path:string,method="GET",data?:unknown,token?:string,idem?:string,extra:Record<string,string>={})=>api(new Request(origin+"/api/v1"+path,{method,headers:{Origin:origin,"X-IntentGuard-Environment":"testnet",...(data===undefined?{}:{"Content-Type":"application/json"}),...(token?{Authorization:"Sandbox "+token}:{}),...(idem?{"Idempotency-Key":idem}:{}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})}),path);
 const visitor=async()=>{const res=await call("/sandbox/session","POST",{});assert.equal(res.status,201,await res.clone().text());return (await res.json()).visitorToken as string;};
 return {store,evm,card,key,api,call,visitor,wakes:()=>wakes};
}
async function expectError(response:Response,status:number,code:string){const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));assert.equal(data.error.code,code);assert.equal(data.error.requestId,response.headers.get("X-Request-Id"));return data;}
test("sandbox readiness returns the actual dedicated policy and no agent credential",async()=>setup(async f=>{
 const res=await f.call("/sandbox"),j=await res.json();assert.equal(res.status,200);assert.equal(j.enabled,true);assert.equal(j.card.id,f.card._id);assert.deepEqual(j.card.policy,f.card.policy);assert.equal(j.limits.normalAmount,"0.000001");assert.equal(j.limits.requestsPerVisitor,5);assert.equal(j.limits.maxAdmissions,30);assert.equal(j.scenarios.length,4);assert.ok(!JSON.stringify(j).includes(f.key));assert.ok(!JSON.stringify(j).includes("activeKeyId"));assert.equal(j.paymentChainId,1952);
}));
test("sandbox readiness rejects an unrelated card, broadened permission and different asset or route",async()=>setup(async f=>{
 for(const patch of [{sandbox:false},{owner:merchant},{token:fixtureCard.token},{settlement:{asset:"USDC",destinationChainIds:[1952,84532]}},{policy:{...f.card.policy,exceptions:["Any purchase is allowed"]}},{policy:{...f.card.policy,financial:{...f.card.policy.financial,perPaymentLimit:"1"}}}]){await f.store.patch("cards",f.card._id,patch);const j=await (await f.call("/sandbox")).json();assert.equal(j.enabled,false);await f.store.put("cards",{...f.card,activeKeyId:digest(f.key)});}
}));
test("only a live card-scoped unrevoked key enables sandbox submissions",async()=>setup(async f=>{
 const token=await f.visitor();await f.store.patch("keys",digest(f.key),{revoked:true});await expectError(await f.call("/sandbox/requests","POST",{scenario:"permitted"},token,"no-revoked"),503,"SANDBOX_KEY_UNAVAILABLE");assert.equal((await f.store.find("requests",{})).length,0);
 await f.store.patch("keys",digest(f.key),{revoked:false,cardId:fixtureCard._id});await expectError(await f.call("/sandbox/requests","POST",{scenario:"permitted"},token,"wrong-card"),503,"SANDBOX_KEY_UNAVAILABLE");
}));
test("sandbox credentials and environment are never accepted as owner or agent authority",async()=>setup(async f=>{
 const token=await f.visitor();await expectError(await f.call("/me","GET",undefined,token),401,"KEY_REQUIRED");await expectError(await f.call("/owner/cards","GET",undefined,token),401,"LOGIN_REQUIRED");
 await expectError(await f.call("/sandbox/requests","POST",{scenario:"permitted"},token,"mainnet",{"X-IntentGuard-Environment":"mainnet"}),409,"PAYMENT_ENVIRONMENT_MISMATCH");assert.equal((await f.store.find("requests",{})).length,0);
 process.env.INTENTGUARD_SANDBOX_API_KEY="ig_mainnet_"+"a".repeat(43);const j=await (await f.call("/sandbox")).json();assert.equal(j.enabled,false);assert.equal(j.reasonCode,"SANDBOX_NOT_CONFIGURED");
}));
test("sandbox origin and preflight enforce application authority",async()=>setup(async f=>{
 await expectError(await f.call("/sandbox/session","POST",{},undefined,undefined,{Origin:"https://evil.example"}),403,"ORIGIN_DENIED");
 const missing=new Request(origin+"/api/v1/sandbox/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});await expectError(await f.api(missing,"/sandbox/session"),403,"ORIGIN_DENIED");
 await expectError(await f.call("/sandbox/requests","OPTIONS",undefined,undefined,undefined,{"Access-Control-Request-Method":"POST","Access-Control-Request-Headers":"x-sandbox-api-key"}),403,"PREFLIGHT_DENIED");
 const permitted=await f.call("/sandbox/requests","OPTIONS",undefined,undefined,undefined,{"Access-Control-Request-Method":"POST","Access-Control-Request-Headers":"authorization,content-type,idempotency-key,x-intentguard-environment"});assert.equal(permitted.status,204);assert.equal(permitted.headers.get("Access-Control-Allow-Origin"),origin);
}));
test("invalid scenario, custom recipient, amount, destination and evidence never enter admission",async()=>setup(async f=>{
 const token=await f.visitor();for(const data of [{scenario:"unknown"},{scenario:"permitted",amount:"100"},{scenario:"permitted",recipient:owner},{scenario:"permitted",destinationChainId:196},{scenario:"permitted",evidence:[{url:"http://127.0.0.1"}]},{scenario:"permitted",apiKey:f.key},null,[]])await expectError(await f.call("/sandbox/requests","POST",data,token,"invalid"),422,"SANDBOX_SCENARIO_INVALID");
 assert.equal((await f.store.find("requests",{})).length,0);assert.equal((await f.store.find("demoInvoices",{})).length,0);
}));
test("visitor tokens reject tampering, missing capability, expiry and another origin",async()=>setup(async f=>{
 const token=await f.visitor();await expectError(await f.call("/sandbox/requests","POST",{scenario:"permitted"},undefined,"missing"),401,"SANDBOX_SESSION_REQUIRED");
 const [payload]=token.split(".");await expectError(await f.call("/sandbox/requests","POST",{scenario:"permitted"},payload+"."+"a".repeat(43),"tamper"),401,"SANDBOX_SESSION_INVALID");
 const actualNow=Date.now;try{Date.now=()=>actualNow()+3600001;await expectError(await f.call("/sandbox/requests","POST",{scenario:"permitted"},token,"expired"),401,"SANDBOX_SESSION_EXPIRED");}finally{Date.now=actualNow;}
 const alias="https://alias.example",req=new Request(alias+"/api/v1/sandbox/requests",{method:"POST",headers:{Origin:alias,Authorization:"Sandbox "+token,"Content-Type":"application/json","Idempotency-Key":"origin-replay"},body:JSON.stringify({scenario:"permitted"})});await expectError(await f.api(req,"/sandbox/requests"),401,"SANDBOX_SESSION_EXPIRED");assert.equal((await f.store.find("requests",{})).length,0);
}));
test("sandbox admission uses the real API record and immutable generated invoice",async()=>setup(async f=>{
 const token=await f.visitor(),response=await f.call("/sandbox/requests","POST",{scenario:"permitted"},token,"one"),j=await response.json();assert.equal(response.status,202);assert.equal(j.status,"QUEUED");
 const p=(await f.store.get<Payment>("requests",j.id))!;assert.ok(p);assert.equal(p.status,"QUEUED");assert.equal(p.cardId,f.card._id);assert.equal(p.keyId,digest(f.key));assert.equal(p.input.amount,"0.000001");assert.equal(p.input.recipient,merchant);assert.equal(p.input.destinationChainId,1952);assert.equal(p.sandbox,true);assert.ok(f.wakes()>0);
 const invoice=await f.store.get<{_id:string;content:string}>("demoInvoices",p.input.invoiceId),body=JSON.parse(invoice!.content);assert.equal(body.buyer,f.card.address);assert.equal(body.token,CCTP_TESTNETS[1952].token.toLowerCase());assert.equal(body.amount,p.input.amount);
 const publicInvoice=await f.call("/demo/invoices/"+p.input.invoiceId);assert.equal(publicInvoice.status,200);assert.equal(await publicInvoice.text(),invoice!.content);assert.ok(!JSON.stringify(j).includes(f.key));
 const status=await f.call("/sandbox/requests/"+j.id,"GET",undefined,token),view=await status.json();assert.equal(view.status,"QUEUED");assert.deepEqual(view.request,p.input);assert.equal(view.paymentEnvironment,"testnet");assert.ok(!JSON.stringify(view).includes(f.key));assert.ok(!JSON.stringify(view).includes("keyId"));
}));
test("retries bind an unchanged scenario and create only one request and allowance slot",async()=>setup(async f=>{
 const token=await f.visitor(),first=await (await f.call("/sandbox/requests","POST",{scenario:"permitted"},token,"stable")).json(),invoice=(await f.store.find<{_id:string;content:string}>("demoInvoices",{}))[0];
 const retry=await (await f.call("/sandbox/requests","POST",{scenario:"permitted"},token,"stable")).json();assert.equal(retry.id,first.id);assert.equal((await f.store.find("requests",{})).length,1);assert.equal((await f.store.find("rate",{bindingId:(await f.store.find("rate",{requestId:first.id}))[0]._id})).length,2);assert.equal((await f.store.find<{_id:string;content:string}>("demoInvoices",{}))[0].content,invoice.content);
 await expectError(await f.call("/sandbox/requests","POST",{scenario:"blocked"},token,"stable"),409,"IDEMPOTENCY_CONFLICT");
}));
test("a live numerical denial finalizes the bounded over-budget request without signing or model work",async()=>setup(async f=>{
 const token=await f.visitor(),response=await f.call("/sandbox/requests","POST",{scenario:"blocked"},token,"fast-block"),admission=await response.json();assert.equal(response.status,202);assert.equal(admission.status,"BLOCKED");
 const view=await (await f.call("/sandbox/requests/"+admission.id,"GET",undefined,token)).json();assert.equal(view.reviewStage.status,"SKIPPED");assert.deepEqual(view.guard,{allow:false,failures:["Payment limit"]});assert.equal(f.evm.reserves,0);assert.equal(f.evm.settlements,0);assert.equal((await f.store.find("transactions",{})).length,0);
 const retry=await (await f.call("/sandbox/requests","POST",{scenario:"blocked"},token,"fast-block")).json();assert.equal(retry.id,admission.id);assert.equal(retry.status,"BLOCKED");assert.equal((await f.store.find("requests",{})).length,1);
}));
test("fast denial never invents a block when the live guard permits or is unavailable",async()=>setup(async f=>{
 const token=await f.visitor();f.evm.preview=async()=>({allow:true,failures:[]});const first=await (await f.call("/sandbox/requests","POST",{scenario:"blocked"},token,"positive-guard")).json();assert.equal(first.status,"QUEUED");
 f.evm.preview=async()=>{throw Error("RPC unavailable")};await expectError(await f.call("/sandbox/requests","POST",{scenario:"blocked"},token,"rpc-block"),503,"UNAVAILABLE");const records=await f.store.find<Payment>("requests",{});assert.ok(records.every(p=>p.status==="QUEUED"));assert.ok(records.every(p=>!p.guard));assert.equal(f.evm.reserves,0);
}));
test("identical concurrent requests retain one card-scoped operation and one invoice",async()=>setup(async f=>{
 const token=await f.visitor(),responses=await Promise.all([0,1].map(()=>f.call("/sandbox/requests","POST",{scenario:"wrong-buyer"},token,"race")));assert.ok(responses.some(r=>r.status===202));assert.ok(responses.every(r=>[202,503].includes(r.status)));assert.equal((await f.store.find("requests",{})).length,1);assert.equal((await f.store.find("demoInvoices",{})).length,1);
}));
test("a failed admission resumes its existing allowance and immutable invoice",async()=>setup(async f=>{
 const token=await f.visitor(),create=f.store.create.bind(f.store);let fail=true;f.store.create=async(table,doc)=>{if(table==="requests"&&fail){fail=false;throw Error("Isolated database outage");}return create(table,doc);};
 await expectError(await f.call("/sandbox/requests","POST",{scenario:"permitted"},token,"resume"),503,"UNAVAILABLE");const first=(await f.store.find<{_id:string;content:string}>("demoInvoices",{}))[0];
 const response=await f.call("/sandbox/requests","POST",{scenario:"permitted"},token,"resume");assert.equal(response.status,202);assert.equal((await f.store.find("requests",{})).length,1);assert.equal((await f.store.find<{_id:string;content:string}>("demoInvoices",{}))[0].content,first.content);assert.equal((await f.store.find("rate",{slotGroup:"sandbox-global-slot:"+f.card._id+":"})).length,1);
}));
test("visitors cannot read another visitor request even with its known public ID",async()=>setup(async f=>{
 const a=await f.visitor(),b=await f.visitor(),j=await (await f.call("/sandbox/requests","POST",{scenario:"permitted"},a,"purchase")).json();await expectError(await f.call("/sandbox/requests/"+j.id,"GET",undefined,b),404,"NOT_FOUND");
 const own=await f.call("/sandbox/requests/"+j.id,"GET",undefined,a);assert.equal(own.status,200);assert.equal((await own.json()).id,j.id);
}));
test("existing visitor records remain readable after a pause or key revocation without RPC access",async()=>setup(async f=>{
 const token=await f.visitor(),j=await (await f.call("/sandbox/requests","POST",{scenario:"wrong-buyer"},token,"paused-record")).json();f.evm.enabled=false;f.evm.view=async()=>{throw Error("Unavailable RPC");};await f.store.patch("keys",digest(f.key),{revoked:true});
 const response=await f.call("/sandbox/requests/"+j.id,"GET",undefined,token);assert.equal(response.status,200);assert.equal((await response.json()).id,j.id);await expectError(await f.call("/sandbox/requests","POST",{scenario:"permitted"},token,"new-after-revocation"),503,"SANDBOX_KEY_UNAVAILABLE");
}));
test("durable global allowance stops new admissions and key rotation does not reset the card ceiling",async()=>setup(async f=>{
 process.env.INTENTGUARD_SANDBOX_MAX_REQUESTS="1";const a=await f.visitor(),b=await f.visitor();assert.equal((await f.call("/sandbox/requests","POST",{scenario:"permitted"},a,"first")).status,202);await expectError(await f.call("/sandbox/requests","POST",{scenario:"permitted"},b,"second"),429,"SANDBOX_LIMIT_REACHED");
 const state=await (await f.call("/sandbox")).json();assert.equal(state.enabled,false);assert.equal(state.reasonCode,"SANDBOX_LIMIT_REACHED");
 const newKey=await issueKey(f.store,f.card._id,owner);process.env.INTENTGUARD_SANDBOX_API_KEY=newKey;const c=await f.visitor();await expectError(await f.call("/sandbox/requests","POST",{scenario:"permitted"},c,"after-rotation"),429,"SANDBOX_LIMIT_REACHED");assert.equal((await f.store.find("requests",{})).length,1);
}));
test("five requests per visitor are durable across fresh API handler instances",async()=>setup(async f=>{
 const token=await f.visitor(),actualNow=Date.now;let clock=actualNow();try{Date.now=()=>clock;for(let i=0;i<5;i++){if(i===3)clock+=60000;assert.equal((await f.call("/sandbox/requests","POST",{scenario:"wrong-buyer"},token,"allowance-"+i)).status,202);}clock+=60000;await expectError(await f.call("/sandbox/requests","POST",{scenario:"wrong-buyer"},token,"sixth"),429,"SANDBOX_LIMIT_REACHED");assert.equal((await f.store.find("requests",{})).length,5);}finally{Date.now=actualNow;}
}));
test("session IP controls ignore spoofed ordinary forwarding headers",async()=>setup(async f=>{
 for(let i=0;i<5;i++)assert.equal((await f.call("/sandbox/session","POST",{},undefined,undefined,{"x-forwarded-for":"192.0.2."+(i+1)})).status,201);
 await expectError(await f.call("/sandbox/session","POST",{},undefined,undefined,{"x-forwarded-for":"198.51.100.99"}),429,"RATE_LIMIT");
}));
test("actual Worker evidence validation rejects wrong-buyer before a reservation or review",async()=>setup(async f=>{
 const token=await f.visitor(),j=await (await f.call("/sandbox/requests","POST",{scenario:"wrong-buyer"},token,"bad-buyer")).json(),p=(await f.store.get<Payment>("requests",j.id))!,gl=new FakeGenLayer();
 const worker=new Worker(f.store,f.evm,gl,async url=>(await f.store.get<{_id:string;content:string}>("demoInvoices",new URL(url).pathname.split("/").at(-1)!))!.content),values=await worker.payment(p);assert.equal(values.status,"NEEDS_EVIDENCE");assert.equal(values.errorCode,"INVOICE_BUYER_MISMATCH");assert.equal(f.evm.reserves,0);assert.equal(gl.submissions,0);
}));
test("actual Worker budget preflight blocks the excessive sandbox amount",async()=>setup(async f=>{
 const token=await f.visitor(),j=await (await f.call("/sandbox/requests","POST",{scenario:"blocked"},token,"budget")).json(),p=(await f.store.get<Payment>("requests",j.id))!,gl=new FakeGenLayer();
 const worker=new Worker(f.store,f.evm,gl,async url=>(await f.store.get<{_id:string;content:string}>("demoInvoices",new URL(url).pathname.split("/").at(-1)!))!.content),values=await worker.payment(p);assert.equal(values.status,"BLOCKED");assert.equal(f.evm.reserves,0);assert.equal(gl.submissions,0);
}));
test("sandbox exposes actual finalized pipeline status instead of predicting a paid result",async()=>setup(async f=>{
 const token=await f.visitor(),j=await (await f.call("/sandbox/requests","POST",{scenario:"prohibited"},token,"purpose")).json(),p=(await f.store.get<Payment>("requests",j.id))!,gl=new FakeGenLayer();
 gl.decision=async(c,request)=>({decision:"REJECT",requestHash:request.requestHash!,policyHash:c.policyHash,evidenceHash:request.evidenceHash!,criteria:c.policy.criteria.map(criterion=>({id:criterion.id,status:criterion.id==="purpose"?"FAIL":"PASS",reason:criterion.id==="purpose"?"Personal data for advertising is prohibited.":"The invoice matches this testnet request.",sources:[request.input.evidence[0].url]})),reason:"Personal data for advertising is outside the owner permission."} as ReviewDecision);
 const worker=new Worker(f.store,f.evm,gl,async url=>(await f.store.get<{_id:string;content:string}>("demoInvoices",new URL(url).pathname.split("/").at(-1)!))!.content);
 for(let i=0;i<5;i++){const current=(await f.store.get<Payment>("requests",p._id))!,values=await worker.payment(current);await f.store.patch("requests",p._id,values);if(values.status==="REJECTED")break;}
 const actual=(await f.store.get<Payment>("requests",p._id))!;assert.equal(actual.status,"REJECTED");assert.equal(f.evm.settlements,0);const view=await (await f.call("/sandbox/requests/"+p._id,"GET",undefined,token)).json();assert.equal(view.status,"REJECTED");assert.equal(view.review.decision,"REJECT");assert.equal(view.reviewStage.status,"COMPLETE");
}));
test("the permitted sandbox input can complete the actual admission and Worker settlement path",async()=>setup(async f=>{
 const token=await f.visitor(),j=await (await f.call("/sandbox/requests","POST",{scenario:"permitted"},token,"positive-control")).json(),gl=new FakeGenLayer();
 gl.decision=async(c,p)=>({decision:"APPROVE",requestHash:p.requestHash!,policyHash:c.policyHash,evidenceHash:p.evidenceHash!,criteria:c.policy.criteria.map(criterion=>({id:criterion.id,status:"PASS",reason:"Approved merchant invoice matches the protocol verification mission.",sources:[p.input.evidence[0].url]})),reason:"The exact requested native USDC settlement verification is permitted."} as ReviewDecision);
 const worker=new Worker(f.store,f.evm,gl,async url=>(await f.store.get<{_id:string;content:string}>("demoInvoices",new URL(url).pathname.split("/").at(-1)!))!.content);
 for(let i=0;i<6;i++){const current=(await f.store.get<Payment>("requests",j.id))!,values=await worker.payment(current);await f.store.patch("requests",j.id,values);if(values.status==="PAID")break;}
 const actual=(await f.store.get<Payment>("requests",j.id))!;assert.equal(actual.status,"PAID");assert.equal(f.evm.settlements,1);assert.ok(actual.paymentTxHash);const view=await (await f.call("/sandbox/requests/"+j.id,"GET",undefined,token)).json();assert.equal(view.status,"PAID");assert.equal(view.paymentTxHash,actual.paymentTxHash);assert.equal(view.reviewStage.status,"COMPLETE");
}));
test("original failed draft input is available only in its authenticated owner branch",async()=>setup(async f=>{
 const id=digest("failed-user-draft"),input={description:"Recover this owner's failed setup.",guidance:{privateNotes:"owner-only-guidance"}};await f.store.create("drafts",{_id:id,owner,input,inputHash:digest(input),state:"FAILED",error:"Final consensus failed",createdAt:1,updatedAt:1});
 const path="/owner/drafts/"+id,req=new Request(origin+"/api/v1"+path,{headers:{Origin:origin,Cookie:"ig_session="+session(owner,{origin,transport:"cookie"})}}),response=await f.api(req,path);assert.equal(response.status,200);assert.deepEqual((await response.json()).input,input);
 await expectError(await f.call(path),401,"LOGIN_REQUIRED");const stranger=new Request(origin+"/api/v1"+path,{headers:{Origin:origin,Cookie:"ig_session="+session(merchant,{origin,transport:"cookie"})}});await expectError(await f.api(stranger,path),404,"NOT_FOUND");
}));
