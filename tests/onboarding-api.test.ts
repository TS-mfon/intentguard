import test from "node:test";
import assert from "node:assert/strict";
import {createApi} from "../apps/web/lib/api";
import {session} from "../apps/web/lib/auth";
import {MemoryStore} from "../apps/web/lib/store";
import {policySchema,digest,type CardView} from "../packages/shared";
import {card,policy,owner,FakeEvm} from "./fixtures";

const base="https://onboarding.testnet.example";
const values={INTENTGUARD_MODE:"testnet",INTENTGUARD_PAYMENT_ENV:"testnet",XLAYER_CHAIN_ID:"1952",APP_URL:base,FRONTEND_URL:base,MONGODB_DB:"intentguard",MONGODB_URI:"mongodb://controlled.invalid/intentguard",SESSION_SECRET:"onboarding-controlled-owner-session-secret",PAYMENT_TOKEN:card.token!,CARD_FACTORY_ADDRESS:card.address,GATEWAY_ADDRESS:card.address,ATTESTOR_ADDRESS:card.reviewerAddress!,TAPEOUT_PROCESSOR:card.address,TAPEOUT_BEACON:card.address,TAPEOUT_IMPLEMENTATION:card.address,TAPEOUT_CIRCUIT_ID:"1",TAPEOUT_NETLIST_HASH:digest("controlled-netlist"),GENLAYER_INTERPRETER_ADDRESS:card.address};
const names=[...Object.keys(values),"INTENTGUARD_FRONTEND_ORIGINS","INTENTGUARD_TESTNET_APPLICATION_URL","INTENTGUARD_MAINNET_APPLICATION_URL","INTENTGUARD_VERIFIED_MANIFEST","CCTP_CARD_FACTORY_ADDRESS"];
async function fixture(run:(f:{store:MemoryStore;evm:FakeEvm;call:(path:string,input?:unknown,as?:string)=>Promise<Response>;wakes:()=>number})=>Promise<void>){
 const prior=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 try{
  names.forEach(name=>delete process.env[name]);Object.assign(process.env,values);
  const store=new MemoryStore(),evm=new FakeEvm();let wakes=0;
  const original=evm.view.bind(evm);evm.view=async c=>({...await original(c),chainId:1952,paymentEnvironment:"testnet",reviewEnvironment:"testnet",reviewNetwork:"studionet",reviewChainId:61999} as CardView);
  const api=createApi(store,evm,{requireConfigured:false,wake:()=>{wakes++;}});
  const call=(path:string,input?:unknown,as=owner)=>api(new Request(base+"/api/v1"+path,{method:input===undefined?"GET":"POST",headers:{origin:base,cookie:"ig_session="+session(as),...(input===undefined?{}:{"content-type":"application/json"})},...(input===undefined?{}:{body:JSON.stringify(input)})}),path);
  await run({store,evm,call,wakes:()=>wakes});
 }finally{for(const [name,value]of Object.entries(prior))if(value===undefined)delete process.env[name];else process.env[name]=value;}
}

test("complete guided onboarding rejects malformed money as field errors without queuing review",()=>fixture(async f=>{
 for(const field of ["totalBudget","perPaymentLimit","periodBudget"] as const)for(const value of ["1e3","-1","0","01","1.0000001","18446744073709.551616"]){
  const guidance={...policy,financial:{...policy.financial,[field]:value}};
  assert.equal(policySchema.safeParse(guidance).success,false);
  const response=await f.call("/owner/drafts",{description:"Purchase verifiable research APIs",guidance});
  assert.equal(response.status,422);const {error}=await response.json();assert.equal(error.code,"INVALID_POLICY");
  assert.ok(error.details.issues.some((issue:{path:string[];field:string})=>issue.field==="financial."+field&&issue.path.join(".")===issue.field));
 }
 assert.equal((await f.store.find("drafts",{})).length,0);assert.equal(f.wakes(),0);
}));

test("complete guidance returns every relevant policy issue and rejects conflicting budget prose",()=>fixture(async f=>{
 const guidance={...policy,financial:{...policy.financial,totalBudget:"1",perPaymentLimit:"2",validUntil:policy.financial.validFrom},merchants:[],criteria:[policy.criteria[0],policy.criteria[0]]};
 const response=await f.call("/owner/drafts",{description:"Research for my project",guidance});assert.equal(response.status,422);
 const {error}=await response.json(),fields=error.details.issues.map((issue:{field:string})=>issue.field);
 for(const field of ["financial.perPaymentLimit","financial.validUntil","merchants","criteria"])assert.ok(fields.includes(field),field);
 for(const prose of ["Spend at most 10 USDC per week for research","A daily budget of 10 USD pays for data"]){
  const response=await f.call("/owner/drafts",{description:policy.mission,guidance:{...policy,mission:prose}});
  assert.equal(response.status,422);assert.equal((await response.json()).error.code,"CONFLICTING_BUDGET_PROSE");
 }
 assert.equal((await f.store.find("drafts",{})).length,0);
}));

