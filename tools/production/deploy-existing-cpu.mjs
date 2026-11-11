import assert from "node:assert/strict";
import {loadEnvFile as loadPrivateEnv} from "node:process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {encodeFunctionData, parseAbi, keccak256, toHex, formatEther, decodeEventLog} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {ROOT, PINS, ABI, ZERO, BEACON_SLOT, IMPL_SLOT, slotAddress, hash, digest, regularBytes, verifySources, quantity} from "../hosting/protocol.mjs";
import {captureSource, collectCompiled, rawJson} from "./release-plan.mjs";
import {DeploymentRpc, DeploymentJournal, atomicPrivateJson, validateSigned, verifyStageOutcome} from "./mainnet-deploy.mjs";
import {cpuVectors, independentOutput} from "./verify-release-live.mjs";
import {packInputs} from "../../circuits/policy.mjs";

export const STEPS=Object.freeze(["mintTransistors","tapeout","deployUSDCFactory","deployUSDT0Factory"]);
const EXTRA=parseAbi(["function supplyCap() view returns(uint256)","function minted() view returns(uint256)","function eval(uint256,bytes) view returns(bytes)","event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)"]);
const serial=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==="bigint"?v.toString():v));
const decimal=value=>{assert.match(value??"",/^(0|[1-9][0-9]*)$/);return BigInt(value);};
const canonicalAddress=value=>{assert.match(value??"",/^0x[0-9a-f]{40}$/);assert.notEqual(value,ZERO);return value;};
const sha=value=>{assert.match(value??"",/^[0-9a-f]{64}$/);return value;};

export function validateBudgetAuthority(scope){
 assert.equal(scope.version,1);assert.equal(scope.kind,"user-budget-authorized-existing-cpu-deployment");
 assert.equal(scope.chainId,196);canonicalAddress(scope.deployer);assert.equal(scope.approvedBy,"user");
 assert.ok(scope.authorizationReference?.includes("Use an existing official CPU within the OKB budget"),"Actual user budget selection is required");
 assert.equal(scope.maximumNativeWei,"4700000000000000","This deployment is limited to the user's 0.0047 OKB budget");
 assert.equal(scope.maximumTokenSpend,"0");assert.deepEqual(scope.steps,STEPS);
 assert.match(scope.sourceCommit??"",/^[0-9a-f]{40}$/);sha(scope.sourceTreeSha256);sha(scope.proofSha256);
 assert.ok(decimal(scope.gasPriceCeilingWei)>0n&&decimal(scope.gasPriceCeilingWei)<=30000000n);
 assert.ok(scope.proofPath?.startsWith(".local/")&&!scope.proofPath.includes(".."));
 return scope;
}

