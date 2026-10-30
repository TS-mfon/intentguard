import assert from "node:assert/strict";
import {mkdir, writeFile, rename, lstat, realpath} from "node:fs/promises";
import {resolve, relative, isAbsolute} from "node:path";
import {spawnSync} from "node:child_process";
import {TextDecoder} from "node:util";
import {encodeFunctionData, encodeDeployData, keccak256, parseAbi} from "viem";
import {parseStrictJson} from "../../packages/shared/strict-json.ts";
import {profileRoutes, sourceToken, SOURCE_CHAIN_IDS} from "../../packages/shared/payment-profiles.ts";
import {ROOT, PINS, ZERO, ABI, ReadOnlyRpc, hash, digest, canonical, regularBytes, verifySources, observeProtocol, quantity} from "../hosting/protocol.mjs";
import {validateSnapshot} from "../hosting/planner.mjs";
import {scanBundle} from "../hosting/bundle.mjs";

export {ROOT, hash, digest};
export const OUTPUTS = Object.freeze(["docs/deployments/release-preparation.json", "docs/deployments/mainnet-quote.json"]);
export const PRIVATE_DIR = ".local/release-preparation";
export const EXPECTED_TOOLCHAIN = Object.freeze({node:"v24.18.0", pnpm:"11.9.0", foundry:"1.8.6", solc:"0.8.28", optimizerRuns:200, viaIR:true});
export const REVIEW = Object.freeze({environment:"testnet", network:"studionet", chainId:61999, rpcUrl:"https://studio.genlayer.com/api", consensus:"0xb7278a61aa25c888815afc32ad3cc52ff24fe575", genesisHash:"0x"+"0".repeat(64), infrastructure:"studionet-simulator", genesisIsResetProof:false, consensusIsEvmDeploymentProof:false});
export const CONTRACT_NAMES = Object.freeze(["CctpCardFactoryV4", "MainnetUsdt0CardFactory", "CctpSpendingCardV4", "AgentSpendingCard"]);
export const COST_IDS = Object.freeze(["createCPU", "deployUSDCFactory", "deployUSDT0Factory", "mintTransistors", "tapeout", "openContainer", "uploadFrontend", "activateFrontend", "deployInterpreter", "deployReviewers", "createCanaryVaults", "fundCanaries", "destinationSettlement", "bindRuntime"]);
const FRONTEND_INPUT_FILES = Object.freeze(["apps/web/next.config.ts","apps/web/tsconfig.json","apps/web/package.json","contracts/evm/abi.json","tsconfig.json","package.json","pnpm-lock.yaml","pnpm-workspace.yaml","scripts/static-frontend.mjs","tools/hosting/bundle.mjs","tools/hosting/protocol.mjs","tools/hosting/pins.json"]);
const BASE_BLOCKERS = Object.freeze(["DEPLOYED_DEPENDENCIES_MISSING","SPENDING_CAP_REQUIRED","REVIEWER_LIVE_ACCEPTANCE_REQUIRED","ISSUER_RELEASE_RECHECK_REQUIRED","DATABASE_IDENTITY_NOT_BOUND","MAINNET_ORIGINS_NOT_BOUND","CANARIES_AND_TWO_FRESH_AUDITS_REQUIRED"]);

