import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,symlink,rm,readFile,cp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {decodeFunctionData} from "viem";
import {PINS,ZERO,ABI,BEACON_SLOT,hash,gitCommit,verifySources,ReadOnlyRpc,observeProtocol} from "./protocol.mjs";
import {scanBundle,validatePath,gatewayResolve} from "./bundle.mjs";
import {makeQuote,validateQuote,publicationPlan,provisioningPlan,inspectFile,resumePublication} from "./planner.mjs";

const OWNER="0x"+"12".repeat(20),PROCESSOR="0x"+"34".repeat(20),CONTAINER="0x"+"56".repeat(20);
const NOW=Date.now();const BLOCK={number:"0x123",hash:"0x"+"ab".repeat(32),timestamp:Math.floor(NOW/1000)};
const netlist=await readFile(new URL("../../circuits/artifacts/policy.netlist.bin",import.meta.url));
const codeFiles=JSON.parse(await readFile(new URL("./fixtures/xlayer-bytecode.json",import.meta.url),"utf8")).codeFiles;
const codeFixture=Object.fromEntries(await Promise.all(Object.entries(codeFiles).map(async([addr,path])=>[addr,(await readFile(new URL("./fixtures/"+path,import.meta.url),"utf8")).trim()])));
const sources=await verifySources();const commit=gitCommit();
const officialPath=await import(new URL("../../.local/TapeKit/kernel/src/path.js",import.meta.url));
const snapshot=()=>({chainId:196,block:{...BLOCK},implementations:{factory:PINS.contracts.factoryImplementation,registry:PINS.contracts.registryImplementation,binding:PINS.contracts.bindingImplementation},
 codeSha256:{...PINS.codeSha256},beacon:PINS.contracts.beacon,beaconOwner:ZERO,circuitImplementation:PINS.contracts.circuitImplementation,
 admins:{factory:OWNER,registry:OWNER,binding:OWNER},factorySealed:false,fees:{deployFeeWei:"6600000000000000",monthlyFeeWei:"0",openerFeeWei:"0"},
 site:{processor:PROCESSOR,processorCodeSha256:hash(Buffer.from("6000","hex")),cpuIndex:"7",tokenId:"1",holder:OWNER,container:CONTAINER,opened:true,name:"1.2.7.tape",netlistSha256:hash(netlist)}});