export function budgetCommitment(journal){
 let total=0n;
 for(const [stage,row]of Object.entries(journal.entries??{})){
  assert.ok(STEPS.includes(stage),"Unknown journal stage");
  total+=decimal(row.status==="VERIFIED"||row.status==="REVERTED"?row.actualCostWei:row.quote.maximumCostWei);
 }
 return total;
}
export function enforceBudget(scope,journal,nextMaximumWei){
 validateBudgetAuthority(scope);const total=budgetCommitment(journal)+decimal(String(nextMaximumWei));
 assert.ok(total<=decimal(scope.maximumNativeWei),"Total deployment commitment exceeds the user budget");return total;
}
export function sealStageQuote(body){
 assert.equal(body.transaction.chainId,196,"The quote must bind the X Layer signing chain");
 const result={...body,chainId:body.transaction.chainId};return {...result,quoteSha256:digest(result)};
}
async function validateScopedQuote(scope,proof,build,q){
 assert.ok(STEPS.includes(q.stage));assert.equal(q.chainId,196);assert.equal(q.scopeSha256,digest(scope));assert.equal(q.sourceCommit,scope.sourceCommit);assert.equal(q.sourceTreeSha256,scope.sourceTreeSha256);
 const {quoteSha256,...body}=q;assert.equal(quoteSha256,digest(body));
 const tx=q.transaction;assert.equal(tx.sender,scope.deployer);assert.equal(tx.chainId,196);assert.equal(tx.type,"legacy");
 assert.ok(decimal(tx.nonce)<=BigInt(Number.MAX_SAFE_INTEGER));assert.ok(decimal(tx.gasLimit)>0n);assert.ok(decimal(tx.gasPriceWei)>0n&&decimal(tx.gasPriceWei)<=decimal(scope.gasPriceCeilingWei));
 assert.equal(q.maximumCostWei,(decimal(tx.valueWei)+decimal(tx.gasLimit)*decimal(tx.gasPriceWei)).toString());
 if(q.stage==="mintTransistors"){
  const amount=decimal(q.operation.amount);assert.ok(amount>0n&&amount<=1766n);assert.equal(decimal(q.operation.heldBefore)+amount,1766n);
  assert.equal(tx.to,proof.transistors);assert.equal(q.operation.transistors,proof.transistors);assert.equal(q.operation.processor,proof.processor);
  assert.equal(tx.data,encodeFunctionData({abi:ABI,functionName:"mint",args:[0n,amount]}));
 }else if(q.stage==="tapeout"){
  const bytes=await regularBytes(resolve(ROOT,"circuits/artifacts/policy.netlist.bin"));
  assert.equal(tx.to,proof.processor);assert.equal(q.operation.processor,proof.processor);assert.equal(q.operation.cpuIndex,proof.cpuIndex);assert.equal(q.operation.netlistSha256,hash(bytes));
  assert.equal(tx.data,encodeFunctionData({abi:ABI,functionName:"tapeout",args:[toHex(bytes),451,8]}));
 }else{
  const contract=q.stage==="deployUSDCFactory"?"CctpCardFactoryV4":"MainnetUsdt0CardFactory";
  const compiled=build.contracts.find(value=>value.name===contract),artifact=await rawJson(resolve(ROOT,compiled.artifactPath));
  assert.equal(tx.to,null);assert.equal(tx.valueWei,"0");assert.equal(q.operation.contract,contract);assert.equal(q.operation.creationSha256,compiled.creationSha256);assert.equal(tx.data,artifact.bytecode.object);
 }
}

async function frozenCPU(rpc,proof,block){
 assert.equal(proof.kind,"verified-existing-official-cpu");assert.equal(proof.verifiedSourceRecompiled,true);
 canonicalAddress(proof.processor);canonicalAddress(proof.transistors);decimal(proof.cpuIndex);
 assert.equal(proof.circuitBeacon,PINS.contracts.beacon);assert.equal(proof.circuitImplementation,PINS.contracts.circuitImplementation);
 assert.equal(proof.transistorBeacon,"0x1059ad62cabb6a6925bb65aa617300556c60a51b");
 assert.equal(proof.transistorImplementation,"0x265bf10fab9ddec0ee0a649c6b9db845f1b9a06b");
 for(const [target,pin]of [[proof.processor,proof.processorRuntimeSha256],[proof.transistors,proof.transistorRuntimeSha256],[proof.circuitBeacon,PINS.codeSha256[PINS.contracts.beacon]],[proof.circuitImplementation,PINS.codeSha256[PINS.contracts.circuitImplementation]],[proof.transistorImplementation,proof.transistorImplementationSha256]]){
  const code=await rpc.request("eth_getCode",[target,block.number]);assert.equal(hash(Buffer.from(code.slice(2),"hex")),sha(pin),"Immutable dependency runtime changed");
 }
 assert.equal(slotAddress(await rpc.request("eth_getStorageAt",[proof.processor,BEACON_SLOT,block.number])),proof.circuitBeacon);
 assert.equal(slotAddress(await rpc.request("eth_getStorageAt",[proof.transistors,BEACON_SLOT,block.number])),proof.transistorBeacon);
 for(const [beacon,implementation]of [[proof.circuitBeacon,proof.circuitImplementation],[proof.transistorBeacon,proof.transistorImplementation]]){
  assert.equal((await rpc.call(beacon,"owner",[],block.number)).toLowerCase(),ZERO,"Processor beacon must be ownerless");
  assert.equal((await rpc.call(beacon,"implementation",[],block.number)).toLowerCase(),implementation);
 }
 assert.equal((await rpc.call(proof.processor,"transistors",[],block.number)).toLowerCase(),proof.transistors);
 const creation=proof.creation,receipt=await rpc.request("eth_getTransactionReceipt",[creation.transactionHash]);
 assert.equal(receipt.status,"0x1");assert.equal(receipt.blockHash,creation.blockHash);assert.equal(receipt.to.toLowerCase(),PINS.contracts.factory);
 assert.equal(slotAddress(await rpc.request("eth_getStorageAt",[PINS.contracts.factory,IMPL_SLOT,creation.blockNumber])),PINS.contracts.factoryImplementation);
 assert.equal((await rpc.call(PINS.contracts.factory,"cpuAt",[decimal(proof.cpuIndex)],creation.blockNumber)).toLowerCase(),proof.processor);
 assert.equal((await rpc.call(PINS.contracts.factory,"cpuAt",[decimal(proof.cpuIndex)],block.number)).toLowerCase(),proof.processor);
 assert.equal(await rpc.call(PINS.contracts.factory,"isCPU",[proof.processor],block.number),true);
 const eventAbi=parseAbi(["event CPUCreated(address indexed circuits,address indexed transistors,address indexed creator,string name,uint256 supply,uint256 mintPrice)"]);
 const events=receipt.logs.filter(log=>log.address.toLowerCase()===PINS.contracts.factory).flatMap(log=>{try{return [decodeEventLog({abi:eventAbi,data:log.data,topics:log.topics})];}catch{return [];}}).filter(event=>event.eventName==="CPUCreated"&&event.args.circuits.toLowerCase()===proof.processor);
 assert.equal(events.length,1);assert.equal(events[0].args.transistors.toLowerCase(),proof.transistors);
 return proof;
}

