import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {resolve,isAbsolute,relative} from "node:path";
import {pathToFileURL} from "node:url";
import {parseAbi,toHex} from "viem";
import {parseStrictJson} from "../../packages/shared/strict-json.ts";
import {sourceToken,profileRoutes} from "../../packages/shared/payment-profiles.ts";
import {ROOT,PINS,ABI,address,uint,hash,regularBytes,observeProtocol,verifySources} from "../hosting/protocol.mjs";
import {scanBundle,gatewayResolve} from "../hosting/bundle.mjs";
import {inspectFile} from "../hosting/planner.mjs";
import {captureSource,validateSource} from "./release-plan.mjs";
import {DeploymentRpc,validateQuote,validateJournalPrincipals,verifyReceipt} from "./mainnet-deploy.mjs";
import {packInputs,fields,MAX_U64} from "../../circuits/policy.mjs";
import {validateRelease,verifyAcceptance,verifyPublishedPayment,verifyPublishedReview,officialReviewClient,publicRpc} from "../../scripts/acceptance-report.mjs";
import {boundedRead,httpsOrigin,publicIdentity,tapeKitIdentity,assertGatewayObservation,assertContentType} from "./availability.mjs";
import {observeBrowser,observeGatewayFiles} from "../../scripts/availability-browser.mjs";

const CPU_ABI=parseAbi(["function eval(uint256 circuitId,bytes inputs) view returns(bytes outputs)"]);
const txHash=value=>{assert.match(value??"",/^0x[a-f0-9]{64}$/i);return value.toLowerCase();};
const sha=value=>{assert.match(value??"",/^[a-f0-9]{64}$/);return value;};
const same=(a,b,message)=>assert.deepEqual(a,b,message);
const object=value=>assert.ok(value&&typeof value==="object"&&!Array.isArray(value),"An evidence object is required");
const nonzero=value=>{const normalized=address(value);assert.notEqual(normalized,"0x"+"0".repeat(40));return normalized;};
function evidencePath(path,root=ROOT){
 assert.ok(typeof path==="string"&&path.length>0&&!isAbsolute(path),"Evidence paths must be relative to the checkout");
 const full=resolve(root,path),rel=relative(root,full);assert.ok(rel&&!rel.startsWith("..")&&!isAbsolute(rel),"Evidence must be inside the checkout");return full;
}
async function evidenceBytes(path,{root=ROOT,read=regularBytes}={}){
 const bytes=await read(evidencePath(path,root));assert.ok(bytes.length<=32*1024*1024,"Evidence exceeds its bound");return bytes;
}
function reference(value){object(value);same(Object.keys(value).sort(),["path","sha256"]);evidencePath(value.path);sha(value.sha256);}

export function validateLiveManifest(manifest){
 object(manifest);const allowed=["version","scope","sourceCommit","sourceTreeSha256","releaseId","journal","cpu","releases","acceptance","canaries","hosting"];
 assert.ok(Object.keys(manifest).every(key=>allowed.includes(key)),"Unexpected live-manifest field");
 assert.equal(manifest.version,1);assert.equal(manifest.scope,"intentguard-dual-release-live-evidence");
 assert.match(manifest.sourceCommit??"",/^[a-f0-9]{40}$/);sha(manifest.sourceTreeSha256);sha(manifest.releaseId);
 reference(manifest.journal);object(manifest.cpu);same(Object.keys(manifest.cpu).sort(),["circuitId","cpuIndex","owner","processor"]);
 nonzero(manifest.cpu.processor);nonzero(manifest.cpu.owner);for(const key of ["cpuIndex","circuitId"]){assert.equal(typeof manifest.cpu[key],"string","Registry IDs must be exact decimal strings");assert.ok(uint(manifest.cpu[key])<(1n<<256n));}
 return manifest;
}
export async function pinnedBytes(reference,{root=ROOT,read=regularBytes}={}){
 assert.ok(reference&&typeof reference==="object");same(Object.keys(reference).sort(),["path","sha256"]);
 const bytes=await evidenceBytes(reference.path,{root,read});assert.equal(hash(bytes),sha(reference.sha256),"Pinned evidence bytes changed");return bytes;
}
const pinnedJson=async(reference,options)=>parseStrictJson((await pinnedBytes(reference,options)).toString("utf8"));

