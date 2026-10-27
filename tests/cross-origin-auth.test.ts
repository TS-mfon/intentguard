import {test} from "node:test";
import assert from "node:assert/strict";
import {privateKeyToAccount} from "viem/accounts";
import {MemoryStore,type Doc} from "../apps/web/lib/store";
import {createApi,route} from "../apps/web/lib/api";
import {challenge,login,session,requestOwnerSession} from "../apps/web/lib/auth";
import {configuration} from "../apps/web/lib/config";
import {browserCors,ownerContext} from "../apps/web/lib/origins";
import {publicDeploymentConfiguration} from "../apps/web/lib/capabilities";
import {FakeEvm,card} from "./fixtures";
const apiOrigin="https://api.example",frontend="https://1-2-7.gateway.example";
const account=privateKeyToAccount(("0x"+"14".repeat(32)) as `0x${string}`);
const names=["INTENTGUARD_MODE","INTENTGUARD_PAYMENT_ENV","XLAYER_CHAIN_ID","MONGODB_DB","MONGODB_URI","APP_URL","FRONTEND_URL","SESSION_SECRET","GENLAYER_NETWORK","GENLAYER_CHAIN_ID","INTENTGUARD_VERIFIED_MANIFEST"];
async function fixture<T>(run:(s:MemoryStore,api:ReturnType<typeof createApi>)=>Promise<T>){
 const previous=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 try{for(const k of names)delete process.env[k];Object.assign(process.env,{INTENTGUARD_MODE:"testnet",INTENTGUARD_PAYMENT_ENV:"testnet",XLAYER_CHAIN_ID:"1952",MONGODB_DB:"intentguard",APP_URL:apiOrigin,FRONTEND_URL:frontend,SESSION_SECRET:"fixture-owner-session-secret-longer-than-32"});const s=new MemoryStore();return await run(s,createApi(s,new FakeEvm(),{requireConfigured:false,wake:()=>{}}));}
 finally{for(const[k,v]of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;}
}
function req(path:string,method="GET",body?:unknown,headers:Record<string,string>={}){
 return new Request(apiOrigin+"/api/v1"+path,{method,headers:{origin:frontend,"x-intentguard-environment":"testnet",...(body?{"content-type":"application/json"}:{}),...Object.fromEntries(Object.entries(headers))},...(body?{body:JSON.stringify(body)}:{})});
}
async function signin(api:ReturnType<typeof createApi>){
 const result=await api(req("/auth/challenge","POST",{address:account.address}),"/auth/challenge");assert.equal(result.status,200);
 const {message}=await result.json();assert.ok(message.includes("URI: "+frontend));assert.ok(message.includes("API: "+apiOrigin));
 const signature=await account.signMessage({message}),response=await api(req("/auth/login","POST",{address:account.address,signature}),"/auth/login");
 assert.equal(response.status,200);assert.equal(response.headers.get("set-cookie"),null);
 return {response,...await response.json()};
}
test("approved frontend preflight is explicit and does not enable third-party cookies",()=>fixture(async(_s,api)=>{
 const r=req("/owner/cards","OPTIONS",undefined,{"access-control-request-method":"GET","access-control-request-headers":"Authorization, X-IntentGuard-Environment"}),result=await api(r,"/owner/cards");
 assert.equal(result.status,204);assert.equal(result.headers.get("access-control-allow-origin"),frontend);assert.equal(result.headers.get("access-control-allow-credentials"),null);assert.match(result.headers.get("vary")!,/Origin/);
 assert.match(result.headers.get("access-control-allow-headers")!,/x-intentguard-environment/);
}));
test("preflight rejects unapproved origins methods headers and null-origin authority",()=>fixture(async(_s,api)=>{
 for(const headers of [{origin:"https://evil.example"},{origin:"null"},{"access-control-request-method":"DELETE"},{"access-control-request-headers":"Authorization, Cookie, X-IntentGuard-Environment"},{"access-control-request-headers":"Authorization"},{"access-control-request-headers":"X-IntentGuard-Environment, x-intentguard-environment"}]){
 const r=req("/owner/cards","OPTIONS",undefined,{"access-control-request-method":"GET","access-control-request-headers":"Authorization, X-IntentGuard-Environment",...Object.fromEntries(Object.entries(headers))});
 const result=await api(r,"/owner/cards");assert.equal(result.status,403);assert.equal(result.headers.get("access-control-allow-origin"),null);
 }
}));
test("cross-origin owner login binds API frontend and payment scope and authorizes the owner",()=>fixture(async(s,api)=>{
 const {ownerSession:token,expiresAt,response}=await signin(api);assert.ok(expiresAt<=Date.now()+600000);assert.ok(expiresAt>Date.now()+590000);assert.equal(response.headers.get("access-control-allow-origin"),frontend);
 assert.equal(await requestOwnerSession(s,req("/owner/cards","GET",undefined,{authorization:"Owner "+token})),account.address.toLowerCase());
 const result=await api(req("/owner/cards","GET",undefined,{authorization:"Owner "+token}),"/owner/cards");assert.equal(result.status,200);assert.deepEqual(await result.json(),{cards:[]});
 assert.equal((await api(req("/me","GET",undefined,{authorization:"Owner "+token}),"/me")).status,401);
}));
test("copied owner token cannot cross origin API environment or session transport",()=>fixture(async(s,api)=>{
 const {ownerSession:token}=await signin(api);
 for(const headers of [{origin:"https://evil.example"},{origin:apiOrigin},{authorization:"Bearer "+token},{"x-intentguard-environment":"mainnet"}]){
 const result=await api(req("/owner/cards","GET",undefined,{authorization:"Owner "+token,...Object.fromEntries(Object.entries(headers))}),"/owner/cards");assert.ok([401,403,409].includes(result.status));
 }
 const cookie=await api(req("/owner/cards","GET",undefined,{cookie:"ig_session="+token}),"/owner/cards");assert.equal(cookie.status,401);
 process.env.APP_URL="https://other-api.example";assert.equal(await requestOwnerSession(s,new Request("https://other-api.example/api/v1/owner/cards",{headers:{origin:frontend,"x-intentguard-environment":"testnet",authorization:"Owner "+token}})),null);
 process.env.APP_URL=apiOrigin;Object.assign(process.env,{INTENTGUARD_MODE:"mainnet",INTENTGUARD_PAYMENT_ENV:"mainnet",XLAYER_CHAIN_ID:"196",MONGODB_DB:"intentguard_mainnet"});
 assert.equal(await requestOwnerSession(s,req("/owner/cards","GET",undefined,{authorization:"Owner "+token,"x-intentguard-environment":"mainnet"})),null);
}));
test("owner logout revokes persisted token and expiry cannot authorize dashboard access",()=>fixture(async(s,api)=>{
 const first=await signin(api),headers={authorization:"Owner "+first.ownerSession};
 assert.equal((await api(req("/auth/logout","POST",undefined,headers),"/auth/logout")).status,204);
 assert.equal((await api(req("/owner/cards","GET",undefined,headers),"/owner/cards")).status,401);
 const second=await signin(api),clock=Date.now;
 try{const later=Date.now()+601000;Date.now=()=>later;assert.equal(await requestOwnerSession(s,req("/owner/cards","GET",undefined,{authorization:"Owner "+second.ownerSession})),null);}finally{Date.now=clock;}
}));
test("same-origin testnet cookies still work and cannot authenticate across frontend origins",()=>fixture(async(_s,api)=>{
 const ch=await api(req("/auth/challenge","POST",{address:account.address},{origin:apiOrigin}),"/auth/challenge"),{message}=await ch.json(),signature=await account.signMessage({message});
 const result=await api(req("/auth/login","POST",{address:account.address,signature},{origin:apiOrigin}),"/auth/login");assert.equal(result.status,200);
 const cookie=result.headers.get("set-cookie")!.split(";")[0];assert.match(cookie,/^ig_session=/);assert.equal((await result.json()).ownerSession,undefined);
 assert.equal((await api(new Request(apiOrigin+"/api/v1/owner/cards",{headers:{cookie}}),"/owner/cards")).status,200);
 assert.equal((await api(req("/owner/cards","GET",undefined,{cookie}),"/owner/cards")).status,401);
 assert.equal((await api(req("/auth/session","GET",undefined,{cookie}),"/auth/session")).status,200);
 assert.equal((await (await api(req("/auth/session","GET",undefined,{cookie}),"/auth/session")).json()).address,null);
}));
test("challenge origin and transport changes are rejected before consumption",()=>fixture(async(s,_api)=>{
 const {message}=await challenge(s,account.address,frontend,"owner-bearer"),signature=await account.signMessage({message});
 await assert.rejects(login(s,account.address,signature,{origin:apiOrigin,transport:"cookie"}));
 await assert.rejects(login(s,account.address,signature));
 const results=await Promise.allSettled([login(s,account.address,signature,{origin:frontend,transport:"owner-bearer"}),login(s,account.address,signature,{origin:frontend,transport:"owner-bearer"})]);
 assert.equal(results.filter(x=>x.status==="fulfilled").length,1);assert.equal(results.filter(x=>x.status==="rejected").length,1);
}));
test("public config and preflight stay truthful without a database or release",()=>fixture(async(_s,_api)=>{
 const result=await route(req("/config"));assert.equal(result.status,200);const c=await result.json();assert.equal(c.apiOrigin,apiOrigin);assert.equal(c.frontendOrigin,frontend);assert.equal(c.ownerSessionTransport,"owner-bearer");assert.equal(c.settlementVersion,1);assert.equal(c.configured,false);
 assert.equal((await route(req("/owner/cards","OPTIONS",undefined,{"access-control-request-method":"GET","access-control-request-headers":"Authorization, X-IntentGuard-Environment"}))).status,204);
 Object.assign(process.env,{INTENTGUARD_MODE:"mainnet",INTENTGUARD_PAYMENT_ENV:"mainnet",XLAYER_CHAIN_ID:"196",MONGODB_DB:"intentguard_mainnet"});
 const main=await publicDeploymentConfiguration();assert.equal(main.configured,false);assert.equal(main.settlementVersion,2);assert.deepEqual(main.assets,[]);assert.deepEqual(main.spendingNetworks,[]);
}));
test("browser payment declaration and canonical frontend parsing reject ambiguous authority",()=>fixture(async(_s,api)=>{
 const missing=req("/config");missing.headers.delete("x-intentguard-environment");assert.equal((await api(missing,"/config")).status,409);
 for(const value of ["https://evil.example/path","https://user:pass@gateway.example","https://gateway.example/?x=1","https://gateway.example/#x","http://gateway.example"]){process.env.FRONTEND_URL=value;assert.throws(()=>configuration());}
 process.env.FRONTEND_URL=frontend;assert.deepEqual(ownerContext(req("/config")),{origin:frontend,transport:"owner-bearer"});
 assert.throws(()=>browserCors(req("/config","GET",undefined,{"x-intentguard-environment":"mainnet"}),["GET"]));
}));
test("ambiguous JSON bodies cannot issue owner authentication challenges",()=>fixture(async(s,api)=>{
 const raw='{"address":"'+account.address+'","address":"'+account.address+'"}',r=new Request(apiOrigin+"/api/v1/auth/challenge",{method:"POST",headers:{origin:frontend,"x-intentguard-environment":"testnet","content-type":"application/json"},body:raw});
 assert.equal((await api(r,"/auth/challenge")).status,400);assert.equal((await s.find("challenges",{})).length,0);
}));

test("owner session persistence failure cannot issue an apparently usable token",()=>fixture(async(s,_api)=>{
 const {message}=await challenge(s,account.address,frontend,"owner-bearer"),signature=await account.signMessage({message}),create=s.create.bind(s);
 s.create=async(t,d)=>t==="challenges"&&d._id.startsWith("owner-session:")?false:create(t,d);
 await assert.rejects(login(s,account.address,signature,{origin:frontend,transport:"owner-bearer"}),/fresh wallet challenge/);
}));
test("owner session nonce prevents duplicate tokens within the same clock tick",()=>fixture(async(_s,_api)=>{
 const clock=Date.now,fixed=Date.now();try{Date.now=()=>fixed;assert.notEqual(session(account.address,{origin:frontend,transport:"owner-bearer"}),session(account.address,{origin:frontend,transport:"owner-bearer"}));}finally{Date.now=clock;}
}));

test("challenge expiry during atomic claim cannot mint a fresh owner session",()=>fixture(async(s,_api)=>{
 const result=await challenge(s,account.address,frontend,"owner-bearer"),signature=await account.signMessage({message:result.message}),original=s.claim.bind(s),clock=Date.now;
 try{const expires=Number((await s.get("challenges",account.address.toLowerCase()))!.expires);s.claim=async<T extends Doc>(...args:Parameters<MemoryStore["claim"]>)=>{const row=await original<T>(...args);Date.now=()=>expires+1;return row;};await assert.rejects(login(s,account.address,signature,{origin:frontend,transport:"owner-bearer"}));}finally{Date.now=clock;}
}));
test("session expiry during the durable authority read cannot authenticate",()=>fixture(async(s,api)=>{
 const signed=await signin(api),original=s.get.bind(s),clock=Date.now;
 try{s.get=async<T extends Doc>(...args:Parameters<MemoryStore["get"]>)=>{const row=await original<T>(...args);if(args[0]==="challenges"&&args[1].startsWith("owner-session:"))Date.now=()=>signed.expiresAt+1;return row;};assert.equal(await requestOwnerSession(s,req("/owner/cards","GET",undefined,{authorization:"Owner "+signed.ownerSession})),null);}finally{Date.now=clock;}
}));
test("delayed session persistence cannot return an expired owner token",()=>fixture(async(s,_api)=>{
 const result=await challenge(s,account.address,frontend,"owner-bearer"),signature=await account.signMessage({message:result.message}),original=s.create.bind(s),clock=Date.now;
 try{s.create=async(...args)=>{const created=await original(...args);if(args[0]==="challenges"&&args[1]._id.startsWith("owner-session:")){const expires=Number(args[1].expires);Date.now=()=>expires+1;}return created;};await assert.rejects(login(s,account.address,signature,{origin:frontend,transport:"owner-bearer"}));}finally{Date.now=clock;}
}));

test("public card share links use the approved frontend instead of the API host",()=>fixture(async(s,api)=>{
 await s.create("cards",{...card,chainId:1952,paymentEnvironment:"testnet"});
 const path="/explorer/agents/"+card._id+"/card",response=await api(req(path),path);
 assert.equal(response.status,200);assert.equal((await response.json()).shareUrl,frontend+"/explorer?agentId="+encodeURIComponent(card._id)+"&view=agents");
}));
