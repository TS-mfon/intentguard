import test from "node:test";
import assert from "node:assert/strict";
import {privateKeyToAccount} from "viem/accounts";
import {MemoryStore} from "../apps/web/lib/store";
import {createApi} from "../apps/web/lib/api";
import {configuration,publicConfiguration} from "../apps/web/lib/config";
import {publicDeploymentConfiguration} from "../apps/web/lib/capabilities";
import {IntentGuardOwner,IntentGuard,IntentGuardError} from "../packages/sdk";
import {FakeEvm,card} from "./fixtures";

const apiOrigin="https://origins.testnet.example",primary="https://1-2-7.gateway.example",fallback="https://fallback.example";
const account=privateKeyToAccount(("0x"+"24".repeat(32)) as `0x${string}`);
const address="0x"+"12".repeat(20);
const values={INTENTGUARD_MODE:"testnet",INTENTGUARD_PAYMENT_ENV:"testnet",XLAYER_CHAIN_ID:"1952",APP_URL:apiOrigin,FRONTEND_URL:primary,MONGODB_DB:"intentguard",MONGODB_URI:"mongodb://controlled.invalid/intentguard",SESSION_SECRET:"origins-controlled-session-secret-over-32",PAYMENT_TOKEN:address,CARD_FACTORY_ADDRESS:address,GATEWAY_ADDRESS:address,ATTESTOR_ADDRESS:card.address,TAPEOUT_PROCESSOR:address,TAPEOUT_BEACON:address,TAPEOUT_IMPLEMENTATION:address,TAPEOUT_CIRCUIT_ID:"1",TAPEOUT_NETLIST_HASH:"0x"+"13".repeat(32),GENLAYER_INTERPRETER_ADDRESS:address,GENLAYER_NETWORK:"studionet",INTENTGUARD_RELEASE_ID:"controlled-release",INTENTGUARD_SOURCE_COMMIT:"a".repeat(40),INTENTGUARD_FRONTEND_ORIGINS:JSON.stringify([fallback])};
const names=[...Object.keys(values),"INTENTGUARD_VERIFIED_MANIFEST","INTENTGUARD_VERIFIED_MANIFEST_SHA256","INTENTGUARD_TESTNET_APPLICATION_URL","INTENTGUARD_MAINNET_APPLICATION_URL","DEMO_MERCHANT_RECIPIENT","DEMO_MERCHANT_ADMIN_KEY","CCTP_CARD_FACTORY_ADDRESS"];
async function fixture(run:(f:{store:MemoryStore;api:ReturnType<typeof createApi>;fetchImpl:typeof fetch;seen:RequestInit[]})=>Promise<void>){
 const prior=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 try{
  names.forEach(name=>delete process.env[name]);Object.assign(process.env,values);
  const store=new MemoryStore(),api=createApi(store,new FakeEvm(),{wake:()=>{}}),seen:RequestInit[]=[];
  const fetchImpl:typeof fetch=async(url,init={})=>{seen.push(init);const u=new URL(String(url));return api(new Request(url,init),u.pathname.replace("/api/v1",""));};
  await run({store,api,fetchImpl,seen});
 }finally{for(const [name,value]of Object.entries(prior))if(value===undefined)delete process.env[name];else process.env[name]=value;}
}
const mismatch=(e:unknown)=>{assert.ok(e instanceof IntentGuardError);assert.equal(e.code,"FRONTEND_IDENTITY_MISMATCH");return true;};

test("frontend aliases are explicit bounded canonical origins with separate environment navigation",()=>fixture(async()=>{
 const c=configuration();assert.deepEqual(c.frontendOrigins,[primary,apiOrigin,fallback]);assert.deepEqual(c.environmentUrls,{testnet:primary});
 process.env.INTENTGUARD_MAINNET_APPLICATION_URL="https://mainnet.example";assert.deepEqual(configuration().environmentUrls,{testnet:primary,mainnet:"https://mainnet.example"});assert.ok(!configuration().frontendOrigins.includes("https://mainnet.example"));
 for(const raw of ["*",JSON.stringify("https://one.example"),JSON.stringify([null]),JSON.stringify(["https://one.example/path"]),JSON.stringify(["https://user:pass@one.example"]),JSON.stringify(["http://one.example"]),JSON.stringify(["https://one.example","https://one.example/"]),JSON.stringify(Array.from({length:9},(_,i)=>"https://a"+i+".example"))]){process.env.INTENTGUARD_FRONTEND_ORIGINS=raw;assert.throws(()=>configuration());}
 process.env.INTENTGUARD_FRONTEND_ORIGINS="[]";process.env.INTENTGUARD_TESTNET_APPLICATION_URL="https://different.example";assert.throws(()=>configuration(),/current environment URL/);
}));