export async function verifyJournalStages(manifest,required,{rpc=new DeploymentRpc(),load=pinnedJson,receiptVerify=verifyReceipt,source}={}){
 validateLiveManifest(manifest);const journal=await load(manifest.journal);
 assert.equal(journal.version,1);assert.equal(journal.kind,"private-mainnet-deployment-journal");assert.equal(journal.releaseId,manifest.releaseId);
 object(journal.entries);validateJournalPrincipals(journal,{});const results={};assert.equal(new Set(required).size,required.length,"Duplicate stage requirement");
 for(const key of required){
  const row=journal.entries?.[key];assert.ok(row?.raw&&row.status==="VERIFIED","Actual verified stage missing: "+key);
  validateQuote(row.quote,{source,current:false});assert.equal(row.quote.stageKey,key);
  assert.equal(row.quote.sourceCommit,manifest.sourceCommit);assert.equal(row.quote.sourceTreeSha256,manifest.sourceTreeSha256);assert.equal(row.quote.releaseId,manifest.releaseId);assert.equal(row.quote.chainId,196);sha(row.approvalSha256);
  const result=await receiptVerify(rpc,row.quote,row.raw);assert.equal(result.status,"VERIFIED","Current independent receipt verification failed: "+key);
  assert.equal(txHash(result.transactionHash),txHash(row.transactionHash));same(result,row.result,"Journal receipt or output changed: "+key);
  results[key]=result;
 }
 return {journal,results};
}

