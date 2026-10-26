import assert from "node:assert/strict";
import {resolve} from "node:path";
import {encodeFunctionData} from "viem";
import {PINS,ZERO,ABI,address,uint,digest,hash,regularBytes,verifySources,gitCommit,observeProtocol} from "./protocol.mjs";
import {scanBundle} from "./bundle.mjs";

export function validateSnapshot(s,{now=Date.now()}={}){
 assert.equal(s.chainId,196,"Wrong payment chain");assert.equal(s.beacon,PINS.contracts.beacon);
 assert.equal(s.beaconOwner,ZERO,"Mutable circuit beacon");assert.equal(s.circuitImplementation,PINS.contracts.circuitImplementation);
 for(const [name,key]of [["factory","factoryImplementation"],["registry","registryImplementation"],["binding","bindingImplementation"]])assert.equal(s.implementations[name],PINS.contracts[key],"Implementation mismatch");
 assert.deepEqual(s.codeSha256,PINS.codeSha256,"Protocol bytecode mismatch");
 for(const v of Object.values(s.admins))address(v);
 assert.equal(typeof s.factorySealed,"boolean");assert.match(s.block.number,/^0x[0-9a-f]+$/i);
 assert.match(s.block.hash,/^0x[0-9a-f]{64}$/i);assert.notEqual(s.block.hash,"0x"+"0".repeat(64));
 assert.ok(Number.isSafeInteger(s.block.timestamp)&&Math.abs(now/1000-s.block.timestamp)<=300,"Stale protocol observation");
 uint(s.fees.deployFeeWei);uint(s.fees.monthlyFeeWei);
 if(s.fees.openerFeeWei!==null)uint(s.fees.openerFeeWei);
 if(s.site){const site=s.site;address(site.processor);address(site.holder);address(site.container);uint(site.tokenId);uint(site.cpuIndex);
  assert.match(site.processorCodeSha256,/^[a-f0-9]{64}$/);assert.equal(site.netlistSha256,PINS.artifacts["circuits/artifacts/policy.netlist.bin"]);
  assert.equal(site.name,site.tokenId+".2."+site.cpuIndex+".tape");assert.equal(typeof site.opened,"boolean");}
 return s;
}
export function quoteHash(q){const {quoteHash:ignored,...body}=q;return digest(body);}
export function validateQuote(q,{expectedHash,capWei,now=Date.now()}={}){
 assert.equal(q.version,1);assert.equal(q.kind,"intentguard-xlayer-hosting-quote");assert.equal(q.currency,"OKB");
 assert.equal(q.quoteHash,quoteHash(q),"Mutated quote");
 assert.equal(q.quoteHash,expectedHash,"Exact quote hash required");assert.equal(q.spendingCapWei,String(capWei),"Exact quote cap required");
 uint(capWei);assert.ok(Number.isSafeInteger(q.createdAt)&&Number.isSafeInteger(q.expiresAt)&&q.expiresAt>q.createdAt&&q.expiresAt-q.createdAt<=300000);
 assert.ok(now>=q.createdAt&&now<q.expiresAt,"Expired or future quote");
 assert.equal(q.pinsSha256,digest(PINS),"Source pins changed");validateSnapshot(q.protocol,{now});
 assert.equal(q.writeAuthorizationEligible,false,"This planner cannot authorize a write");
 return q;
}
export function makeQuote({protocol,sources,bundle=null,sourceCommit,owner,capWei,gasPriceWei,months=1,now=Date.now()}){
 validateSnapshot(protocol,{now});assert.equal(sources.pinsSha256,digest(PINS));assert.match(sourceCommit,/^[0-9a-f]{40}$/);
 owner=address(owner);capWei=uint(capWei,"spending cap").toString();gasPriceWei=uint(gasPriceWei,"gas price").toString();
 assert.ok(Number.isInteger(months)&&months>=1&&months<=120,"Months must be 1–120");
 if(protocol.site)assert.equal(protocol.site.holder,owner,"Owner mismatch");
 if(bundle)assert.equal(bundle.directorySha256,digest((({directorySha256:ignored,...rest})=>rest)(bundle)),"Bundle digest mismatch");
 const missing=[];if(protocol.fees.openerFeeWei===null)missing.push("opener FEE() is unknown");
 const creation=bundle?0n:uint(protocol.fees.deployFeeWei);
 const opening=protocol.site?.opened?0n:(protocol.fees.openerFeeWei===null?0n:uint(protocol.fees.openerFeeWei));
 const activation=bundle?uint(protocol.fees.monthlyFeeWei)*BigInt(months):0n;
 // Bytecode deployment alone costs 200 gas per byte. This is an economic
 // lower bound, never a complete gas quote or an executable spending estimate.
 const storageGasLowerBound=bundle?BigInt(bundle.totalBytes+bundle.totalChunks)*200n:0n;
 const knownFeesWei=creation+opening+activation;
 const costLowerBoundWei=knownFeesWei+storageGasLowerBound*BigInt(gasPriceWei);
 assert.ok(costLowerBoundWei<=BigInt(capWei),"Known cost lower bound exceeds cap");
 const risks=["Storage gas is a lower bound; overhead, dependent calls, L1 data and future gas prices are unquoted.",
  "The API and Actions worker are offchain. TapeKit visitors must allow the API origin.",
  "Source address pins and RPC bytecode measurements are not a third-party source audit."];
 if(!protocol.factorySealed)risks.push("Factory is unsealed and its owner can change registration or upgrade configuration. Frozen processor beacon does not freeze the factory.");
 if(protocol.admins.registry!==ZERO||protocol.admins.binding!==ZERO)risks.push("Site registry and activation implementations/fees remain administratively mutable; recheck before every future write.");
 const q={version:1,kind:"intentguard-xlayer-hosting-quote",currency:"OKB",createdAt:now,expiresAt:now+300000,sourceCommit,
  pinsSha256:digest(PINS),sources,owner,spendingCapWei:capWei,protocol,bundle,months,
  economics:{gasPriceWei,deployFeeWei:protocol.fees.deployFeeWei,openerFeeWei:protocol.fees.openerFeeWei,monthlyFeeWei:protocol.fees.monthlyFeeWei,activationWei:activation.toString(),knownFeesWei:knownFeesWei.toString(),storageGasLowerBound:storageGasLowerBound.toString(),costLowerBoundWei:costLowerBoundWei.toString(),totalCostWei:null},
  status:missing.length?"INCOMPLETE":"READ_ONLY_QUOTE",missing,risks,writeAuthorizationEligible:false};
 return {...q,quoteHash:quoteHash(q)};
}
export function publicationPlan(q,{expectedHash,capWei,now=Date.now()}){
 validateQuote(q,{expectedHash,capWei,now});assert.ok(q.bundle&&q.protocol.site,"Publication needs a static artifact and a verified existing circuit");
 assert.equal(q.protocol.site.opened,true,"Container opening must be completed and verified separately");
 const plan={version:1,kind:"intentguard-deweb-publication-plan",quoteHash:q.quoteHash,capWei:String(capWei),sourceCommit:q.sourceCommit,pinsSha256:q.pinsSha256,
  owner:q.owner,chainId:196,registry:PINS.contracts.registry,binding:PINS.contracts.binding,site:q.protocol.site,
  directorySha256:q.bundle.directorySha256,files:q.bundle.files,fallback:q.bundle.fallback,months:q.months,apiOrigins:q.bundle.apiOrigins,
  status:"PLANNED_NOT_PUBLISHED",writeAuthorizationEligible:false,transactions:[],journalRequirement:"No sender is implemented. A future executor must fsync an owner-private intent journal before signing/sending and reconcile receipts before replay."};
 return {...plan,planHash:digest(plan)};
}
export function provisioningPlan(q,{expectedHash,capWei,now=Date.now()}){
 validateQuote(q,{expectedHash,capWei,now});assert.ok(!q.bundle,"Provisioning quote must not contain a frontend artifact");
 return {version:1,kind:"intentguard-tapeout-provisioning-plan",status:"PLANNED_NOT_DEPLOYED",quoteHash:q.quoteHash,capWei:String(capWei),sourceCommit:q.sourceCommit,
  chainId:196,factory:PINS.contracts.factory,beacon:PINS.contracts.beacon,circuitImplementation:PINS.contracts.circuitImplementation,artifacts:q.sources.artifacts,
  stages:[
   {name:"createCPU",function:"createCPU(string,string,string,uint256,uint256)",parameters:["IntentGuard","IGUARD","Deterministic agent spending permissions","10000","0"],valueWei:q.protocol.fees.deployFeeWei},
   {name:"verifyCPU",requirements:["CPUCreated receipt, factory registration and processor number","Frozen beacon slot and owner","Exact transistor contract code/implementation and fee ABI provenance"]},
   {name:"mintTransistors",status:"BLOCKED_UNTIL_CPU",gateCount:q.sources.gateCount,feesWei:null},
   {name:"tapeout",status:"BLOCKED_UNTIL_CPU",inputBits:451,outputBits:8,netlistSha256:q.sources.netlistSha256,feesWei:null},
   {name:"openContainer",status:"BLOCKED_UNTIL_CIRCUIT",openerFeeWei:q.protocol.fees.openerFeeWei,requirements:["Pinned opener call ABI/source, owner and circuit identity","Exact gas quote and explicit paid authorization"]},
   {name:"verifyCircuit",requirements:["Exact circuitInfo and netlist SHA256","Independently reproduced live evaluation vectors"]}
  ],missing:["New CPU transistor and tapeout fees and dependent gas estimates cannot be measured before the processor exists.","Opening transaction ABI/source must be reviewed before constructing a payable call."],writeAuthorizationEligible:false};
}
function configDigest(s){const {block:ignored,...config}=s;return digest(config);}
export async function recheckPlan(plan,q,{rpc,directory,expectedHash,capWei,now=Date.now(),sourceRoot}){
 validateQuote(q,{expectedHash,capWei,now});
 const {planHash,...body}=plan;assert.equal(planHash,digest(body),"Mutated publication plan");
 assert.deepEqual(publicationPlan(q,{expectedHash,capWei,now}),plan,"Plan does not match quote");
 const sources=await verifySources(sourceRoot?{root:sourceRoot}:{});assert.deepEqual(sources,q.sources,"Source artifact drift");
 assert.equal(gitCommit(sourceRoot),q.sourceCommit,"Source commit drift");
 const bundle=await scanBundle(directory,{fallback:plan.fallback,apiOrigins:plan.apiOrigins});assert.deepEqual(bundle,q.bundle,"Static directory hash mismatch");
 const s=plan.site;const current=await observeProtocol(rpc,{processor:s.processor,tokenId:s.tokenId,owner:plan.owner,cpuIndex:s.cpuIndex});
 assert.equal(configDigest(current),configDigest(q.protocol),"Current network, ownership, implementation or fee configuration changed");
 return current;
}
export async function inspectFile(rpc,container,file,block){
 const info=await rpc.call(PINS.contracts.registry,"fileInfo",[container,file.path],block);
 const [size,contentType,sha256Hash,updatedAt,count]=info;
 const n=Number(count);assert.ok(Number.isSafeInteger(n)&&n>=0&&n<=file.chunks.length,"Duplicate or excess existing chunk");
 if(n===0){assert.equal(Number(size),0,"Malformed absent file");return {path:file.path,verifiedChunks:0,updatedAt:String(updatedAt)};}
 assert.equal(contentType,file.contentType,"Existing file MIME mismatch");
 assert.equal(sha256Hash.toLowerCase(),"0x"+file.sha256,"Existing file hash differs; overwrite is forbidden");
 const expectedSize=file.chunks.slice(0,n).reduce((sum,c)=>sum+c.size,0);
 assert.equal(Number(size),expectedSize,"Existing chunk boundaries or length mismatch");
 for(let i=0;i<n;i++){
  const chunk=file.chunks[i];const data=await rpc.call(PINS.contracts.registry,"readRange",[container,file.path,BigInt(chunk.offset),BigInt(chunk.size)],block);
  assert.match(data,/^0x(?:[a-f0-9]{2})*$/i);const bytes=Buffer.from(data.slice(2),"hex");
  assert.equal(bytes.length,chunk.size,"Existing chunk length mismatch");assert.equal(hash(bytes),chunk.sha256,"Existing chunk content mismatch");
 }
 return {path:file.path,verifiedChunks:n,updatedAt:String(updatedAt)};
}
export async function resumePublication(plan,q,options){
 const current=await recheckPlan(plan,q,options);const {rpc,directory}=options;const steps=[],verified=[];
 for(const file of plan.files){
  const progress=await inspectFile(rpc,plan.site.container,file,current.block.number);verified.push(progress);
  const bytes=await regularBytes(resolve(directory,file.path));assert.equal(hash(bytes),file.sha256,"Static file changed during resume");
  for(let i=progress.verifiedChunks;i<file.chunks.length;i++){
   const chunk=file.chunks[i],data="0x"+bytes.subarray(chunk.offset,chunk.offset+chunk.size).toString("hex");
   assert.equal(hash(Buffer.from(data.slice(2),"hex")),chunk.sha256,"Local chunk mismatch");
   const functionName=i===0?"putFile":"appendChunk";
   const args=i===0?[plan.site.container,file.path,file.contentType,"0x"+file.sha256,data]:[plan.site.container,file.path,BigInt(i),data];
   steps.push({id:file.path+"#"+i,to:plan.registry,functionName,expectIndex:i,valueWei:"0",fileSha256:file.sha256,chunkSha256:chunk.sha256,
    data:encodeFunctionData({abi:ABI,functionName,args}),preconditions:["Recheck exact quote hash/cap, expiry, sources, network, owner, implementations and fees","Re-read fileInfo and verify every existing chunk at a new agreed block","Write and fsync intent journal before any future signature or send"]});
  }
 }
 const fallback=await rpc.call(plan.registry,"fallbackPath",[plan.site.container],current.block.number);
 if(fallback!==plan.fallback)steps.push({id:"fallback",to:plan.registry,functionName:"setFallback",valueWei:"0",data:encodeFunctionData({abi:ABI,functionName:"setFallback",args:[plan.site.container,plan.fallback]})});
 // Activation is intentionally separate: browser preview acceptance must pass
 // before a non-refundable bind. No activated/hosted claim follows a plan.
 const end=await rpc.request("eth_getBlockByNumber",[current.block.number,false]);assert.equal(end.hash.toLowerCase(),current.block.hash,"Resume snapshot reorged");
 return {version:1,status:"RESUME_PLANNED_NOT_SENT",planHash:plan.planHash,quoteHash:q.quoteHash,capWei:String(options.capWei),block:current.block,verifiedFiles:verified,steps,
  activation:{name:plan.site.name,months:plan.months,valueWei:q.economics.activationWei,status:"AFTER_BROWSER_ACCEPTANCE"},writeAuthorizationEligible:false};
}