test("SDK aliases use their own challenge URI and origin-bound memory-only owner session",()=>fixture(async f=>{
 const sdk=new IntentGuardOwner({baseUrl:apiOrigin,paymentEnvironment:"testnet",frontendOrigin:fallback,fetchImpl:f.fetchImpl});
 const c=await sdk.capabilities();assert.equal(c.frontendOrigin,fallback);assert.equal(c.applicationUrl,fallback);assert.equal(c.environmentUrls?.testnet,primary);assert.equal(c.ownerSessionTransport,"owner-bearer");
 const {message}=await sdk.challenge(account.address);assert.ok(message.includes("URI: "+fallback));
 await sdk.login(account.address,await account.signMessage({message}));assert.deepEqual(await sdk.listCards(),{cards:[]});
 const saved=f.seen.at(-1)!;assert.equal(saved.credentials,"omit");const headers=new Headers(saved.headers);assert.equal(headers.get("Origin"),fallback);assert.match(headers.get("Authorization")!,/^Owner /);
 const copied=headers.get("Authorization")!;
 for(const origin of [primary,apiOrigin,"https://evil.example"]){const request=new Request(apiOrigin+"/api/v1/owner/cards",{headers:{origin,authorization:copied,"x-intentguard-environment":"testnet"}});const response=await f.api(request,"/owner/cards");assert.ok([401,403].includes(response.status),origin);}
 await sdk.logout();await assert.rejects(sdk.listCards(),e=>e instanceof IntentGuardError&&e.code==="LOGIN_REQUIRED");
 const revoked=await f.api(new Request(apiOrigin+"/api/v1/owner/cards",{headers:{origin:fallback,authorization:copied,"x-intentguard-environment":"testnet"}}),"/owner/cards");assert.equal(revoked.status,401);
}));

test("the API frontend uses cookies while approved separate frontends never inherit cookie authority",()=>fixture(async f=>{
 const sdk=new IntentGuardOwner({baseUrl:apiOrigin,paymentEnvironment:"testnet",frontendOrigin:apiOrigin,fetchImpl:f.fetchImpl});
 const c=await sdk.capabilities();assert.equal(c.ownerSessionTransport,"cookie");assert.equal(c.frontendOrigin,apiOrigin);
 const {message}=await sdk.challenge(account.address);assert.ok(message.includes("URI: "+apiOrigin));
 assert.equal(f.seen.at(-1)?.credentials,"include");
 const denied=new IntentGuardOwner({baseUrl:apiOrigin,paymentEnvironment:"testnet",frontendOrigin:"https://evil.example",fetchImpl:f.fetchImpl});
 const before=f.seen.length;await assert.rejects(denied.challenge(account.address),mismatch);assert.equal(f.seen.length,before+1);assert.equal(new Headers(f.seen.at(-1)?.headers).get("Authorization"),null);
}));

test("SDK fails closed on ambiguous frontend allowlists or deployment links before sending credentials",()=>fixture(async()=>{
 const c=await publicDeploymentConfiguration();
 const changes=[{frontendOrigins:"*"},{frontendOrigins:[]},{frontendOrigins:[fallback]},{frontendOrigins:[primary,fallback,fallback]},{frontendOrigins:[primary,fallback,"https://evil.example/path"]},{frontendOrigins:[primary,fallback,"https://*.example"]},{environmentUrls:{testnet:fallback}},{environmentUrls:{mainnet:"https://mainnet.example/path",testnet:primary}},{environmentUrls:{local:primary,testnet:primary}},{applicationUrl:fallback},{ownerSessionTransport:"cookie"}];
 for(const change of changes){const seen:RequestInit[]=[];const sdk=new IntentGuardOwner({baseUrl:apiOrigin,paymentEnvironment:"testnet",frontendOrigin:fallback,fetchImpl:async(_url,init={})=>{seen.push(init);return Response.json({...c,...change});}});await assert.rejects(sdk.challenge(account.address),mismatch);assert.equal(seen.length,1);assert.equal(new Headers(seen[0].headers).get("Authorization"),null);}
 const legacy={...c};delete (legacy as any).frontendOrigins;delete (legacy as any).environmentUrls;
 const canonical=new IntentGuard({baseUrl:apiOrigin,paymentEnvironment:"testnet",frontendOrigin:primary,fetchImpl:async()=>Response.json(legacy)});assert.equal((await canonical.capabilities()).frontendOrigin,primary);
}));

test("protocol test merchant config is testnet-only actual public information and never exposes its admin key",()=>fixture(async()=>{
 const recipient=account.address,secret="controlled-merchant-admin-key-longer-than-32";
 assert.equal(publicConfiguration().setupMerchant,undefined);process.env.DEMO_MERCHANT_RECIPIENT=recipient;process.env.DEMO_MERCHANT_ADMIN_KEY=secret;
 let c=publicConfiguration();assert.deepEqual(c.setupMerchant,{name:"IntentGuard protocol test merchant",recipient,origin:apiOrigin,products:["Native USDC settlement verification"]});assert.equal(JSON.stringify(c).includes(secret),false);
 process.env.DEMO_MERCHANT_RECIPIENT="0x"+"11".repeat(20);assert.equal(publicConfiguration().setupMerchant,undefined);
 process.env.DEMO_MERCHANT_RECIPIENT=recipient;process.env.DEMO_MERCHANT_ADMIN_KEY="short";assert.equal(publicConfiguration().setupMerchant,undefined);
 Object.assign(process.env,{INTENTGUARD_MODE:"mainnet",INTENTGUARD_PAYMENT_ENV:"mainnet",XLAYER_CHAIN_ID:"196",MONGODB_DB:"intentguard_mainnet",PAYMENT_TOKEN:"0x779ded0c9e1022225f8e0630b35a9b54be713736",DEMO_MERCHANT_ADMIN_KEY:secret});c=publicConfiguration();assert.equal(c.setupMerchant,undefined);assert.equal(JSON.stringify(c).includes(secret),false);
}));