// Native bigint predicates are independent of the NAND interpreter. These
// inputs cover every failure bitmap, time/amount boundaries and full-width data.
export function cpuVectors(){
 const base={amount:10n,perPaymentLimit:10n,remainingTotal:100n,remainingPeriod:20n,validFrom:100n,now:100n,validUntil:200n,recipientAllowed:true,assetAllowed:true,enabled:true},vectors=[];
 for(let mask=0;mask<128;mask++)vectors.push({...base,perPaymentLimit:mask&1?9n:10n,remainingTotal:mask&2?9n:100n,remainingPeriod:mask&4?9n:20n,now:mask&8?200n:100n,recipientAllowed:!(mask&16),assetAllowed:!(mask&32),enabled:!(mask&64)});
 for(const field of fields)for(const value of [0n,1n,(1n<<53n)-1n,1n<<53n,MAX_U64-1n,MAX_U64])vectors.push({...base,[field]:value});
 for(let bit=0n;bit<64n;bit++){const value=1n<<bit;vectors.push({...base,amount:value,perPaymentLimit:value-1n,remainingTotal:MAX_U64,remainingPeriod:MAX_U64});}
 let seed=0x724cab81e237aa93n;const random=()=>{seed^=seed<<13n;seed^=seed>>7n;seed^=seed<<17n;seed&=MAX_U64;return seed;};
 for(let i=0;i<256;i++)vectors.push({...Object.fromEntries(fields.map(field=>[field,random()])),recipientAllowed:!!(random()&1n),assetAllowed:!!(random()&1n),enabled:!!(random()&1n)});
 return vectors;
}
export function independentOutput(input){
 const failed=[input.amount>input.perPaymentLimit,input.amount>input.remainingTotal,input.amount>input.remainingPeriod,!(input.validFrom<=input.now&&input.now<input.validUntil),!input.recipientAllowed,!input.assetAllowed,!input.enabled];
 return failed.some(Boolean)?failed.reduce((mask,flag,index)=>mask|(flag?1<<(index+1):0),0):1;
}
export async function verifyLiveCpu(manifest,{rpc=new DeploymentRpc(),load=pinnedJson,receiptVerify=verifyReceipt,source,protocolRead=observeProtocol}={}){
 const {results}=await verifyJournalStages(manifest,["createCPU","tapeout"],{rpc,load,receiptVerify,source}),created=results.createCPU.output,circuit=results.tapeout.output,cpu=manifest.cpu;
 assert.equal(created.processor,address(cpu.processor));assert.equal(circuit.processor,created.processor);assert.equal(circuit.cpuIndex,created.cpuIndex);assert.equal(circuit.circuitId,String(cpu.circuitId));assert.equal(circuit.cpuIndex,String(cpu.cpuIndex));
 assert.equal(circuit.netlistSha256,PINS.artifacts["circuits/artifacts/policy.netlist.bin"]);
 const protocol=await protocolRead(rpc,{processor:created.processor,cpuIndex:created.cpuIndex,tokenId:circuit.circuitId,owner:cpu.owner});
 assert.equal(protocol.chainId,196);assert.equal(protocol.site.processorCodeSha256,created.processorRuntimeSha256);assert.equal(protocol.site.netlistSha256,circuit.netlistSha256);
 const transistors=address(await rpc.call(created.processor,"transistors",[],protocol.block.number));assert.equal(transistors,created.transistors);
 const code=await rpc.request("eth_getCode",[transistors,protocol.block.number]);assert.equal(hash(Buffer.from(code.slice(2),"hex")),created.transistorRuntimeSha256);
 const vectors=cpuVectors();assert.equal(vectors.length,490,"The predeclared live vector suite changed");const observed=[];
 for(let offset=0;offset<vectors.length;offset+=4){
  const batch=await Promise.all(vectors.slice(offset,offset+4).map(async(input,index)=>{
   const inputs=toHex(packInputs(input)),output=await rpc.call(created.processor,"eval",[uint(circuit.circuitId),inputs],protocol.block.number,CPU_ABI),expected="0x"+independentOutput(input).toString(16).padStart(2,"0");
   assert.equal(output.toLowerCase(),expected,"Official CPU numerical vector failed at "+(offset+index));return {inputSha256:hash(Buffer.from(inputs.slice(2),"hex")),output:expected};
  }));observed.push(...batch);
 }
 const block=await rpc.request("eth_getBlockByNumber",[protocol.block.number,false]);assert.equal(block.hash,protocol.block.hash,"Live vector block reorged");
 return {scope:"official X Layer196 registry, current code/netlist and independently evaluated vectors",processor:created.processor,circuitId:circuit.circuitId,cpuIndex:circuit.cpuIndex,owner:address(cpu.owner),registrationTransaction:results.createCPU.transactionHash,tapeoutTransaction:results.tapeout.transactionHash,block:protocol.block,netlistSha256:circuit.netlistSha256,liveVectors:observed.length,vectorResultsSha256:hash(JSON.stringify(observed)),providers:rpc.urls,trust:"The processor beacon is frozen; factory, site registry and subscription administrators remain mutable."};
}