async function sourceCheck(scope){
 const source=await captureSource({final:true});assert.equal(source.commit,scope.sourceCommit);assert.equal(source.treeSha256,scope.sourceTreeSha256);
 await verifySources();return source;
}
async function operation(stage,{rpc,scope,proof,build,block,journal}){
 assert.ok(STEPS.includes(stage));const sender=scope.deployer;
 if(stage==="mintTransistors"){
  const held=await rpc.call(proof.transistors,"balanceOf",[sender,0n],block.number),amount=1766n-held;
  assert.ok(amount>0n&&amount<=1766n,"Mint only the required NAND deficit");
  const cap=await rpc.call(proof.transistors,"supplyCap",[],block.number,EXTRA),minted=await rpc.call(proof.transistors,"minted",[],block.number,EXTRA);
  assert.ok(cap-minted>=amount,"Insufficient remaining CPU transistor supply");
  const price=await rpc.call(proof.transistors,"mintPrice",[],block.number),fee=await rpc.call(proof.transistors,"protocolFee",[],block.number);
  return {to:proof.transistors,data:encodeFunctionData({abi:ABI,functionName:"mint",args:[0n,amount]}),valueWei:(price*amount+fee).toString(),operation:{processor:proof.processor,transistors:proof.transistors,amount:amount.toString(),heldBefore:held.toString()}};
 }
 if(stage==="tapeout"){
  assert.equal(journal.entries.mintTransistors?.status,"VERIFIED","Verify the NAND mint receipt before tapeout");
  assert.ok(await rpc.call(proof.transistors,"balanceOf",[sender,0n],block.number)>=1766n);
  const bytes=await regularBytes(resolve(ROOT,"circuits/artifacts/policy.netlist.bin"));
  const netlistSha256=hash(bytes);assert.equal(netlistSha256,PINS.artifacts["circuits/artifacts/policy.netlist.bin"]);
  return {to:proof.processor,data:encodeFunctionData({abi:ABI,functionName:"tapeout",args:[toHex(bytes),451,8]}),valueWei:(await rpc.call(proof.processor,"TAPEOUT_FEE",[],block.number)).toString(),operation:{processor:proof.processor,cpuIndex:proof.cpuIndex,netlistSha256}};
 }
 const name=stage==="deployUSDCFactory"?"CctpCardFactoryV4":"MainnetUsdt0CardFactory";
 const compiled=build.contracts.find(value=>value.name===name);assert.ok(compiled);
 const artifact=await rawJson(resolve(ROOT,compiled.artifactPath));
 return {to:null,data:artifact.bytecode.object,valueWei:"0",operation:{contract:name,creationSha256:compiled.creationSha256}};
}