const fixtureContents={"index.html":Buffer.from('<!doctype html><html><script src="/app.js"></script></html>'),"app.js":Buffer.alloc(48001,97),"docs/index.html":Buffer.from("<html>docs</html>")};
async function withBundle(check){
 const directory=await mkdtemp(join(tmpdir(),"intentguard-hosting-"));
 try{await mkdir(join(directory,"docs"));for(const [path,bytes]of Object.entries(fixtureContents))await writeFile(join(directory,path),bytes);
  await check(directory,await scanBundle(directory,{apiOrigins:["https://api.intentguard.example"]}));
 }finally{await rm(directory,{recursive:true,force:true});}
}
function quote(bundle,protocol=snapshot()){return makeQuote({protocol,sources,bundle,sourceCommit:commit,owner:OWNER,capWei:"1000000000000000000",gasPriceWei:"1000000000",now:NOW});}
function auth(q){return {expectedHash:q.quoteHash,capWei:q.spendingCapWei,now:NOW};}
class MemoryRpc{
 constructor(protocol=snapshot()){this.protocol=protocol;this.files=new Map();this.calls=[];this.code=codeFixture;}
 async pin(){return this.protocol.block;}
 async request(method,params){
  this.calls.push({method,params});
  if(method==="eth_getBlockByNumber")return this.protocol.block;
  if(method==="eth_getStorageAt"){
   if(params[1]===BEACON_SLOT)return "0x"+"0".repeat(24)+this.protocol.beacon.slice(2);
   const key=Object.keys(PINS.contracts).find(k=>PINS.contracts[k]===params[0]);const impl=this.protocol.implementations[key];
   return "0x"+"0".repeat(24)+impl.slice(2);
  }
  if(method==="eth_getCode"){
   // observeProtocol checks exact pinned raw bytecode hashes. The test caller
   // below loads controlled live-bytecode fixtures only for full observation.
   return this.code?.[params[0]]??"0x6000";
  }
  throw Error("Unexpected request "+method);
 }
 async call(to,name,args=[],block){
  this.calls.push({name,args,block});const p=this.protocol;
  switch(name){
   case "circuitBeacon":return p.beacon;case "implementation":return p.circuitImplementation;case "isSealed":return p.factorySealed;
   case "owner":return to===p.beacon?p.beaconOwner:p.admins[Object.keys(PINS.contracts).find(k=>PINS.contracts[k]===to)];
   case "monthlyFee":return BigInt(p.fees.monthlyFeeWei);case "deployFee":return BigInt(p.fees.deployFeeWei);case "FEE":return BigInt(p.fees.openerFeeWei);
   case "cpuAt":return PROCESSOR;case "isCPU":return true;case "ownerOf":return p.site.holder;case "accountOf":return CONTAINER;case "isOpened":return p.site.opened;
   case "token":return [196n,PROCESSOR,1n];case "isOpenedContainer":return true;case "netlist":return "0x"+netlist.toString("hex");case "circuitInfo":return [451,8,0,1766];
   case "fallbackPath":return "index.html";
   case "fileInfo":{const f=this.files.get(args[1]);return f?[f.bytes.length,f.contentType,"0x"+f.sha256,1n,BigInt(f.count)]:[0,"","0x"+"0".repeat(64),0n,0n];}
   case "readRange":{const f=this.files.get(args[1]);return "0x"+f.bytes.subarray(Number(args[2]),Number(args[2]+args[3])).toString("hex");}
   default:throw Error("Unexpected call "+name);
  }
 }
}
test("official TapeKit source and circuit NAND metadata match exact pinned bytes",async()=>{
 assert.equal(sources.tapeKitCommit,PINS.tapeKit.commit);assert.equal(sources.gateCount,1766);assert.equal(sources.netlistSha256,hash(netlist));
 const temp=await mkdtemp(join(tmpdir(),"intentguard-hosting-source-"));
 try{
  await cp(new URL("../../.local/TapeKit/",import.meta.url),temp,{recursive:true});
  assert.equal((await verifySources({tapeKit:temp})).tapeKitCommit,PINS.tapeKit.commit);
  await writeFile(join(temp,"kernel/src/config.js"),"export const XLAYER_MAINNET = {};\n");
  await assert.rejects(verifySources({tapeKit:temp}),/source hash mismatch/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
test("static bundle positive control has stable per-file hashes chunks MIME and gateway deep links",()=>withBundle(async(directory,bundle)=>{
 assert.equal(bundle.files.length,3);assert.equal(bundle.files.find(f=>f.path==="app.js").chunks.length,3);
 assert.deepEqual(bundle.files.find(f=>f.path==="app.js").chunks.map(c=>c.size),[24000,24000,1]);
 assert.equal(bundle.files.find(f=>f.path==="index.html").contentType,"text/html; charset=utf-8");
 const paths=new Set(bundle.files.map(f=>f.path));assert.equal(gatewayResolve("/",paths),"index.html");
 assert.equal(gatewayResolve("/docs",paths),"docs/index.html");assert.equal(gatewayResolve("/dashboard/card",paths),"index.html");
 assert.equal(gatewayResolve("/missing.png",paths),null);assert.equal(gatewayResolve("/../dashboard",paths),null);
 for(const path of ["/","/docs","/docs/","/dashboard/card","/missing.png","/../dashboard","//docs","/%64ocs","/broken%zz"]){
  assert.equal(gatewayResolve(path,paths),officialPath.resolvePath(path,paths,"index.html"),"Official gateway path drift: "+path);
 }
 assert.deepEqual(await scanBundle(directory,{apiOrigins:bundle.apiOrigins}),bundle);
}));
test("forbidden paths symlinks NFD source maps and secret literals fail against a valid bundle",()=>withBundle(async(directory,bundle)=>{
 for(const path of [".env","secrets.json","source.ts","app.js.map","a/../b.js","a%2fb.js","a#b.js","a?b.js","a\\b.js","e\u0301.html",".tape/status.html","node_modules/a.js"])assert.throws(()=>validatePath(path),undefined,path);
 await symlink(join(directory,"app.js"),join(directory,"linked.js"));await assert.rejects(scanBundle(directory),/Symlinks/);await rm(join(directory,"linked.js"));
 await writeFile(join(directory,"app.js"),"console.log(1);\n//# sourceMappingURL=app.js.map");await assert.rejects(scanBundle(directory),/Source maps/);
 await writeFile(join(directory,"app.js"),'const private_key = "0x'+"ab".repeat(32)+'";');await assert.rejects(scanBundle(directory),/Secret/);
 await writeFile(join(directory,"app.js"),fixtureContents["app.js"]);assert.equal((await scanBundle(directory,{apiOrigins:bundle.apiOrigins})).directorySha256,bundle.directorySha256);
}));
test("wrong chain mutable circuit beacon code and implementation changes cannot become quotes",()=>withBundle(async(_,bundle)=>{
 assert.equal(quote(bundle).status,"READ_ONLY_QUOTE");
 for(const mutate of [p=>p.chainId=1952,p=>p.beaconOwner=OWNER,p=>p.circuitImplementation=OWNER,p=>p.implementations.registry=OWNER,p=>p.codeSha256[PINS.contracts.opener]="0".repeat(64),p=>p.site.holder=CONTAINER]){
  const p=snapshot();mutate(p);assert.throws(()=>quote(bundle,p));
 }
 // Official TapeKit permits an unsealed factory with frozen existing CPU code.
 assert.equal(quote(bundle).protocol.factorySealed,false);assert.ok(quote(bundle).risks.some(s=>s.includes("unsealed")));
}));
test("expired mutated quotes exact caps and static directory identity cannot bypass plan guards",()=>withBundle(async(_,bundle)=>{
 const q=quote(bundle),plan=publicationPlan(q,auth(q));assert.equal(plan.status,"PLANNED_NOT_PUBLISHED");
 assert.throws(()=>validateQuote(q,{...auth(q),now:q.expiresAt}),/Expired/);
 assert.throws(()=>validateQuote(q,{...auth(q),capWei:"1"}),/cap/);
 assert.throws(()=>validateQuote(q,{...auth(q),expectedHash:"0".repeat(64)}),/hash/);
 const changed=structuredClone(q);changed.economics.monthlyFeeWei="1";assert.throws(()=>publicationPlan(changed,auth(q)),/Mutated/);
 const bad=structuredClone(bundle);bad.files[0].sha256="0".repeat(64);assert.throws(()=>quote(bad),/digest/);
 const protocol=snapshot();protocol.site.opened=false;const unopened=quote(bundle,protocol);assert.throws(()=>publicationPlan(unopened,auth(unopened)),/opening/);
}));
test("unknown required fees remain incomplete and provisioning exposes unsimulated dependent stages",()=>{
 const p=snapshot();delete p.site;p.fees.openerFeeWei=null;
 const q=quote(null,p);assert.equal(q.status,"INCOMPLETE");assert.ok(q.missing.some(s=>s.includes("FEE")));
 const plan=provisioningPlan(q,auth(q));assert.equal(plan.status,"PLANNED_NOT_DEPLOYED");assert.equal(plan.writeAuthorizationEligible,false);
 assert.equal(plan.stages.find(s=>s.name==="mintTransistors").feesWei,null);
 assert.equal(q.economics.totalCostWei,null);assert.throws(()=>makeQuote({protocol:p,sources,sourceCommit:commit,owner:OWNER,capWei:"1",gasPriceWei:"1",now:NOW}),/cap/);
});
test("resume verifies every existing chunk and refuses duplicate boundary MIME hash and content conflicts",()=>withBundle(async(_,bundle)=>{
 const file=bundle.files.find(f=>f.path==="app.js"),rpc=new MemoryRpc();
 assert.equal((await inspectFile(rpc,CONTAINER,file,BLOCK.number)).verifiedChunks,0);
 const good={bytes:fixtureContents["app.js"].subarray(0,48000),count:2,contentType:file.contentType,sha256:file.sha256};
 rpc.files.set(file.path,good);assert.equal((await inspectFile(rpc,CONTAINER,file,BLOCK.number)).verifiedChunks,2);
 assert.equal(rpc.calls.filter(c=>c.name==="readRange").length,2);
 for(const mutate of [f=>f.count=4,f=>f.count=1,f=>f.contentType="application/octet-stream",f=>f.sha256="0".repeat(64),f=>f.bytes=Buffer.from(f.bytes).fill(98,24000,24001)]){
  const conflict={...good,bytes:Buffer.from(good.bytes)};mutate(conflict);rpc.files.set(file.path,conflict);await assert.rejects(inspectFile(rpc,CONTAINER,file,BLOCK.number));
 }
 rpc.files.set(file.path,{...good,bytes:fixtureContents["app.js"]});rpc.files.get(file.path).count=3;
 assert.equal((await inspectFile(rpc,CONTAINER,file,BLOCK.number)).verifiedChunks,3);
}));
test("RPC only reads requires independent agreement and rejects wrong chain malformed envelopes and writes",async()=>{
 let sends=0;const fetchImpl=async(url,opts)=>{sends++;const req=JSON.parse(opts.body);
  return new Response(JSON.stringify({jsonrpc:"2.0",id:req.id,result:req.method==="eth_chainId"?"0xc4":{...BLOCK,timestamp:"0x"+BLOCK.timestamp.toString(16)}}),{status:200});};
 const rpc=new ReadOnlyRpc({fetchImpl});assert.equal((await rpc.pin(NOW)).hash,BLOCK.hash);
 for(const method of ["eth_sendRawTransaction","eth_sendTransaction","personal_sign","eth_sign","wallet_sendCalls"]){const before=sends;await assert.rejects(rpc.request(method,[]),/forbidden/);assert.equal(sends,before);await assert.rejects(rpc.single(rpc.urls[0],method,[]),/forbidden/);assert.equal(sends,before);}
 const disagreement=new ReadOnlyRpc({fetchImpl:async(url,opts)=>{const req=JSON.parse(opts.body);return new Response(JSON.stringify({jsonrpc:"2.0",id:req.id,result:url.includes("drpc")?"0x7a0":"0xc4"}));}});
 await assert.rejects(disagreement.request("eth_chainId",[]),/disagreement/);
 const foreign=new ReadOnlyRpc({fetchImpl:async(url,opts)=>{const req=JSON.parse(opts.body);return new Response(JSON.stringify({jsonrpc:"2.0",id:req.id,result:"0x7a0"}));}});
 await assert.rejects(foreign.pin(),/Wrong/);
 const malformed=new ReadOnlyRpc({fetchImpl:async()=>new Response(JSON.stringify({result:"0xc4"}))});await assert.rejects(malformed.request("eth_chainId",[]),/failed/);
});

test("full pinned protocol observation accepts frozen existing CPU and rejects mutable beacon changed code and owner",async()=>{
 const rpc=new MemoryRpc();const observed=await observeProtocol(rpc,{processor:PROCESSOR,cpuIndex:"7",tokenId:"1",owner:OWNER});
 assert.deepEqual(observed,snapshot());
 const mutable=new MemoryRpc();mutable.protocol.beaconOwner=OWNER;await assert.rejects(observeProtocol(mutable),/mutable/);
 const changed=new MemoryRpc();changed.code={...codeFixture,[PINS.contracts.factory]:"0x6000"};await assert.rejects(observeProtocol(changed),/hash/);
 const foreign=new MemoryRpc();foreign.protocol.site.holder=CONTAINER;await assert.rejects(observeProtocol(foreign,{processor:PROCESSOR,cpuIndex:"7",tokenId:"1",owner:OWNER}),/ownership/);
});
test("full resume skips verified partial bytes emits only remaining append indices and rejects changed configuration or bundle",()=>withBundle(async(directory,bundle)=>{
 const q=quote(bundle),plan=publicationPlan(q,auth(q)),rpc=new MemoryRpc();
 const app=bundle.files.find(f=>f.path==="app.js");rpc.files.set("app.js",{bytes:fixtureContents["app.js"].subarray(0,48000),count:2,contentType:app.contentType,sha256:app.sha256});
 const opts={...auth(q),rpc,directory};
 const result=await resumePublication(plan,q,opts);
 const appSteps=result.steps.filter(s=>s.id.startsWith("app.js#"));assert.equal(appSteps.length,1);assert.equal(appSteps[0].expectIndex,2);
 const decoded=decodeFunctionData({abi:ABI,data:appSteps[0].data});assert.equal(decoded.functionName,"appendChunk");assert.equal(decoded.args[2],2n);
 assert.equal(decoded.args[3],"0x61");assert.equal(result.status,"RESUME_PLANNED_NOT_SENT");
 assert.equal(result.steps.filter(s=>s.functionName==="putFile").length,2);
 const changedQuote=structuredClone(q);changedQuote.protocol.fees.monthlyFeeWei="1";await assert.rejects(resumePublication(plan,changedQuote,opts),/Mutated/);
 const adminRpc=new MemoryRpc();adminRpc.protocol.admins.factory=CONTAINER;await assert.rejects(resumePublication(plan,q,{...opts,rpc:adminRpc}),/configuration changed/);
 const changedRpc=new MemoryRpc();changedRpc.protocol.fees.monthlyFeeWei="1";await assert.rejects(resumePublication(plan,q,{...opts,rpc:changedRpc}),/configuration changed/);
 const ownerRpc=new MemoryRpc();ownerRpc.protocol.site.holder=CONTAINER;await assert.rejects(resumePublication(plan,q,{...opts,rpc:ownerRpc}),/ownership/);
 const mutatedPlan=structuredClone(plan);mutatedPlan.files[0].chunks[0].sha256="0".repeat(64);await assert.rejects(resumePublication(mutatedPlan,q,opts),/Mutated/);
 await writeFile(join(directory,"index.html"),"<html>changed</html>");await assert.rejects(resumePublication(plan,q,opts),/directory hash/);
}));

test("the actual per-file 350 chunk byte limit accepts its boundary and refuses one extra byte",()=>withBundle(async(directory)=>{
 const large=Buffer.alloc(350*24000,0);await writeFile(join(directory,"large.bin"),large);
 const bundle=await scanBundle(directory);assert.equal(bundle.files.find(f=>f.path==="large.bin").chunks.length,350);
 await writeFile(join(directory,"large.bin"),Buffer.concat([large,Buffer.from([1])]));
 await assert.rejects(scanBundle(directory),/350 chunks/);
}));