function releases(manifest){
 assert.ok(Array.isArray(manifest.releases));same(manifest.releases.map(release=>release.paymentEnvironment).sort(),["mainnet","testnet"]);
 const origins=new Set();for(const release of manifest.releases){validateRelease(release);assert.equal(release.sourceCommit,manifest.sourceCommit,"Both final deployments must serve the verified release");httpsOrigin(release.applicationOrigin);assert.ok(!origins.has(release.applicationOrigin),"The payment APIs must be isolated");origins.add(release.applicationOrigin);assert.ok(Array.isArray(release.frontendOrigins)&&release.frontendOrigins.length>0&&release.frontendOrigins.length<=3);assert.equal(new Set(release.frontendOrigins).size,release.frontendOrigins.length);release.frontendOrigins.forEach(httpsOrigin);assert.equal(new Set(release.allowedTokens.map(address)).size,release.allowedTokens.length);}
 const mainnet=manifest.releases.find(release=>release.paymentEnvironment==="mainnet");assert.equal(mainnet.releaseId,manifest.releaseId);same(mainnet.allowedTokens.map(address).sort(),[sourceToken("mainnet","USDC"),sourceToken("mainnet","USDT0")].sort());assert.equal(address(mainnet.processor),address(manifest.cpu.processor));assert.equal(String(mainnet.circuitId),manifest.cpu.circuitId);return {mainnet,testnet:manifest.releases.find(release=>release.paymentEnvironment==="testnet")};
}
async function publicJson(origin,path,token){
 const read=await boundedRead(origin+"/api/v1"+path,{maximumBytes:4*1024*1024,fetchImpl:(url,options)=>fetch(url,{...options,headers:{...options.headers,...(token?{Authorization:"Bearer "+token}:{})}})});
 if(token)assert.ok(!read.bytes.includes(Buffer.from(token)),"Credentials cannot appear in public evidence");assert.match(read.contentType,/application\/json/i);return parseStrictJson(read.bytes.toString("utf8"));
}
export async function verifyRuntime(release,{json=publicJson,factories}={}){
 validateRelease(release);httpsOrigin(release.applicationOrigin);
 const target={...release,frontendOrigins:release.frontendOrigins??[release.applicationOrigin]},health=await json(release.applicationOrigin,"/health"),config=await json(release.applicationOrigin,"/config");
 publicIdentity(health,target,"health");publicIdentity(config,target,"config");
 if(release.paymentEnvironment==="mainnet"){
  const assets=config.assets.filter(asset=>asset.available===true);same(assets.map(asset=>asset.symbol).sort(),["USDC","USDT0"]);assert.equal(config.settlementVersion,2);
  for(const asset of assets){assert.equal(address(asset.token),sourceToken("mainnet",asset.symbol));assert.equal(asset.chainId,196);assert.equal(asset.decimals,6);}
  same(config.spendingNetworks.map(route=>route.chainId).sort((a,b)=>a-b),Object.keys(profileRoutes("mainnet")).map(Number).sort((a,b)=>a-b));
  assert.equal(config.guard.processor,address(release.processor));assert.equal(String(config.guard.circuitId),String(release.circuitId));
  assert.equal(address(config.guard.beacon),PINS.contracts.beacon);assert.equal(address(config.guard.expectedImplementation),PINS.contracts.circuitImplementation);assert.equal(config.guard.expectedNetlistHash,"0x"+PINS.artifacts["circuits/artifacts/policy.netlist.bin"]);
  if(factories){assert.equal(address(config.cctpFactoryAddress),factories.deployUSDCFactory.output.address);assert.equal(address(config.factoryAddress),factories.deployUSDT0Factory.output.address);}
 }
 return {paymentEnvironment:release.paymentEnvironment,sourceCommit:release.sourceCommit,releaseId:release.releaseId,healthSha256:hash(JSON.stringify(health)),configSha256:hash(JSON.stringify(config)),reviewInfrastructure:"GenLayer Studionet testnet"};
}
export async function verifyCanaries(manifest,{load=pinnedJson,json=publicJson,paymentVerify=verifyPublishedPayment,reviewVerify=verifyPublishedReview,reviewClient=officialReviewClient(),rpc=new DeploymentRpc(),source,receiptVerify=verifyReceipt,factories}={}){
 const {mainnet}=releases(manifest),routes=Object.values(profileRoutes("mainnet")),expected=["USDT0:196",...routes.map(route=>"USDC:"+route.chainId)].sort();
 assert.ok(Array.isArray(manifest.canaries));same(manifest.canaries.map(canary=>canary.asset+":"+canary.destinationChainId).sort(),expected,"Local USDC/USDT0 plus all ten CCTP deliveries are required");assert.equal(new Set(manifest.canaries.map(canary=>canary.requestId)).size,expected.length);
 for(const canary of manifest.canaries){same(Object.keys(canary).sort(),["asset","destinationChainId","input","requestId","vaultStageKey"]);reference(canary.input);txHash(canary.requestId);assert.match(canary.vaultStageKey??"",/^createCanaryVault:[a-zA-Z0-9_-]{1,64}$/);}
 const required=[...new Set(manifest.canaries.map(canary=>canary.vaultStageKey))],stages=await verifyJournalStages(manifest,required,{rpc,load,receiptVerify,source});
 factories??=(await verifyJournalStages(manifest,["deployUSDCFactory","deployUSDT0Factory"],{rpc,load,receiptVerify,source})).results;
 const results=[];for(const canary of manifest.canaries){
  const input=await load(canary.input),live=await json(mainnet.applicationOrigin,"/explorer/transactions/"+txHash(canary.requestId)),tx=live.transaction;
  const vault=stages.results[canary.vaultStageKey].output,operation=stages.journal.entries[canary.vaultStageKey].quote.operation,factory=factories[canary.asset==="USDC"?"deployUSDCFactory":"deployUSDT0Factory"].output.address;
  assert.equal(operation.factory,factory,"Canary vault used a different factory");assert.equal(operation.cardConfig.processor,address(manifest.cpu.processor));assert.equal(operation.cardConfig.circuitId,manifest.cpu.circuitId);assert.equal(vault.asset,canary.asset);assert.ok(vault.destinations.includes(canary.destinationChainId));assert.equal(address(live.agent?.address),vault.address);assert.equal(live.agent?.policyHash,vault.policyHash);
  assert.equal(tx?.id,canary.requestId);assert.equal(tx.paymentEnvironment,"mainnet");assert.equal(tx.chainId,196);assert.equal(tx.status,"PAID");assert.equal(tx.destinationChainId,canary.destinationChainId);assert.equal(address(tx.token),sourceToken("mainnet",canary.asset));assert.ok(tx.createdAt>=Date.parse(mainnet.deployedAt),"Historical payments do not qualify as new canaries");assert.equal(Boolean(tx.bridge),canary.destinationChainId!==196);
  const review=await reviewVerify(live,input,mainnet,{reviewClient}),payment=await paymentVerify(live,mainnet,{rpc:id=>publicRpc(id,"mainnet"),proofRead:id=>json(mainnet.applicationOrigin,"/explorer/transactions/"+txHash(id)+"/proof")});results.push({asset:canary.asset,destinationChainId:canary.destinationChainId,requestId:tx.id,review,payment});
 }
 return results;
}
export async function verifyLiveAcceptance(manifest,{load=pinnedJson,json=publicJson,rpc=new DeploymentRpc(),source,receiptVerify=verifyReceipt,acceptanceVerify=verifyAcceptance,canaryVerify=verifyCanaries}={}){
 const release=releases(manifest);assert.equal(release.mainnet.processor,address(manifest.cpu.processor));assert.equal(String(release.mainnet.circuitId),String(manifest.cpu.circuitId));
 const factories=await verifyJournalStages(manifest,["deployUSDCFactory","deployUSDT0Factory"],{rpc,load,receiptVerify,source}),runtime=[];
 for(const deployment of manifest.releases)runtime.push(await verifyRuntime(deployment,{json,factories:factories.results}));
 reference(manifest.acceptance);const acceptance=await load(manifest.acceptance),identity=r=>[r.paymentEnvironment,r.chainId,r.sourceCommit,r.releaseId,r.applicationOrigin,r.deployedAt,r.allowedTokens.map(address).sort()];same(acceptance.releases.map(identity).sort(),manifest.releases.map(identity).sort(),"Acceptance reports belong to different releases");
 const result=await acceptanceVerify(acceptance,{load:evidenceBytes,readTransaction:(r,id)=>json(r.applicationOrigin,"/explorer/transactions/"+txHash(id)),readRequest:(r,id)=>{const key=process.env["INTENTGUARD_"+r.paymentEnvironment.toUpperCase()+"_AUDIT_AGENT_KEY"];assert.ok(key?.startsWith("ig_"),"A separately scoped audit key is required to refetch saved inputs");return json(r.applicationOrigin,"/requests/"+txHash(id),key);},proofRead:(r,id)=>json(r.applicationOrigin,"/explorer/transactions/"+txHash(id)+"/proof")});
 const canaries=await canaryVerify(manifest,{load,json,rpc,source,receiptVerify,factories:factories.results});return {scope:"fresh live semantic, operational, bridge and both native-asset acceptance",runtime,factories:Object.fromEntries(Object.entries(factories.results).map(([key,value])=>[key,{address:value.output.address,transactionHash:value.transactionHash}])),acceptance:result,canaries};
}