test("valid complete onboarding preserves exact owner policy input and still queues substantive consensus",()=>fixture(async f=>{
 const guidance={...policy,financial:{...policy.financial,totalBudget:"100.000001",perPaymentLimit:"10.000001"}};
 const input={description:"Purchase verifiable data for this specific research project",guidance};
 const response=await f.call("/owner/drafts",input);assert.equal(response.status,202);const admitted=await response.json();
 const saved=await f.store.get("drafts",admitted.id);assert.equal(saved?.state,"QUEUED");assert.deepEqual(saved?.input,input);assert.equal(saved?.inputHash,digest(input));
 assert.equal(saved?.result,undefined);assert.equal(f.wakes(),1);
}));

test("partial and legacy guidance retain their interpreter path and historical input commitments",()=>fixture(async f=>{
 for(const input of [{description:policy.mission},{description:policy.mission,guidance:{name:policy.name}}]){
  const response=await f.call("/owner/drafts",input);assert.equal(response.status,202);const saved=await f.store.get("drafts",(await response.json()).id);
  assert.deepEqual(saved?.input,input);assert.equal(saved?.inputHash,digest(input));assert.equal(saved?.state,"QUEUED");
 }
 assert.equal(f.wakes(),2);
}));

test("draft diagnostics are allowlisted and only finalized proposed policies expose activation",()=>fixture(async f=>{
 const id=digest("onboarding-draft"),input={description:policy.mission,guidance:policy};
 await f.store.create("drafts",{_id:id,owner,input,inputHash:digest(input),state:"FAILED",error:"Review the saved terms and submit a new proposal.",errorCode:"DRAFT_GENERATION_CHANGED_GUIDANCE",createdAt:1,updatedAt:1});
 let response=await f.call("/owner/drafts/"+id),view=await response.json();assert.equal(view.diagnosticCode,"DRAFT_GENERATION_CHANGED_GUIDANCE");assert.deepEqual(view.input,input);assert.equal(view.activation,undefined);
 await f.store.patch("drafts",id,{errorCode:"PRIVATE_PROVIDER_PAYLOAD"});view=await (await f.call("/owner/drafts/"+id)).json();assert.equal(view.diagnosticCode,undefined);
 for(const state of ["QUEUED","AWAITING_FINALITY","FAILED"]){await f.store.patch("drafts",id,{state,result:{status:"PROPOSED",policy,questions:[],interpretation:"Queued fixture"}});assert.equal((await (await f.call("/owner/drafts/"+id)).json()).activation,undefined);}
 await f.store.patch("drafts",id,{state:"FINALIZED",result:{status:"NEEDS_CLARIFICATION",policy,questions:["Specify the merchant"],interpretation:"Clarification fixture"}});assert.equal((await (await f.call("/owner/drafts/"+id)).json()).activation,undefined);
 await f.store.patch("drafts",id,{result:{status:"PROPOSED",policy,questions:[],interpretation:"Finalized fixture"}});view=await (await f.call("/owner/drafts/"+id)).json();assert.equal(view.activation.factoryAddress,card.address);
 assert.equal((await f.call("/owner/drafts/"+id,undefined,"0x"+"66".repeat(20))).status,404);
}));

test("owner gallery supplies actual PAID-only usage without querying every public preview",()=>fixture(async f=>{
 const source={...card,chainId:1952,paymentEnvironment:"testnet" as const};await f.store.create("cards",source);
 for(const [status,amount]of [["PAID","1.25"],["BRIDGING","50"],["APPROVED","70"],["CANCELLED","3"]])await f.store.create("requests",{_id:digest(status),cardId:card._id,status,input:{amount},createdAt:1,updatedAt:1});
 let calls=0;const usage=f.store.usage.bind(f.store);f.store.usage=async id=>{calls++;return usage(id);};
 const response=await f.call("/owner/cards");assert.equal(response.status,200);const {cards}=await response.json();
 assert.equal(cards.length,1);assert.equal(cards[0].usage.fundsMoved,"1.25");assert.equal(cards[0].usage.requestCount,4);assert.equal(cards[0].usage.paidCount,1);assert.equal(cards[0].usage.activeCount,2);assert.equal(cards[0].usage.chainId,1952);assert.ok(cards[0].usage.asOf<=Date.now());assert.equal(calls,1);
 await f.store.patch("cards",card._id,{chainId:196,paymentEnvironment:"mainnet"});assert.equal((await f.call("/owner/cards")).status,409);
}));