async function quote(stage,context){
 const {rpc,scope,journal}=context,block=await rpc.pin();await sourceCheck(scope);await frozenCPU(rpc,context.proof,block);
 const op=await operation(stage,{...context,block});
 const nonce=quantity(await rpc.request("eth_getTransactionCount",[scope.deployer,"pending"]));
 const call={from:scope.deployer,data:op.data,value:toHex(decimal(op.valueWei))};if(op.to)call.to=op.to;
 await rpc.request("eth_call",[call,block.number]);
 const gas=quantity(await rpc.request("eth_estimateGas",[call,block.number]));
 const prices=await Promise.all(rpc.urls.map(async url=>quantity(await rpc.single(url,"eth_gasPrice",[]))));
 const gasPrice=prices.reduce((a,b)=>a>b?a:b);assert.ok(gasPrice<=decimal(scope.gasPriceCeilingWei),"Current gas price exceeds the bounded ceiling");
 const gasLimit=gas*125n/100n+50000n;
 const transaction={sender:scope.deployer,to:op.to,data:op.data,valueWei:op.valueWei,nonce:nonce.toString(),gasLimit:gasLimit.toString(),gasPriceWei:gasPrice.toString(),type:"legacy",chainId:196};
 const maximumCostWei=(decimal(op.valueWei)+gasLimit*gasPrice).toString();enforceBudget(scope,journal,maximumCostWei);
 assert.ok(quantity(await rpc.request("eth_getBalance",[scope.deployer,block.number]))>=decimal(maximumCostWei),"Insufficient deployer balance");
 const quotedAt=Date.now();const result={version:1,kind:"budget-bound-existing-cpu-stage",scopeSha256:digest(scope),sourceCommit:scope.sourceCommit,sourceTreeSha256:scope.sourceTreeSha256,stage,operation:op.operation,transaction,block,quotedAt,expiresAt:quotedAt+300000,maximumCostWei};
 return sealStageQuote(result);
}

async function receiptOutcome(rpc,row){
 await validateSigned(row.raw,row.quote);assert.equal(keccak256(row.raw),row.transactionHash);
 const receipt=await rpc.request("eth_getTransactionReceipt",[row.transactionHash]);if(!receipt)return null;
 const block=await rpc.pin();if(quantity(block.number)-quantity(receipt.blockNumber)<1n)return null;
 assert.equal((await rpc.request("eth_getBlockByNumber",[receipt.blockNumber,false])).hash,receipt.blockHash,"Receipt block reorged");
 assert.equal(receipt.from.toLowerCase(),row.quote.transaction.sender);
 assert.equal(receipt.to?.toLowerCase()??null,row.quote.transaction.to);
 const actualCostWei=(quantity(receipt.gasUsed)*quantity(receipt.effectiveGasPrice)+decimal(row.quote.transaction.valueWei)).toString();
 assert.ok(decimal(actualCostWei)<=decimal(row.quote.maximumCostWei));
 if(receipt.status!=="0x1")return {status:"REVERTED",actualCostWei,receiptBlock:receipt.blockNumber};
 const output=await verifyStageOutcome(rpc,row.quote,receipt,receipt.blockNumber);
 if(row.quote.stage==="mintTransistors"){
  const minted=receipt.logs.filter(log=>log.address.toLowerCase()===row.quote.operation.transistors).flatMap(log=>{try{return [decodeEventLog({abi:EXTRA,data:log.data,topics:log.topics})];}catch{return [];}}).filter(event=>event.eventName==="TransferSingle"&&event.args.from.toLowerCase()===ZERO&&event.args.to.toLowerCase()===row.quote.transaction.sender&&event.args.id===0n);
  assert.equal(minted.length,1);assert.equal(minted[0].args.value,decimal(row.quote.operation.amount));
 }
 return {status:"VERIFIED",actualCostWei,receiptBlock:receipt.blockNumber,receiptBlockHash:receipt.blockHash,output:serial(output)};
}

async function vectors(rpc,proof,circuit){
 const block=await rpc.pin();await frozenCPU(rpc,proof,block);
 const cases=cpuVectors(),results=[];assert.equal(cases.length,490);
 for(let offset=0;offset<cases.length;offset+=4){
  const batch=await Promise.all(cases.slice(offset,offset+4).map(async input=>{
   const packed=toHex(packInputs(input)),output=await rpc.call(proof.processor,"eval",[decimal(circuit.circuitId),packed],block.number,EXTRA);
   const expected="0x"+independentOutput(input).toString(16).padStart(2,"0");assert.equal(output.toLowerCase(),expected);
   return {inputSha256:hash(Buffer.from(packed.slice(2),"hex")),output:expected};
  }));results.push(...batch);if(results.length%100===0)console.log("LIVE_VECTORS",results.length);
 }
 assert.equal((await rpc.request("eth_getBlockByNumber",[block.number,false])).hash,block.hash);
 return {liveVectors:results.length,resultsSha256:digest(results),block,providers:rpc.urls};
}