export async function verifyRegistryBundle(rpc,container,bundle,at){
 const pathsAbi=parseAbi(["function pathCount(address) view returns(uint256)","function pathsRange(address,uint256,uint256) view returns(string[])"]),count=await rpc.call(PINS.contracts.registry,"pathCount",[container],at,pathsAbi);assert.equal(count,BigInt(bundle.files.length),"Unexpected files in the onchain container");const paths=[];
 for(let from=0;from<bundle.files.length;from+=200){const length=Math.min(200,bundle.files.length-from),page=await rpc.call(PINS.contracts.registry,"pathsRange",[container,BigInt(from),BigInt(length)],at,pathsAbi);assert.equal(page.length,length);paths.push(...page);}
 same(paths.sort(),bundle.files.map(file=>file.path).sort(),"Onchain path enumeration differs from the final artifact");
 const files=[];for(const file of bundle.files){const current=await inspectFile(rpc,container,file,at);assert.equal(current.verifiedChunks,file.chunks.length,"The onchain file is incomplete: "+file.path);files.push({path:file.path,sha256:file.sha256,size:file.size});}
 assert.equal(await rpc.call(PINS.contracts.registry,"fallbackPath",[container],at),bundle.fallback);return files;
}
export async function observeHostedBytes(hosting,bundle,{gatewayRead=observeGatewayFiles,fetchBytes=boundedRead}={}){
 httpsOrigin(hosting.gatewayOrigin);httpsOrigin(hosting.fallbackOrigin);assert.ok(tapeKitIdentity(hosting.gatewayOrigin));assert.notEqual(hosting.gatewayOrigin,hosting.fallbackOrigin);
 const routes=["/","/agent-setup","/agents","/docs","/transaction?id=0x"+"1".repeat(64),"/why-we-exist"].map(path=>{
  const resolved=gatewayResolve(path,new Set(bundle.files.map(file=>file.path)),bundle.fallback),file=bundle.files.find(file=>file.path===resolved);assert.ok(file,"The static route is missing: "+path);return {...file,path};
 });
 const requested=[...bundle.files,...routes],gateway=await gatewayRead(hosting.gatewayOrigin,requested);assert.equal(gateway.length,requested.length);for(let index=0;index<requested.length;index++){assertGatewayObservation(gateway[index],hosting.gatewayOrigin,requested[index]);assert.equal(gateway[index].size,requested[index].size);assertContentType(gateway[index].contentType,requested[index].contentType);}
 const observations=[];for(const file of bundle.files){
  const fallback=await fetchBytes(hosting.fallbackOrigin+"/"+file.path,{maximumBytes:32*1024*1024});assert.equal(hash(fallback.bytes),file.sha256,"Fallback serves a different artifact");assertContentType(fallback.contentType,file.contentType);observations.push({path:file.path,sha256:file.sha256,size:file.size});
 }
 return {files:observations.length,bytes:bundle.totalBytes,filesSha256:hash(JSON.stringify(observations)),browserVersion:gateway[0].gateway.browserVersion,chainVerifiedGateway:true,sameArtifactFallback:true};
}
export function verifyFrontendSource(frontend,source){
 validateSource(source,{final:true});assert.equal(frontend.sourceCommit,source.commit);assert.equal(frontend.sourceDirty,false);
 const explicit=["apps/web/lib/agent-card-art.ts","apps/web/next.config.ts","apps/web/tsconfig.json","apps/web/package.json","contracts/evm/abi.json","tsconfig.json","package.json","pnpm-lock.yaml","pnpm-workspace.yaml","scripts/static-frontend.mjs","tools/hosting/bundle.mjs","tools/hosting/protocol.mjs","tools/hosting/pins.json"];
 const paths=Object.keys(source.inputs).filter(path=>explicit.includes(path)||path.startsWith("apps/web/components/")||path.startsWith("apps/web/public/")||path.startsWith("packages/shared/")||path.startsWith("apps/web/app/")&&!path.startsWith("apps/web/app/api/")&&!path.startsWith("apps/web/app/explorer/transactions/"));
 assert.ok(paths.includes("apps/web/components/agent-setup.tsx")&&paths.includes("apps/web/components/setup-form.ts"),"The current onboarding source is missing");
 same(frontend.sourceInputs,Object.fromEntries(paths.map(path=>[path,source.inputs[path].sha256])),"Frontend source inputs differ from the current exact source");assert.equal(frontend.sourceTreeSha256,hash(JSON.stringify(frontend.sourceInputs)),"Frontend source digest changed");
 return true;
}
export async function verifyLiveHosting(manifest,{load=pinnedJson,rpc=new DeploymentRpc(),source,receiptVerify=verifyReceipt,bundleRead=scanBundle,protocolRead=observeProtocol,hostedBytes=observeHostedBytes,json=publicJson,browserObserve=observeBrowser,evidenceRead=pinnedBytes,now=Date.now()}={}){
 const {mainnet}=releases(manifest),hosting=manifest.hosting;assert.ok(hosting);const frontend=await load(hosting.frontendManifest);assert.equal(frontend.version,1);assert.equal(frontend.sourceDirty,false);assert.equal(frontend.sourceCommit,manifest.sourceCommit);assert.equal(frontend.paymentEnvironment,"mainnet");assert.equal(frontend.serverRoutesIncluded,false);assert.equal(frontend.apiOrigin,mainnet.applicationOrigin);
 same(Object.keys(hosting).sort(),["browserReview","fallbackOrigin","frontendDirectory","frontendManifest","gatewayOrigin"]);reference(hosting.frontendManifest);reference(hosting.browserReview);verifyFrontendSource(frontend,source);evidencePath(hosting.frontendDirectory);
 const bundle=await bundleRead(resolve(ROOT,hosting.frontendDirectory),{apiOrigins:[mainnet.applicationOrigin]});same(bundle,frontend.bundle,"The final static frontend artifact changed");
 const stages=await verifyJournalStages(manifest,["transferCircuit","openContainer","setFallback","activateFrontend"],{rpc,load,receiptVerify,source}),opened=stages.results.openContainer.output,activation=stages.results.activateFrontend.output;
 assert.equal(opened.processor,address(manifest.cpu.processor));assert.equal(opened.circuitId,String(manifest.cpu.circuitId));assert.equal(activation.container,opened.container);assert.equal(activation.bundleSha256,bundle.directorySha256);assert.equal(stages.results.setFallback.output.bundleSha256,bundle.directorySha256);
 const owner=stages.results.transferCircuit.output.owner;assert.equal(address(owner),address(manifest.cpu.owner));assert.equal(stages.results.transferCircuit.output.processor,opened.processor);assert.equal(stages.results.transferCircuit.output.circuitId,opened.circuitId);const protocol=await protocolRead(rpc,{processor:opened.processor,tokenId:opened.circuitId,cpuIndex:manifest.cpu.cpuIndex,owner});assert.equal(protocol.site.container,opened.container);assert.equal(protocol.site.opened,true);assert.equal(activation.name,protocol.site.name);
 assert.equal(new URL(hosting.gatewayOrigin).hostname,opened.circuitId+"-2-"+manifest.cpu.cpuIndex+".tapekit.org","Use the actual ecosystem gateway identity");assert.equal(frontend.frontendOrigin,hosting.gatewayOrigin);same([...mainnet.frontendOrigins].sort(),[hosting.gatewayOrigin,hosting.fallbackOrigin].sort());
 const expiry=await rpc.call(PINS.contracts.binding,"containerPaidUntil",[opened.container],protocol.block.number);assert.ok(expiry>BigInt(Math.floor(now/1000)),"The actual published site is not activated");
 const files=await verifyRegistryBundle(rpc,opened.container,bundle,protocol.block.number),bytes=await hostedBytes(hosting,bundle);await verifyRuntime(mainnet,{json});
 // The pinned gateway permits and records offchain API access. Actual wallet
 // dialogs and owner actions still need a reviewed live trace.
 const review=await load(hosting.browserReview);assert.equal(review.kind,"reviewed-live-hosted-browser-evidence");assert.equal(review.sourceCommit,manifest.sourceCommit);assert.equal(review.bundleSha256,bundle.directorySha256);assert.equal(review.gatewayOrigin,hosting.gatewayOrigin);assert.equal(review.fallbackOrigin,hosting.fallbackOrigin);assert.ok(review.reviewedBy&&review.reviewReference);assert.equal(new Date(review.reviewedAt).toISOString(),review.reviewedAt);assert.ok(Date.parse(review.reviewedAt)>=Date.parse(mainnet.deployedAt)&&Date.parse(review.reviewedAt)<=now&&now-Date.parse(review.reviewedAt)<=7*86400000,"Hosted owner evidence must be fresh and follow deployment");same(review.scenarios.map(s=>s.name).sort(),["gateway-api-access","gateway-owner-login","fallback-owner-login","mobile-onboarding","wallet-rejection-recovery","card-detail-navigation"].sort());
 for(const scenario of review.scenarios){assert.equal(scenario.scope,"actual live execution");assert.equal(scenario.passed,true);await evidenceRead(scenario.evidence);}
 // A normal fallback browser observes the real release without credentials.
 await browserObserve(hosting.fallbackOrigin+"/agent-setup",{...mainnet,frontendOrigins:mainnet.frontendOrigins});
 return {scope:"current registry bytes, paid activation, real gateway, identical fallback and reviewed owner/permission traces",container:opened.container,name:protocol.site.name,paidUntil:expiry.toString(),bundleSha256:bundle.directorySha256,verifiedFiles:files.length,bytes,ownerBrowserReview:{reviewedBy:review.reviewedBy,reviewReference:review.reviewReference},reviewInfrastructure:"Studionet testnet; frontend uses an offchain API and worker"};
}
export async function verifyReleaseLive(manifest,requirement,{source=undefined,sourceCapture=captureSource,sourceVerify=verifySources,...options}={}){
 validateLiveManifest(manifest);assert.ok(["cpu","acceptance","hosting"].includes(requirement));source??=await sourceCapture({final:true});validateSource(source,{final:true});assert.equal(source.commit,manifest.sourceCommit);assert.equal(source.treeSha256,manifest.sourceTreeSha256);await sourceVerify();
 const cpu=await verifyLiveCpu(manifest,{...options,source}),result=requirement==="cpu"?{cpu}:{cpu,[requirement]:await (requirement==="acceptance"?verifyLiveAcceptance:verifyLiveHosting)(manifest,{...options,source})};
 validateSource(await sourceCapture({final:true}),{current:source,final:true});return result;
}
async function main(){
 const [mode,path,out]=process.argv.slice(2),requirement=mode?.replace(/^--require-/,"");assert.ok(["cpu","acceptance","hosting"].includes(requirement)&&path,"Usage: verify-release-live.mjs --require-cpu|--require-acceptance|--require-hosting <live-manifest.json> [report.json]");
 const manifest=parseStrictJson((await regularBytes(resolve(path))).toString("utf8")),result=await verifyReleaseLive(manifest,requirement);if(out)await writeFile(resolve(out),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));console.log("LIVE_"+requirement.toUpperCase()+"_VERIFIED");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{await main();}catch(error){console.error("Live release verification failed: "+String(error.message).split("\n")[0].slice(0,350));process.exitCode=1;}}