function run(command, args, {root=ROOT, timeout=15000, maxBuffer=8*1024*1024, trim=true}={}) {
  const p=spawnSync(command,args,{cwd:root,encoding:"utf8",timeout,maxBuffer});
  assert.equal(p.error,undefined,`${command} could not run`);
  assert.equal(p.status,0,`${command} failed: ${(p.stderr??"").slice(0,800)}`);
  return trim?p.stdout.trim():p.stdout;
}
function keys(value, allowed, label) {
  assert.ok(value&&typeof value==="object"&&!Array.isArray(value),`${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(),[...allowed].sort(),`${label} fields mismatch`);
}
function hex(value, bytes, label) { assert.match(value??"",new RegExp(`^0x[0-9a-f]{${bytes*2}}$`),`${label} invalid`); }
function sha(value,label="SHA256") { assert.match(value??"",/^[0-9a-f]{64}$/,`${label} invalid`); }
function uint(value,label="amount") { assert.equal(typeof value,"string",`${label} must be a decimal string`); assert.match(value,/^(0|[1-9][0-9]*)$/,`${label} invalid`); return BigInt(value); }
function nonzeroAddress(value,label) { hex(value,20,label); assert.notEqual(value,ZERO,`${label} cannot be zero`); return value; }
function iso(value,label) { assert.equal(new Date(value).toISOString(),value,`${label} invalid`); return Date.parse(value); }
function withinRoot(path,root=ROOT) { const p=relative(root,resolve(root,path)); assert.ok(p&&!p.startsWith("..")&&!isAbsolute(p),"Path must be inside source root"); return p.replaceAll("\\","/"); }
export async function rawJson(path,{maxBytes=1048576}={}) {
  const bytes=await regularBytes(resolve(path)); assert.ok(bytes.length<=maxBytes,"JSON exceeds bounded size");
  return parseStrictJson(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
}
export function seal(value,key) { assert.ok(!Object.hasOwn(value,key)); return {...value,[key]:digest(value)}; }
function checkSeal(value,key) { const {[key]:pin,...body}=value; sha(pin,key); assert.equal(pin,digest(body),`${key} mismatch`); }

export async function captureSource({root=ROOT, final=false}={}) {
  const commit=run("git",["rev-parse","HEAD"],{root}); assert.match(commit,/^[0-9a-f]{40}$/);
  const names=run("git",["ls-files","-z","--cached","--others","--exclude-standard"],{root,trim:false}).split("\0").filter(Boolean);
  const files=[...new Set(names)].filter(p=>!OUTPUTS.includes(p)).sort();
  assert.ok(files.includes("pnpm-lock.yaml")&&files.includes("contracts/evm/abi.json"),"Incomplete source checkout");
  const inputs={};
  for(const path of files) { const bytes=await regularBytes(resolve(root,path)); inputs[path]={sha256:hash(bytes),bytes:bytes.length}; }
  const dirtyRaw=run("git",["status","--porcelain=v1","-z","--untracked-files=all"],{root,trim:false});
  const entries=dirtyRaw.split("\0").filter(Boolean); const dirty=[];
  for(let i=0;i<entries.length;i++) { const entry=entries[i]; const path=entry.slice(3); if(entry.slice(0,2).includes("R")||entry.slice(0,2).includes("C"))i++; if(!OUTPUTS.includes(path))dirty.push(path); }
  dirty.sort(); assert.equal(run("git",["rev-parse","HEAD"],{root}),commit,"Source HEAD changed during capture");
  if(final)assert.equal(dirty.length,0,"Final preparation requires clean current source HEAD");
  return {commit,treeSha256:digest(inputs),sourceDirty:dirty.length>0,dirtyPaths:dirty,excludedGeneratedReports:[...OUTPUTS],inputs};
}

export function validateSource(source,{current,final=false}={}) {
  keys(source,["commit","treeSha256","sourceDirty","dirtyPaths","excludedGeneratedReports","inputs"],"source");
  assert.match(source.commit,/^[0-9a-f]{40}$/,"Source commit missing"); sha(source.treeSha256);
  assert.equal(source.treeSha256,digest(source.inputs),"Source bytes mismatch"); assert.deepEqual(source.excludedGeneratedReports,OUTPUTS);
  assert.equal(source.sourceDirty,source.dirtyPaths.length>0,"Dishonest dirty source state");
  for(const [p,v]of Object.entries(source.inputs)) { withinRoot(p); keys(v,["sha256","bytes"],"source input"); sha(v.sha256); assert.ok(Number.isSafeInteger(v.bytes)&&v.bytes>=0); }
  for(const p of ["package.json","pnpm-lock.yaml","pnpm-workspace.yaml","contracts/evm/abi.json","contracts/evm/foundry.toml","circuits/artifacts/policy.netlist.bin","contracts/genlayer/versions/purchase_reviewer_v4.py","apps/web/lib/deployment-profile.ts","tools/hosting/pins.json",".github/workflows/worker-mainnet.yml"])assert.ok(source.inputs[p],"Required release input missing: "+p);
  if(current) { assert.equal(source.commit,current.commit,"Stale source commit"); assert.equal(source.treeSha256,current.treeSha256,"Stale source tree"); assert.equal(source.sourceDirty,current.sourceDirty,"Source cleanliness changed"); assert.deepEqual(source.dirtyPaths,current.dirtyPaths,"Dirty source identity changed"); }
  if(final)assert.equal(source.sourceDirty,false,"Dirty source cannot be final");
  return source;
}

export async function toolchain({forgeBin=process.env.INTENTGUARD_FOUNDRY_BIN??"forge",root=ROOT}={}) {
  const version=run(forgeBin,["--version"],{root}); const foundry=version.match(/forge Version: ([0-9.]+)/)?.[1]; assert.ok(foundry,"Unknown Foundry version");
  const binary=isAbsolute(forgeBin)?forgeBin:forgeBin.includes("/")?resolve(root,forgeBin):run("/bin/sh",["-c","command -v -- \"$1\"","intentguard-forge",forgeBin],{root});
  const observed={node:process.version,pnpm:run("pnpm",["--version"],{root}),foundry,foundryVersionOutput:version,foundryBinarySha256:hash(await regularBytes(binary)),expected:EXPECTED_TOOLCHAIN};
  return {...observed,matchesPins:observed.node===EXPECTED_TOOLCHAIN.node&&observed.pnpm===EXPECTED_TOOLCHAIN.pnpm&&foundry===EXPECTED_TOOLCHAIN.foundry};
}
export async function compileContracts({root=ROOT,forgeBin=process.env.INTENTGUARD_FOUNDRY_BIN??"forge"}={}) {
  const out=resolve(root,PRIVATE_DIR,"evm-out"),cache=resolve(root,PRIVATE_DIR,"evm-cache");
  await mkdir(resolve(root,PRIVATE_DIR),{recursive:true,mode:0o700});
  run(forgeBin,["build","--root",resolve(root,"contracts/evm"),"--out",out,"--cache-path",cache,"--build-info","--build-info-path",resolve(root,PRIVATE_DIR,"build-info"),"--force"],{root,timeout:180000,maxBuffer:16*1024*1024});
  return collectCompiled({root});
}
export async function collectCompiled({root=ROOT}={}) {
  const exported=await rawJson(resolve(root,"contracts/evm/abi.json")); const contracts=[];
  for(const name of CONTRACT_NAMES) {
    const artifactPath=`${PRIVATE_DIR}/evm-out/${name}.sol/${name}.json`;
    const bytes=await regularBytes(resolve(root,artifactPath)); const a=parseStrictJson(bytes.toString("utf8"));
    assert.deepEqual(a.abi,exported[name],"Compiled ABI mismatch: "+name);
    for(const image of [a.bytecode,a.deployedBytecode])assert.match(image.object,/^0x(?:[a-f0-9]{2})+$/,"Unlinked bytecode");
    assert.ok(Object.keys(a.bytecode.linkReferences??{}).length===0&&Object.keys(a.deployedBytecode.linkReferences??{}).length===0,"External link unresolved");
    const metadata=typeof a.metadata==="string"?parseStrictJson(a.metadata):a.metadata;
    assert.match(metadata.compiler.version,/^0\.8\.28\+/); assert.equal(metadata.settings.optimizer.enabled,true); assert.equal(metadata.settings.optimizer.runs,200); assert.equal(metadata.settings.viaIR,true);
    const sourceHashes={};
    for(const [p,v]of Object.entries(metadata.sources)) { const path=withinRoot(`contracts/evm/${p}`,root); const source=await regularBytes(resolve(root,path)); assert.equal(keccak256("0x"+source.toString("hex")),v.keccak256,"Compiler source hash mismatch: "+path); sourceHashes[path]=hash(source); }
    const creationBytes=(a.bytecode.object.length-2)/2,runtimeBytes=(a.deployedBytecode.object.length-2)/2;
    assert.ok(creationBytes>0&&creationBytes<=49152&&runtimeBytes>0&&runtimeBytes<=24576,"EVM deployment size limit exceeded: "+name);
    const contract={name,artifactPath,artifactSha256:hash(bytes),abiSha256:digest(a.abi),creationBytes,runtimeBytes,creationSha256:hash(Buffer.from(a.bytecode.object.slice(2),"hex")),creationKeccak256:keccak256(a.bytecode.object),runtimeTemplateSha256:hash(Buffer.from(a.deployedBytecode.object.slice(2),"hex")),runtimeTemplateKeccak256:keccak256(a.deployedBytecode.object),immutableReferences:a.deployedBytecode.immutableReferences??{},compilerVersion:metadata.compiler.version,compilerSettings:metadata.settings,sourceHashes};
    contracts.push(contract);
  }
  return {status:"COMPILED_NOT_DEPLOYED",outputDirectory:`${PRIVATE_DIR}/evm-out`,abiFileSha256:hash(await regularBytes(resolve(root,"contracts/evm/abi.json"))),contracts};
}

export function paymentIdentities() {
  return ["testnet","mainnet"].map(environment=>({environment,chainId:SOURCE_CHAIN_IDS[environment],databaseName:environment==="mainnet"?"intentguard_mainnet":"intentguard",review:{...REVIEW},assets:environment==="mainnet"?[{asset:"USDC",token:sourceToken(environment,"USDC"),settlement:"local-and-CCTP"},{asset:"USDT0",token:sourceToken(environment,"USDT0"),settlement:"X-Layer-only"}]:[{asset:"USDC",token:sourceToken(environment,"USDC"),settlement:"local-and-CCTP"}],candidateDestinations:Object.values(profileRoutes(environment)).map(({chainId,domain,token})=>({chainId,domain,token,enabled:false})),spendingEnabled:false}));
}
export function validateIdentities(identities) { assert.deepEqual(identities,paymentIdentities(),"Payment/review environment identity mismatch"); }

export const PROVENANCE_INPUTS=Object.freeze({
  circuit:["circuits/policy.mjs","circuits/artifacts/policy.netlist.bin","circuits/artifacts/policy.metadata.json"],
  vendor:["contracts/evm/src/vendor/interfaces/ICPU.sol","contracts/evm/src/vendor/lib/NetlistVM.sol","contracts/evm/src/vendor/README.md"],
  reviewer:["contracts/genlayer/versions/purchase_reviewer_v4.py","contracts/genlayer/versions/purchase_reviewer_v4.schema.json","contracts/genlayer/versions/purchase_reviewer_v4.audit.json","contracts/genlayer/permission_interpreter.py","contracts/genlayer/permission_interpreter.schema.json","contracts/genlayer/versions/permission_interpreter_v2.py","contracts/genlayer/versions/permission_interpreter_v2.schema.json"],
  runtime:["apps/web/lib/config.ts","apps/web/lib/deployment-profile.ts","apps/web/lib/capabilities.ts","apps/web/lib/genlayer.ts","apps/web/lib/store.ts","apps/web/lib/database-profile.ts",".github/workflows/worker-mainnet.yml",".github/workflows/worker.yml","Dockerfile","pnpm-lock.yaml","pnpm-workspace.yaml"]
});
export function validateProvenance(p,source) {
  keys(p,["tapeKitCommit","pinsSha256","tapeKitSources","circuit","vendor","reviewer","runtime","preservedTestnet","sourceProvenanceScope"],"provenance");
  assert.equal(p.tapeKitCommit,PINS.tapeKit.commit);assert.equal(p.pinsSha256,digest(PINS));assert.deepEqual(p.tapeKitSources,PINS.tapeKit.files);
  for(const name of Object.keys(PROVENANCE_INPUTS)) { assert.deepEqual(Object.keys(p[name].inputs).sort(),[...PROVENANCE_INPUTS[name]].sort(),"Missing "+name+" provenance"); for(const[path,pin]of Object.entries(p[name].inputs))assert.equal(pin,source.inputs[path]?.sha256,"Changed "+name+" provenance"); }
  keys(p.circuit,["netlistSha256","gateCount","inputBits","outputBits","bytes","inputs"],"circuit provenance");assert.equal(p.circuit.netlistSha256,PINS.artifacts["circuits/artifacts/policy.netlist.bin"]);assert.equal(p.circuit.gateCount,1766);assert.equal(p.circuit.inputBits,451);assert.equal(p.circuit.outputBits,8);assert.equal(p.circuit.bytes,1766*7);
  assert.equal(p.circuit.inputs["circuits/artifacts/policy.netlist.bin"],p.circuit.netlistSha256,"Circuit source hash mismatch");
  keys(p.vendor,["inputs","auditClaim","scope"],"vendor provenance");assert.equal(p.vendor.auditClaim,false);for(const[path,pin]of Object.entries(PINS.artifacts))if(path.includes("/vendor/"))assert.equal(p.vendor.inputs[path],pin,"Vendor pin mismatch");
  keys(p.reviewer,["version","inputs","review","deployedReviewer","liveFinalityVerified"],"reviewer provenance");assert.equal(p.reviewer.version,4);assert.deepEqual(p.reviewer.review,REVIEW);assert.equal(p.reviewer.deployedReviewer,null);assert.equal(p.reviewer.liveFinalityVerified,false);
  keys(p.runtime,["inputs","databaseName","databasePreparationSha256","databaseIdentityBound","financialRecords","workersEnabled"],"runtime provenance");assert.equal(p.runtime.databaseName,"intentguard_mainnet");assert.equal(p.runtime.databasePreparationSha256,source.inputs["docs/deployments/mainnet-database-preparation.json"]?.sha256);assert.equal(p.runtime.databaseIdentityBound,false);assert.equal(p.runtime.financialRecords,0);assert.equal(p.runtime.workersEnabled,false);
  keys(p.preservedTestnet,["path","sha256","paymentChainId","reviewChainId","processor","factoryAddress","newMainnetOverrides"],"preserved testnet");assert.equal(p.preservedTestnet.path,"docs/deployments/testnet.json");assert.equal(p.preservedTestnet.sha256,source.inputs[p.preservedTestnet.path]?.sha256);assert.equal(p.preservedTestnet.paymentChainId,1952);assert.equal(p.preservedTestnet.reviewChainId,61999);assert.equal(p.preservedTestnet.newMainnetOverrides,false);nonzeroAddress(p.preservedTestnet.processor,"preserved processor");nonzeroAddress(p.preservedTestnet.factoryAddress,"preserved factory");
}

export function deploymentInputs(source,build) {
  const byName=Object.fromEntries(build.contracts.map(c=>[c.name,c]));
  return {sourceCommit:source.commit,sourceTreeSha256:source.treeSha256,kind:"unsigned-read-only-deployment-inputs",chainId:196,sender:null,
    transactions:[
      {id:"createCPU",to:PINS.contracts.factory,functionName:"createCPU",args:["IntentGuard","IGUARD","Deterministic agent spending permissions","10000","0"],data:encodeFunctionData({abi:ABI,functionName:"createCPU",args:["IntentGuard","IGUARD","Deterministic agent spending permissions",10000n,0n]}),valueSource:"live factory.deployFee()",valueWei:null,deploys:null},
      ...[["deployUSDCFactory","CctpCardFactoryV4"],["deployUSDT0Factory","MainnetUsdt0CardFactory"]].map(([id,name])=>({id,to:null,contract:name,artifactPath:byName[name].artifactPath,creationSha256:byName[name].creationSha256,constructorArgs:[],valueWei:"0",deploys:null}))
    ],dependent:[{id:"mintTransistors",requires:["CPUCreated receipt","verified transistor address, source, runtime and current mintPrice/protocolFee","actual sender balance"],arguments:{id:"0",requiredGateCount:1766},to:null,data:null,valueWei:null},{id:"tapeout",requires:["verified official CPU","owned transistor balance","current TAPEOUT_FEE"],arguments:{inputBits:451,outputBits:8,netlistSha256:PINS.artifacts["circuits/artifacts/policy.netlist.bin"]},to:null,data:null,valueWei:null},{id:"openContainer",requires:["actual processor and circuit ID","reviewed opener ABI","ownership, frozen beacon and circuit hash"],to:PINS.contracts.opener,data:null,valueWei:null}],
    runtimeManifest:{status:"BLOCKED_UNTIL_DEPLOYED",path:"docs/deployments/mainnet.json",paymentEnvironment:"mainnet",paymentChainId:196,databaseName:"intentguard_mainnet",reviewEnvironment:"testnet",reviewNetwork:"studionet",reviewChainId:61999,sourceCommit:source.commit,releaseId:null,applicationOrigin:null,frontendOrigin:null,contracts:null,codeHashes:null,circuitId:null,enabledAssets:[],verifiedDestinationChainIds:[],requiredEvidence:["official CPU/circuit and independent live vectors","factory receipts and runtime with patched immutable references","finalized source and constructor-bound Studionet interpreter/reviewers","current issuer checks on every enabled route","database marker with separate API/worker principals","source-bound API/frontend build and verified origins","approved spending cap","limited canaries and two fresh semantic audit rounds"]},
    journalRequirement:"A future executor must bind exact source/quote/cap, sender and nonce, fsync the environment-specific private intent journal before signing, and reconcile receipts before replay.",signatures:0,broadcasts:0,writeAuthorizationEligible:false};
}

export function validatePreparation(p,{currentSource,final=false,compiled}={}) {
  keys(p,["version","kind","preparedAt","status","source","toolchain","identities","provenance","build","deployment","quoteHash","readiness","preparationHash"],"preparation");
  checkSeal(p,"preparationHash"); assert.equal(p.version,1); assert.equal(p.kind,"intentguard-release-preparation"); iso(p.preparedAt,"preparedAt"); assert.equal(p.status,"PREPARED_NOT_DEPLOYED");
  validateSource(p.source,{current:currentSource,final}); validateIdentities(p.identities); assert.deepEqual(p.toolchain.expected,EXPECTED_TOOLCHAIN);
  keys(p.toolchain,["node","pnpm","foundry","foundryVersionOutput","foundryBinarySha256","expected","matchesPins"],"toolchain");
  assert.equal(p.toolchain.matchesPins,p.toolchain.node===EXPECTED_TOOLCHAIN.node&&p.toolchain.pnpm===EXPECTED_TOOLCHAIN.pnpm&&p.toolchain.foundry===EXPECTED_TOOLCHAIN.foundry,"Toolchain status mismatch"); sha(p.toolchain.foundryBinarySha256);
  assert.ok(p.toolchain.foundryVersionOutput.includes("forge Version: "+p.toolchain.foundry),"Foundry measurement mismatch");
  if(final)assert.equal(p.toolchain.matchesPins,true,"Reviewed toolchain mismatch");
  validateProvenance(p.provenance,p.source);
  assert.equal(p.provenance.tapeKitCommit,PINS.tapeKit.commit); assert.equal(p.provenance.pinsSha256,digest(PINS));
  keys(p.build,["status","outputDirectory","abiFileSha256","contracts"],"compiled build");assert.equal(p.build.outputDirectory,PRIVATE_DIR+"/evm-out");assert.equal(p.build.status,"COMPILED_NOT_DEPLOYED"); assert.equal(p.build.abiFileSha256,p.source.inputs["contracts/evm/abi.json"].sha256);
  assert.deepEqual(p.build.contracts.map(c=>c.name),CONTRACT_NAMES);
  for(const c of p.build.contracts) { keys(c,["name","artifactPath","artifactSha256","abiSha256","creationBytes","runtimeBytes","creationSha256","creationKeccak256","runtimeTemplateSha256","runtimeTemplateKeccak256","immutableReferences","compilerVersion","compilerSettings","sourceHashes"],"compiled contract");assert.equal(c.artifactPath,`${PRIVATE_DIR}/evm-out/${c.name}.sol/${c.name}.json`);assert.ok(c.creationBytes>0&&c.creationBytes<=49152&&c.runtimeBytes>0&&c.runtimeBytes<=24576); for(const field of ["artifactSha256","abiSha256","creationSha256","runtimeTemplateSha256"])sha(c[field]); hex(c.creationKeccak256,32,"Creation code"); hex(c.runtimeTemplateKeccak256,32,"Runtime template"); assert.match(c.compilerVersion,/^0\.8\.28\+/); assert.equal(c.compilerSettings.optimizer.runs,200); assert.equal(c.compilerSettings.optimizer.enabled,true); assert.equal(c.compilerSettings.viaIR,true); assert.ok(Object.keys(c.sourceHashes).length>0,"Compiler sources missing"); for(const[path,pin]of Object.entries(c.sourceHashes))assert.equal(pin,p.source.inputs[path]?.sha256,"Build/source provenance mismatch"); }
  if(compiled)assert.deepEqual(p.build,compiled,"Compiled artifact drift");
  assert.deepEqual(p.deployment,deploymentInputs(p.source,p.build),"Mismatched release deployment evidence");
  sha(p.quoteHash); keys(p.readiness,["spendingEnabled","deploymentsVerified","writeAuthorizationEligible","runtimeManifestEligible","blockers"],"readiness");assert.equal(p.readiness.spendingEnabled,false); assert.equal(p.readiness.deploymentsVerified,false); assert.equal(p.readiness.writeAuthorizationEligible,false); assert.equal(p.readiness.runtimeManifestEligible,false);
  assert.deepEqual(p.readiness.blockers,[...BASE_BLOCKERS,...(p.source.sourceDirty?["SOURCE_DIRTY"]:[]),...(p.toolchain.matchesPins?[]:["TOOLCHAIN_MISMATCH"])],"Missing or dishonest release blockers");
  return p;
}

export function quoteBody({source,build,protocol=null,gasPriceWei=null,simulations=[],reviewObservation=null,frontend=null,failures=[],now=Date.now()}) {
  const live=protocol!==null; if(live)validateSnapshot(protocol,{now}); if(gasPriceWei!==null)uint(gasPriceWei,"gas price");
  const known=live?BigInt(protocol.fees.deployFeeWei)+BigInt(protocol.fees.monthlyFeeWei)+(protocol.fees.openerFeeWei===null?0n:BigInt(protocol.fees.openerFeeWei)):0n;
  const costs=COST_IDS.map(id=>({id,status:"UNRESOLVED",feeWei:null,estimatedGas:null,estimatedGasCostWei:null,reason:"Requires actual deployed dependencies, principals, policy, calldata or funding amounts."}));
  const cost=id=>costs.find(c=>c.id===id);
  if(live) { for(const[id,fee]of [["createCPU",protocol.fees.deployFeeWei],["activateFrontend",protocol.fees.monthlyFeeWei],["openContainer",protocol.fees.openerFeeWei]])if(fee!==null)Object.assign(cost(id),{status:"FEE_MEASURED_GAS_UNRESOLVED",feeWei:fee,reason:"Actual pinned contract fee; exact dependent gas is still required."}); }
  for(const s of simulations) { const c=cost(s.id); assert.ok(c,"Unknown simulated cost"); if(s.status==="SIMULATED")Object.assign(c,{status:"GAS_ESTIMATED",feeWei:c.feeWei??"0",estimatedGas:s.gas,estimatedGasCostWei:(BigInt(s.gas)*BigInt(gasPriceWei)).toString(),reason:"Read-only eth_call and eth_estimateGas at the pinned block; sender is omitted unless a real public sender is supplied."}); }
  if(frontend)Object.assign(cost("uploadFrontend"),{reason:`Actual ${frontend.bundle.totalBytes} byte / ${frontend.bundle.totalChunks} chunk artifact; storage floor is a lower bound, dependent upload calls remain unsimulated.`});
  const gasSum=costs.reduce((n,c)=>n+(c.estimatedGasCostWei===null?0n:BigInt(c.estimatedGasCostWei)),0n);
  return seal({version:1,kind:"intentguard-mainnet-read-only-quote",status:"INCOMPLETE_NOT_AUTHORIZED",createdAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString(),sourceCommit:source.commit,sourceTreeSha256:source.treeSha256,paymentEnvironment:"mainnet",paymentChainId:196,currency:"OKB",review:{...REVIEW},protocol,gasPriceWei,reviewObservation,buildHash:digest(build),frontend,simulations,costs,economics:{knownFeesWei:live?known.toString():null,estimatedGasCostWei:gasPriceWei===null?null:gasSum.toString(),measuredSubtotalWei:live&&gasPriceWei!==null?(known+gasSum).toString():null,totalCostWei:null,storageGasLowerBound:frontend?String(BigInt(frontend.bundle.totalBytes+frontend.bundle.totalChunks)*200n):null,storageFloorIsCompleteEstimate:false,activationMonths:1},spendingCap:{required:true,approvedWei:null,approvedQuoteHash:null,approvedBy:null,requiredFullCapWei:null,stageCapPossible:false,reason:"Resolve all applicable fees and gas; then obtain the user's explicit cap bound to a fresh exact quote and transaction scope. This planner cannot approve spending."},failures,signatures:0,broadcasts:0,writeAuthorizationEligible:false},"quoteHash");
}

export function validateQuote(q,{source,build,preparation,now=Date.now(),requireCurrent=false}={}) {
  keys(q,["version","kind","status","createdAt","expiresAt","sourceCommit","sourceTreeSha256","paymentEnvironment","paymentChainId","currency","review","protocol","gasPriceWei","reviewObservation","buildHash","frontend","simulations","costs","economics","spendingCap","failures","signatures","broadcasts","writeAuthorizationEligible","quoteHash"],"quote");
  checkSeal(q,"quoteHash"); assert.equal(q.version,1); assert.equal(q.kind,"intentguard-mainnet-read-only-quote"); assert.equal(q.status,"INCOMPLETE_NOT_AUTHORIZED"); assert.equal(q.paymentEnvironment,"mainnet"); assert.equal(q.paymentChainId,196); assert.equal(q.currency,"OKB"); assert.deepEqual(q.review,REVIEW);
  const created=iso(q.createdAt,"createdAt"),expiry=iso(q.expiresAt,"expiresAt"); assert.equal(expiry-created,300000,"Quote lifetime mismatch"); if(requireCurrent)assert.ok(now>=created&&now<expiry,"Quote expired or future");
  if(source) { assert.equal(q.sourceCommit,source.commit,"Quote source commit mismatch"); assert.equal(q.sourceTreeSha256,source.treeSha256,"Quote source bytes mismatch"); }
  if(build)assert.equal(q.buildHash,digest(build),"Quote compiled artifact mismatch");
  if(preparation) { assert.equal(preparation.quoteHash,q.quoteHash,"Release/quote evidence mismatch"); assert.equal(q.sourceCommit,preparation.source.commit); assert.equal(q.sourceTreeSha256,preparation.source.treeSha256); assert.equal(q.buildHash,digest(preparation.build)); }
  assert.equal(q.signatures,0); assert.equal(q.broadcasts,0); assert.equal(q.writeAuthorizationEligible,false);
  if(q.gasPriceWei!==null)uint(q.gasPriceWei,"gas price");
  validateSimulations(q,{source:source??preparation?.source,build:build??preparation?.build});
  assert.deepEqual(q.costs.map(c=>c.id),COST_IDS,"Missing dependent cost");
  for(const c of q.costs) { assert.ok(["UNRESOLVED","FEE_MEASURED_GAS_UNRESOLVED","GAS_ESTIMATED"].includes(c.status),"Invalid cost classification"); for(const k of ["feeWei","estimatedGas","estimatedGasCostWei"])if(c[k]!==null)uint(c[k],k); if(c.status==="GAS_ESTIMATED") { assert.notEqual(c.estimatedGas,null); assert.equal(c.estimatedGasCostWei,(BigInt(c.estimatedGas)*uint(q.gasPriceWei,"gas price")).toString()); } else assert.equal(c.estimatedGas,null); }
  assert.equal(q.economics.totalCostWei,null,"Unresolved cost cannot become total"); assert.equal(q.economics.storageFloorIsCompleteEstimate,false); assert.equal(q.economics.activationMonths,1);
  assert.deepEqual(q.spendingCap,{required:true,approvedWei:null,approvedQuoteHash:null,approvedBy:null,requiredFullCapWei:null,stageCapPossible:false,reason:"Resolve all applicable fees and gas; then obtain the user's explicit cap bound to a fresh exact quote and transaction scope. This planner cannot approve spending."},"Spending cap cannot be inferred");
  if(q.protocol) { validateSnapshot(q.protocol,{now:created}); const fees=q.protocol.fees; const known=uint(fees.deployFeeWei)+uint(fees.monthlyFeeWei)+(fees.openerFeeWei===null?0n:uint(fees.openerFeeWei)); assert.equal(q.economics.knownFeesWei,known.toString(),"Fee arithmetic mismatch"); }
  else assert.equal(q.economics.knownFeesWei,null);
  const gasSum=q.costs.reduce((n,c)=>n+(c.estimatedGasCostWei===null?0n:BigInt(c.estimatedGasCostWei)),0n); assert.equal(q.economics.estimatedGasCostWei,q.gasPriceWei===null?null:gasSum.toString(),"Gas arithmetic mismatch");
  assert.equal(q.economics.measuredSubtotalWei,q.protocol&&q.gasPriceWei!==null?(BigInt(q.economics.knownFeesWei)+gasSum).toString():null,"Subtotal arithmetic mismatch");
  const derived=quoteBody({source:{commit:q.sourceCommit,treeSha256:q.sourceTreeSha256},build:build??preparation?.build??{},protocol:q.protocol,gasPriceWei:q.gasPriceWei,simulations:q.simulations,reviewObservation:q.reviewObservation,frontend:q.frontend,failures:q.failures,now:created});
  assert.deepEqual(q.costs,derived.costs,"Costs differ from measured fees and simulations");
  assert.deepEqual(q.economics,derived.economics,"Economics differ from measured inputs");
  if(q.reviewObservation) {
    const r=q.reviewObservation;keys(r,["environment","network","chainId","observedAt","rpcUrl","genesisHash","consensus","consensusCodeBytes","consensusCodeSha256","genesisIsResetProof","consensusIsEvmDeploymentProof","liveReviewerVerified","evidence"],"review observation");
    assert.equal(r.chainId,61999,"Wrong review chain");assert.equal(r.genesisHash,REVIEW.genesisHash,"Studionet genesis mismatch");assert.equal(r.consensus,REVIEW.consensus);assert.equal(r.environment,"testnet");assert.equal(r.network,REVIEW.network);assert.equal(r.rpcUrl,REVIEW.rpcUrl);
    const observed=iso(r.observedAt,"review observedAt");assert.ok(observed<=created&&created-observed<=300000,"Stale or future review observation");assert.ok(Number.isSafeInteger(r.consensusCodeBytes)&&r.consensusCodeBytes>=0);sha(r.consensusCodeSha256);
    assert.equal(r.genesisIsResetProof,false);assert.equal(r.consensusIsEvmDeploymentProof,false);assert.equal(r.liveReviewerVerified,false,"Identity reads cannot certify deployed live review");
    assert.ok(Array.isArray(r.evidence));assert.deepEqual(r.evidence.map(e=>e.method),["eth_chainId","eth_getBlockByNumber","eth_getCode"],"Review identity evidence incomplete");for(const e of r.evidence){keys(e,["method","paramsSha256","responseSha256","resultSha256"],"review RPC evidence");for(const key of ["paramsSha256","responseSha256","resultSha256"])sha(e[key]);}
  }
  return q;
}

function validateSimulations(q,{source,build}={}) {
  assert.ok(Array.isArray(q.simulations)&&q.simulations.length<=3,"Invalid simulation records");
  if(!q.simulations.length)return;
  assert.ok(q.protocol&&q.gasPriceWei!==null,"Simulation requires pinned protocol and gas price");
  const plans=source&&build?deploymentInputs(source,build).transactions:null,seen=new Set();
  for(const s of q.simulations) {
    assert.ok(!seen.has(s.id)&&["createCPU","deployUSDCFactory","deployUSDT0Factory"].includes(s.id),"Duplicate or unsupported simulation");seen.add(s.id);
    assert.equal(s.chainId,196,"Simulation payment chain mismatch");assert.equal(s.block,q.protocol.block.number,"Simulation block mismatch");assert.equal(s.blockHash,q.protocol.block.hash,"Simulation block hash mismatch");
    assert.equal(s.sender,null,"Preparation must not invent a deployment sender");assert.equal(s.signatures,0);assert.equal(s.broadcasts,0);
    keys(s.transaction,s.id==="createCPU"?["to","data","value"]:["data","value"],"unsigned simulation transaction");
    assert.match(s.transaction.data,/^0x(?:[a-f0-9]{2})+$/,"Simulation calldata invalid");assert.equal(s.dataSha256,hash(Buffer.from(s.transaction.data.slice(2),"hex")),"Simulation calldata hash mismatch");
    assert.equal(s.to,s.transaction.to??null,"Simulation target mismatch");assert.equal(s.valueWei,quantity(s.transaction.value).toString(),"Simulation value mismatch");
    if(s.id==="createCPU") { assert.equal(s.to,PINS.contracts.factory,"Simulation factory mismatch");assert.equal(s.valueWei,q.protocol.fees.deployFeeWei,"Simulation fee mismatch");
      const cpu=deploymentInputs({commit:q.sourceCommit,treeSha256:q.sourceTreeSha256}, {contracts:CONTRACT_NAMES.map(name=>({name}))}).transactions[0];assert.equal(s.transaction.data,cpu.data,"CPU simulation inputs changed");
    }else { assert.equal(s.to,null,"Creation simulation target must be absent");assert.equal(s.valueWei,"0","Factory creation value mismatch"); }
    const plan=plans?.find(p=>p.id===s.id);if(plan?.contract) { assert.equal(s.dataSha256,plan.creationSha256,"Factory simulation image mismatch");assert.equal((s.transaction.data.length-2)/2,build.contracts.find(c=>c.name===plan.contract).creationBytes,"Factory simulation initcode length mismatch"); }
    const common=["id","chainId","block","blockHash","sender","to","valueWei","dataSha256","transaction","signatures","broadcasts","status","gas"];
    if(s.status==="SIMULATED") { keys(s,[...common,"estimatedGasCostWei","returnedBytes","returnedSha256","rpcOperators","limitations",...(s.id==="createCPU"?[]:["runtimeTemplateVerified"])],"successful simulation");
      assert.ok(uint(s.gas,"simulation gas")>0n,"Simulation gas must be positive");assert.equal(s.estimatedGasCostWei,(BigInt(s.gas)*BigInt(q.gasPriceWei)).toString(),"Simulation gas cost mismatch");sha(s.returnedSha256,"Simulation result hash");assert.ok(Number.isSafeInteger(s.returnedBytes)&&s.returnedBytes>0,"Simulation result bytes missing");
      assert.deepEqual(s.rpcOperators,["https://rpc.xlayer.tech","https://xlayer.drpc.org"],"Independent simulation quorum missing");assert.ok(Array.isArray(s.limitations)&&s.limitations.length>0,"Simulation limitations missing");
      if(s.id==="createCPU")assert.equal(s.returnedBytes,64,"CPU constructor return mismatch");else { assert.equal(s.runtimeTemplateVerified,true,"Factory runtime template unverified");if(plan)assert.equal(s.returnedBytes,build.contracts.find(c=>c.name===plan.contract).runtimeBytes,"Factory runtime length mismatch"); }
    }else { assert.equal(s.status,"UNRESOLVED","Invalid simulation status");keys(s,[...common,"reason","rpcCode"],"unresolved simulation");assert.equal(s.gas,null,"Unresolved simulation cannot estimate gas");assert.equal(typeof s.reason,"string");assert.ok(s.reason.length>0);assert.ok(s.rpcCode===null||Number.isSafeInteger(s.rpcCode)); }
  }
}

export function requireSpendingReady(preparation,quote,{now=Date.now()}={}) {
  validatePreparation(preparation,{final:true}); validateQuote(quote,{preparation,now,requireCurrent:true});
  assert.equal(preparation.readiness.deploymentsVerified,true,"Actual deployed dependencies are missing");
  assert.ok(quote.costs.every(c=>c.status==="GAS_ESTIMATED"),"Unresolved costs prevent spending");
  assert.notEqual(quote.spendingCap.approvedWei,null,"Explicit user spending cap missing");
  throw Error("No signing or broadcasting implementation exists in release preparation");
}

async function atomicJson(path,value) {
  const privateRoot=resolve(ROOT,PRIVATE_DIR);await mkdir(privateRoot,{recursive:true,mode:0o700});assert.equal(await realpath(privateRoot),privateRoot,"Private output symlink forbidden");
  const parent=resolve(path,"..");await mkdir(parent,{recursive:true});assert.equal(await realpath(parent),parent,"Output directory symlink forbidden");
  const target=await lstat(path).catch(e=>{if(e.code!=="ENOENT")throw e;return null;});if(target)assert.ok(target.isFile()&&!target.isSymbolicLink()&&target.nlink===1,"Output must be a single-link regular file");
  const temp=resolve(privateRoot,"output-"+hash(path)+".tmp");await writeFile(temp,JSON.stringify(value,null,2)+"\n",{mode:0o600,flag:"wx"});await rename(temp,path);
}
export async function saveArtifacts(preparation,quote,{root=ROOT}={}) {
  validatePreparation(preparation); validateQuote(quote,{preparation});
  await atomicJson(resolve(root,OUTPUTS[1]),quote); await atomicJson(resolve(root,OUTPUTS[0]),preparation);
}

export function makePreparation({source,toolchain:chain,build,provenance,quote,now=Date.now()}) {
  const blockers=[...BASE_BLOCKERS];
  if(source.sourceDirty)blockers.push("SOURCE_DIRTY"); if(!chain.matchesPins)blockers.push("TOOLCHAIN_MISMATCH");
  return seal({version:1,kind:"intentguard-release-preparation",preparedAt:new Date(now).toISOString(),status:"PREPARED_NOT_DEPLOYED",source,toolchain:chain,identities:paymentIdentities(),provenance,build,deployment:deploymentInputs(source,build),quoteHash:quote.quoteHash,readiness:{spendingEnabled:false,deploymentsVerified:false,writeAuthorizationEligible:false,runtimeManifestEligible:false,blockers}},"preparationHash");
}

const READ_METHODS=new Set(["eth_chainId","eth_getBlockByNumber","eth_getCode","eth_getStorageAt","eth_call","eth_gasPrice","eth_estimateGas"]);
/** Preserve the existing independently operated endpoint quorum, while rejecting
 * duplicate raw response keys before they can be hidden by JSON.parse. */
export class StrictReadOnlyRpc extends ReadOnlyRpc {
  constructor(options={}) { super(options);this.observations=[]; }
  async single(url,method,params) {
    assert.ok(READ_METHODS.has(method),"Signing and broadcast RPCs are forbidden");assert.ok(this.urls.includes(url),"Unreviewed RPC endpoint");
    const id=++this.id;let responseSha256=null;
    try {
      const r=await this.fetchImpl(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id,method,params}),signal:AbortSignal.timeout(this.timeoutMs),redirect:"error"});
      assert.ok(r.ok,"RPC HTTP failure");const raw=new Uint8Array(await r.arrayBuffer());assert.ok(raw.length<=1048576,"RPC response exceeds1MiB");responseSha256=hash(raw);
      const j=parseStrictJson(new TextDecoder("utf-8",{fatal:true}).decode(raw));assert.equal(j.jsonrpc,"2.0");assert.equal(j.id,id);assert.ok(Object.hasOwn(j,"result")!==Object.hasOwn(j,"error"),"Malformed RPC envelope");
      if(j.error) { const e=Error("Read-only RPC reverted or refused the simulation");e.rpcCode=j.error.code;throw e; }
      this.observations.push({endpoint:url,method,paramsSha256:digest(params),responseSha256,resultSha256:digest(j.result),status:"OBSERVED"});return j.result;
    } catch(e) { this.observations.push({endpoint:url,method,paramsSha256:digest(params),responseSha256,status:"FAILED",rpcCode:Number.isSafeInteger(e.rpcCode)?e.rpcCode:null});const error=Error(`Read-only ${method} failed at ${new URL(url).hostname}: ${String(e.message).slice(0,160)}`);error.rpcCode=e.rpcCode;throw error; }
  }
}

export async function observeReview({fetchImpl=fetch,now=Date.now()}={}) {
  let id=0;const evidence=[];
  async function call(method,params) {
    assert.ok(["eth_chainId","eth_getBlockByNumber","eth_getCode"].includes(method));
    const reqId=++id;const r=await fetchImpl(REVIEW.rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:reqId,method,params}),redirect:"error",signal:AbortSignal.timeout(15000)});
    assert.ok(r.ok,"Studionet RPC HTTP failure");const bytes=new Uint8Array(await r.arrayBuffer());assert.ok(bytes.length<=1048576,"Studionet response too large");
    const j=parseStrictJson(new TextDecoder("utf-8",{fatal:true}).decode(bytes));assert.equal(j.jsonrpc,"2.0");assert.equal(j.id,reqId);assert.ok(Object.hasOwn(j,"result")&&!Object.hasOwn(j,"error"),"Studionet read unavailable");
    evidence.push({method,paramsSha256:digest(params),responseSha256:hash(bytes),resultSha256:digest(j.result)});return j.result;
  }
  assert.equal(quantity(await call("eth_chainId",[])),61999n,"Unexpected GenLayer review chain");
  const genesis=await call("eth_getBlockByNumber",["0x0",false]);assert.equal(genesis.hash,REVIEW.genesisHash,"Unexpected Studionet simulator genesis");
  const code=await call("eth_getCode",[REVIEW.consensus,"latest"]);assert.match(code,/^0x(?:[a-f0-9]{2})*$/);
  return {environment:"testnet",network:"studionet",chainId:61999,observedAt:new Date(now).toISOString(),rpcUrl:REVIEW.rpcUrl,genesisHash:genesis.hash,consensus:REVIEW.consensus,consensusCodeBytes:(code.length-2)/2,consensusCodeSha256:hash(Buffer.from(code.slice(2),"hex")),genesisIsResetProof:false,consensusIsEvmDeploymentProof:false,liveReviewerVerified:false,evidence};
}

export async function simulateTransactions(rpc,{source,build,protocol,root=ROOT,gasPriceWei}) {
  const plans=deploymentInputs(source,build),simulations=[];
  for(const p of plans.transactions) {
    let tx;
    if(p.id==="createCPU")tx={to:p.to,data:p.data,value:"0x"+BigInt(protocol.fees.deployFeeWei).toString(16)};
    else { const a=await rawJson(resolve(root,p.artifactPath));const data=encodeDeployData({abi:a.abi,bytecode:a.bytecode.object,args:[]});assert.equal(hash(Buffer.from(data.slice(2),"hex")),p.creationSha256,"Deployment bytecode changed before simulation");tx={data,value:"0x0"}; }
    const dataSha256=hash(Buffer.from(tx.data.slice(2),"hex"));const base={id:p.id,chainId:196,block:protocol.block.number,blockHash:protocol.block.hash,sender:null,to:tx.to??null,valueWei:BigInt(tx.value).toString(),dataSha256,transaction:tx,signatures:0,broadcasts:0};
    try {
      const returned=await rpc.request("eth_call",[tx,protocol.block.number]);assert.match(returned,/^0x(?:[a-f0-9]{2})*$/i,"Malformed simulation result");
      const gas=quantity(await rpc.request("eth_estimateGas",[tx,protocol.block.number])).toString();assert.ok(BigInt(gas)>0n,"Zero gas estimate");
      const s={...base,status:"SIMULATED",gas,estimatedGasCostWei:(BigInt(gas)*BigInt(gasPriceWei)).toString(),returnedBytes:(returned.length-2)/2,returnedSha256:hash(Buffer.from(returned.slice(2),"hex")),rpcOperators:[...rpc.urls],limitations:["Sender omitted: actual funded deployment principal and nonce must be verified before any broadcast.","Gas estimate is pinned read-only simulation and can change; it is not a cap or receipt."]};
      if(p.contract) { const a=await rawJson(resolve(root,p.artifactPath));verifyRuntimeTemplate(a,returned);s.runtimeTemplateVerified=true; }
      simulations.push(s);
    } catch(e) { simulations.push({...base,status:"UNRESOLVED",gas:null,reason:String(e.message).slice(0,240),rpcCode:Number.isSafeInteger(e.rpcCode)?e.rpcCode:null}); }
  }
  return simulations;
}

/** Immutables are patched by constructor execution. Compare every other byte;
 * record the actual returned image instead of calling a zero-placeholder
 * template an onchain bytecode hash. */
export function verifyRuntimeTemplate(artifact,actual) {
  assert.match(actual,/^0x(?:[a-f0-9]{2})+$/i,"Runtime missing");
  const template=Buffer.from(artifact.deployedBytecode.object.slice(2),"hex"),bytes=Buffer.from(actual.slice(2),"hex");assert.equal(bytes.length,template.length,"Runtime length mismatch");
  const mask=new Uint8Array(template.length);
  for(const slots of Object.values(artifact.deployedBytecode.immutableReferences??{}))for(const {start,length}of slots) { assert.ok(Number.isSafeInteger(start)&&Number.isSafeInteger(length)&&start>=0&&length>0&&start+length<=template.length,"Immutable reference out of range");mask.fill(1,start,start+length); }
  for(let i=0;i<bytes.length;i++)if(!mask[i])assert.equal(bytes[i],template[i],"Runtime opcode or metadata mismatch at byte "+i);
  return {runtimeSha256:hash(bytes),runtimeKeccak256:keccak256(actual),immutableBytes:mask.reduce((n,v)=>n+v,0)};
}

export async function collectProvenance({source,root=ROOT}={}) {
  const pins=await rawJson(resolve(root,"tools/hosting/pins.json"));assert.deepEqual(pins,PINS,"Raw hosting pins drift");
  const metadata=await rawJson(resolve(root,"circuits/artifacts/policy.metadata.json"));assert.equal(metadata.sha256,"0x"+PINS.artifacts["circuits/artifacts/policy.netlist.bin"]);
  const verified=await verifySources({root});
  const inputs=paths=>Object.fromEntries(paths.map(p=>{assert.ok(source.inputs[p],"Provenance input missing: "+p);return [p,source.inputs[p].sha256];}));
  const testnet=await rawJson(resolve(root,"docs/deployments/testnet.json"));assert.equal(testnet.mode,"testnet");assert.equal(testnet.chainId,1952);assert.equal(testnet.genLayerChainId,61999);
  const database=await rawJson(resolve(root,"docs/deployments/mainnet-database-preparation.json"));assert.equal(database.database,"intentguard_mainnet");assert.equal(database.financialRecords,0);assert.equal(database.identityBound,false);assert.equal(database.spendingEnabled,false);
  return {tapeKitCommit:verified.tapeKitCommit,pinsSha256:verified.pinsSha256,tapeKitSources:PINS.tapeKit.files,circuit:{netlistSha256:verified.netlistSha256,gateCount:metadata.gateCount,inputBits:metadata.inputBits,outputBits:metadata.outputBits,bytes:metadata.bytes,inputs:inputs(["circuits/policy.mjs","circuits/artifacts/policy.netlist.bin","circuits/artifacts/policy.metadata.json"])},vendor:{inputs:inputs(["contracts/evm/src/vendor/interfaces/ICPU.sol","contracts/evm/src/vendor/lib/NetlistVM.sol","contracts/evm/src/vendor/README.md"]),auditClaim:false,scope:"Unmodified mirrored TapeOut oracle sources plus official TapeKit configuration/runtime pins; no third-party source audit claim."},reviewer:{version:4,inputs:inputs(["contracts/genlayer/versions/purchase_reviewer_v4.py","contracts/genlayer/versions/purchase_reviewer_v4.schema.json","contracts/genlayer/versions/purchase_reviewer_v4.audit.json","contracts/genlayer/permission_interpreter.py","contracts/genlayer/permission_interpreter.schema.json","contracts/genlayer/versions/permission_interpreter_v2.py","contracts/genlayer/versions/permission_interpreter_v2.schema.json"]),review:{...REVIEW},deployedReviewer:null,liveFinalityVerified:false},runtime:{inputs:inputs(["apps/web/lib/config.ts","apps/web/lib/deployment-profile.ts","apps/web/lib/capabilities.ts","apps/web/lib/genlayer.ts","apps/web/lib/store.ts","apps/web/lib/database-profile.ts",".github/workflows/worker-mainnet.yml",".github/workflows/worker.yml","Dockerfile","pnpm-lock.yaml","pnpm-workspace.yaml"]),databaseName:"intentguard_mainnet",databasePreparationSha256:source.inputs["docs/deployments/mainnet-database-preparation.json"].sha256,databaseIdentityBound:false,financialRecords:0,workersEnabled:false},preservedTestnet:{path:"docs/deployments/testnet.json",sha256:source.inputs["docs/deployments/testnet.json"].sha256,paymentChainId:1952,reviewChainId:61999,processor:testnet.processor,factoryAddress:testnet.factoryAddress,newMainnetOverrides:false},sourceProvenanceScope:"Current source bytes and actual private compiler artifacts; final mode requires clean source. Generated release reports are excluded to avoid recursive hashing."};
}

export async function inspectFrontend(manifestPath,{source,root=ROOT}={}) {
  const m=await rawJson(resolve(root,manifestPath));assert.equal(m.status,"PREPARED_NOT_HOSTED");assert.equal(m.paymentEnvironment,"mainnet", "Only a mainnet static artifact can enter a mainnet quote");assert.equal(m.paymentChainId,196);assert.equal(m.reviewEnvironment,"testnet");assert.equal(m.reviewNetwork,"studionet");assert.equal(m.reviewChainId,61999);assert.equal(m.sourceCommit,source.commit,"Frontend commit mismatch");
  assert.equal(typeof m.sourceDirty,"boolean","Frontend dirty source state missing");assert.equal(m.serverRoutesIncluded,false,"Frontend server routes cannot enter a static quote");
  for(const name of ["apiOrigin","frontendOrigin"]) { const u=new URL(m[name]);assert.equal(u.protocol,"https:","Frontend quote requires HTTPS origins");assert.equal(u.origin,m[name],"Frontend quote requires canonical origins"); }
  assert.ok(m.sourceInputs&&typeof m.sourceInputs==="object"&&!Array.isArray(m.sourceInputs),"Frontend source inputs missing");
  assert.equal(m.sourceTreeSha256,hash(JSON.stringify(m.sourceInputs)),"Frontend source tree hash mismatch");
  const expected=Object.keys(source.inputs).filter(path=>FRONTEND_INPUT_FILES.includes(path)||path.startsWith("packages/shared/")||path.startsWith("apps/web/components/")||path.startsWith("apps/web/public/")||(path.startsWith("apps/web/app/")&&!/^apps\/web\/app\/(api|explorer\/transactions)(?:\/|$)/.test(path))).sort();
  assert.deepEqual(Object.keys(m.sourceInputs).sort(),expected,"Frontend input inventory mismatch");for(const path of FRONTEND_INPUT_FILES)assert.ok(m.sourceInputs[path],"Required frontend input missing: "+path);
  for(const[path,input]of Object.entries(m.sourceInputs)){sha(input,"Frontend input digest");assert.equal(input,source.inputs[path]?.sha256,"Frontend source bytes mismatch: "+path);}
  const directory=resolve(root,manifestPath,"../out");const bundle=await scanBundle(directory,{fallback:m.bundle.fallback,apiOrigins:m.bundle.apiOrigins});assert.deepEqual(bundle,m.bundle,"Static bundle changed");
  return {manifestPath:withinRoot(manifestPath,root),manifestSha256:hash(await regularBytes(resolve(root,manifestPath))),sourceCommit:m.sourceCommit,sourceDirty:m.sourceDirty,apiOrigin:m.apiOrigin,frontendOrigin:m.frontendOrigin,bundle,published:false};
}

export async function prepareRelease({root=ROOT,forgeBin=process.env.INTENTGUARD_FOUNDRY_BIN??"forge",final=false,skipCompile=false,frontendManifest=null,rpc=new StrictReadOnlyRpc()}={}) {
  const source=await captureSource({root,final}),chain=await toolchain({root,forgeBin});if(final)assert.equal(chain.matchesPins,true,"Final release requires exact reviewed toolchain");
  const build=skipCompile?await collectCompiled({root}):await compileContracts({root,forgeBin});const provenance=await collectProvenance({source,root});const failures=[];
  let protocol=null,gasPriceWei=null,simulations=[],reviewObservation=null,frontend=null;
  try { protocol=await observeProtocol(rpc); } catch(e) { failures.push({dependency:"official-TapeOut-mainnet",status:"UNRESOLVED",reason:String(e.message).slice(0,240)}); }
  if(protocol)try { gasPriceWei=quantity(await rpc.request("eth_gasPrice",[])).toString(); }catch(e) { failures.push({dependency:"mainnet-gas-price-quorum",status:"UNRESOLVED",reason:String(e.message).slice(0,240)}); }
  if(protocol&&gasPriceWei!==null)simulations=await simulateTransactions(rpc,{source,build,protocol,root,gasPriceWei});
  try { reviewObservation=await observeReview(); }catch(e) { failures.push({dependency:"Studionet-testnet-identity",status:"UNRESOLVED",reason:String(e.message).slice(0,240)}); }
  if(frontendManifest)try { frontend=await inspectFrontend(frontendManifest,{source,root}); }catch(e) { failures.push({dependency:"mainnet-static-bundle",status:"UNRESOLVED",reason:String(e.message).slice(0,240)}); }
  const now=Date.now();if(protocol)validateSnapshot(protocol,{now});
  const quote=quoteBody({source,build,protocol,gasPriceWei,simulations,reviewObservation,frontend,failures,now});
  const preparation=makePreparation({source,build,toolchain:chain,provenance,quote,now});
  const current=await captureSource({root,final});validatePreparation(preparation,{currentSource:current,compiled:build,final});validateQuote(quote,{source,build,preparation});
  await saveArtifacts(preparation,quote,{root});await atomicJson(resolve(root,PRIVATE_DIR,"rpc-observations.json"),{version:1,sourceCommit:source.commit,sourceTreeSha256:source.treeSha256,observedAt:new Date(now).toISOString(),quoteHash:quote.quoteHash,endpointOperators:[...rpc.urls],observations:rpc.observations??[],signatures:0,broadcasts:0});
  return {preparation,quote};
}

export async function main(args=process.argv.slice(2)) {
  assert.equal(args[0],"prepare","Only read-only prepare exists; no deploy, sign or send command");
  const options={};const seen=new Set();
  for(let i=1;i<args.length;i++) { const key=args[i];assert.ok(!seen.has(key),"Duplicate option");seen.add(key);
    if(key==="--final")options.final=true;else if(key==="--skip-compile")options.skipCompile=true;
    else if(key==="--forge-bin"||key==="--frontend-manifest") { assert.ok(args[i+1]&&!args[i+1].startsWith("--"),"Missing option value");options[key==="--forge-bin"?"forgeBin":"frontendManifest"]=args[++i]; }
    else throw Error("Unsupported option: "+key);
  }
  const {preparation,quote}=await prepareRelease(options);
  console.log(JSON.stringify({status:preparation.status,sourceCommit:preparation.source.commit,sourceDirty:preparation.source.sourceDirty,preparationHash:preparation.preparationHash,quoteHash:quote.quoteHash,quoteStatus:quote.status,knownFeesWei:quote.economics.knownFeesWei,estimatedGasCostWei:quote.economics.estimatedGasCostWei,unresolvedCosts:quote.costs.filter(c=>c.estimatedGas===null).map(c=>c.id),spendingCapRequired:true,signatures:0,broadcasts:0}));
}