export async function main(args=process.argv.slice(2)){
 const [command,path,flag]=args;assert.ok(["plan","execute","verify"].includes(command));assert.ok(path);
 if(command==="execute")assert.equal(flag,"--broadcast");else assert.equal(flag,undefined);
 const scope=validateBudgetAuthority(await rawJson(resolve(path))),scopeSha256=digest(scope);
 await sourceCheck(scope);const proofBytes=await regularBytes(resolve(ROOT,scope.proofPath));assert.equal(hash(proofBytes),scope.proofSha256);
 const proof=JSON.parse(proofBytes.toString("utf8")),build=await collectCompiled();
 const rpc=new DeploymentRpc({fetchImpl:async(...fetchArgs)=>{let last;for(let i=0;i<3;i++){try{return await fetch(...fetchArgs);}catch(e){last=e;}}throw last;}});
 const journal=new DeploymentJournal(resolve(ROOT,".local/existing-cpu-deployment",scopeSha256,"journal.json"),scopeSha256);
 await journal.withLock(async()=>{
  const state=await journal.load();state.scopeSha256??=scopeSha256;assert.equal(state.scopeSha256,scopeSha256);
  const context={rpc,scope,proof,build,journal:state};await frozenCPU(rpc,proof,await rpc.pin());
  for(const row of Object.values(state.entries)){
   await validateScopedQuote(scope,proof,build,row.quote);
   if(row.raw){const recovered=await receiptOutcome(rpc,row);if(recovered)Object.assign(row,recovered);else row.status="SIGNED";}
  }
  enforceBudget(scope,state,"0");
  if(command==="plan"){
   const quotes=[];for(const stage of ["mintTransistors","deployUSDCFactory","deployUSDT0Factory"])if(!state.entries[stage])quotes.push(await quote(stage,context));
   const total=quotes.reduce((sum,q)=>sum+decimal(q.maximumCostWei),0n),tapeoutFee=await rpc.call(proof.processor,"TAPEOUT_FEE",[],(await rpc.pin()).number);
   enforceBudget(scope,state,total+tapeoutFee);
   const plan={scopeSha256,sourceCommit:scope.sourceCommit,deployer:scope.deployer,cpuIndex:proof.cpuIndex,processor:proof.processor,maximumNativeOKB:formatEther(decimal(scope.maximumNativeWei)),quotedStages:quotes.map(q=>({stage:q.stage,maximumNativeOKB:formatEther(decimal(q.maximumCostWei)),quoteSha256:q.quoteSha256})),knownTapeoutFeeOKB:formatEther(tapeoutFee),remainingForTapeoutGasOKB:formatEther(decimal(scope.maximumNativeWei)-budgetCommitment(state)-total-tapeoutFee)};
   await atomicPrivateJson(resolve(ROOT,".local/existing-cpu-plan.json"),plan);console.log(JSON.stringify(plan,null,2));return;
  }
  if(command==="execute"){
   assert.ok(scope.credentialPath?.endsWith("/signer.env"));await regularBytes(scope.credentialPath);loadPrivateEnv(scope.credentialPath);
   const account=privateKeyToAccount(process.env.INTENTGUARD_MAINNET_DEPLOYER_PRIVATE_KEY);assert.equal(account.address.toLowerCase(),scope.deployer);
   for(const stage of STEPS){
    let row=state.entries[stage];
    if(!row){
     const q=await quote(stage,context);console.log("PREPARED",stage,"maximum OKB",formatEther(decimal(q.maximumCostWei)));
     row=state.entries[stage]={status:"INTENT",quote:q};await journal.save(state);
    }
    await validateScopedQuote(scope,proof,build,row.quote);enforceBudget(scope,state,"0");
    if(!row.raw){
     assert.ok(Date.now()<row.quote.expiresAt);await sourceCheck(scope);const currentBlock=await rpc.pin();await frozenCPU(rpc,proof,currentBlock);
     assert.equal(quantity(await rpc.request("eth_getTransactionCount",[scope.deployer,"pending"])),decimal(row.quote.transaction.nonce));
     const tx=row.quote.transaction;
     const current=await operation(stage,{...context,block:currentBlock});assert.equal(current.to,tx.to);assert.equal(current.data,tx.data);assert.equal(current.valueWei,tx.valueWei);assert.deepEqual(current.operation,row.quote.operation);
     const call={from:scope.deployer,data:tx.data,value:toHex(decimal(tx.valueWei))};if(tx.to)call.to=tx.to;
     await rpc.request("eth_call",[call,currentBlock.number]);const estimate=quantity(await rpc.request("eth_estimateGas",[call,currentBlock.number]));
     assert.ok(estimate<=decimal(tx.gasLimit)&&decimal(tx.gasLimit)<=estimate*2n+50000n);
     const currentPrices=await Promise.all(rpc.urls.map(async url=>quantity(await rpc.single(url,"eth_gasPrice",[]))));assert.ok(currentPrices.every(price=>price<=decimal(tx.gasPriceWei)));
     assert.ok(quantity(await rpc.request("eth_getBalance",[scope.deployer,currentBlock.number]))>=decimal(row.quote.maximumCostWei));
     row.raw=await account.signTransaction({type:"legacy",chainId:196,to:tx.to??undefined,data:tx.data,value:decimal(tx.valueWei),nonce:Number(tx.nonce),gas:decimal(tx.gasLimit),gasPrice:decimal(tx.gasPriceWei)});
     row.transactionHash=await validateSigned(row.raw,row.quote);row.status="SIGNED";await journal.save(state);
    }
    let outcome=await receiptOutcome(rpc,row);
    if(!outcome){
     if(!await rpc.request("eth_getTransactionByHash",[row.transactionHash]))await rpc.broadcast(row.raw);
     row.status="PENDING";await journal.save(state);console.log("BROADCAST",stage,row.transactionHash);
     const deadline=Date.now()+120000;
     while(!outcome&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,2000));outcome=await receiptOutcome(rpc,row);}
     assert.ok(outcome,"Receipt is pending; resume this exact journal without replacement");
    }
    Object.assign(row,outcome);await journal.save(state);assert.equal(row.status,"VERIFIED","Deployment transaction reverted; no further spending allowed");
    console.log("VERIFIED",stage,row.transactionHash,JSON.stringify(row.output));
   }
  }
  for(const stage of STEPS){assert.ok(state.entries[stage]?.raw,"Required transaction missing");const verified=await receiptOutcome(rpc,state.entries[stage]);assert.equal(verified?.status,"VERIFIED");assert.deepEqual(verified.output,state.entries[stage].output);}
  const circuit=state.entries.tapeout.output;
  const numerical=await vectors(rpc,proof,circuit);
  const balance=quantity(await rpc.request("eth_getBalance",[scope.deployer,(await rpc.pin()).number]));
  const result={version:1,kind:"verified-mainnet-contracts-and-existing-cpu-circuit",sourceCommit:scope.sourceCommit,sourceTreeSha256:scope.sourceTreeSha256,scopeSha256,chainId:196,deployer:scope.deployer,cpuIndex:proof.cpuIndex,processor:proof.processor,circuitId:circuit.circuitId,owner:scope.deployer,netlistSha256:circuit.netlistSha256,contracts:{USDC:state.entries.deployUSDCFactory.output,USDT0:state.entries.deployUSDT0Factory.output},transactions:Object.fromEntries(STEPS.map(stage=>[stage,{hash:state.entries[stage].transactionHash,actualCostOKB:formatEther(decimal(state.entries[stage].actualCostWei))}])),totalSpentOKB:formatEther(budgetCommitment(state)),remainingBalanceOKB:formatEther(balance),numerical,applicationActivation:false};
  await atomicPrivateJson(resolve(ROOT,".local/existing-cpu-report.json"),result);console.log(JSON.stringify(result,null,2));console.log("MAINNET_CONTRACTS_AND_CIRCUIT_VERIFIED");
 });
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{await main();}catch(error){console.error("Existing CPU deployment stopped:",error.message);process.exitCode=1;}}
