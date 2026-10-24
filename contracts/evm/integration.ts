import assert from "node:assert/strict";
import {spawn, type ChildProcess} from "node:child_process";
import {randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {createServer} from "node:net";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createPublicClient,createWalletClient,createTestClient,decodeEventLog,defineChain,http,toHex,type Abi,type Address,type Hex} from "viem";
import {generatePrivateKey,privateKeyToAccount} from "viem/accounts";
import {Evm,activationConfig} from "../../apps/web/lib/evm";
import {MemoryStore} from "../../apps/web/lib/store";
import type {Card,Payment} from "../../apps/web/lib/models";
import {digest,parseAmount,contentDigest,policySchema,type Policy,type CanonicalRequest,type ReviewDecision} from "../../packages/shared";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
type Artifact={abi:Abi;bytecode:{object:Hex}};
const artifact=(name:string,source=name):Artifact=>JSON.parse(readFileSync(resolve(root,"contracts/evm/out",source+".sol",name+".json"),"utf8"));
const hash=()=>toHex(randomBytes(32));
const pause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
async function availablePort(){const server=createServer();await new Promise<void>((r,j)=>{server.once("error",j);server.listen(0,"127.0.0.1",r)});const port=(server.address() as {port:number}).port;await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));return port;}
async function stop(child:ChildProcess){if(child.exitCode!==null)return;child.kill("SIGTERM");await Promise.race([new Promise<void>(r=>child.once("exit",()=>r())),pause(1500)]);if(child.exitCode===null)child.kill("SIGKILL");}

/** Real EVM adapter integration on a private ephemeral chain. GenLayer's finalized
 * decision is a labelled test fixture; this never claims foreign-chain finality. */
export type IntegrationContext={evm:Evm;store:MemoryStore;createCard:(policy:Policy)=>Promise<Card>;fund:(address:string,amount:string)=>Promise<void>;balance:(recipient:string)=>Promise<bigint>};
export async function runEvmIntegration(extra?:(context:IntegrationContext)=>Promise<void>){
 const started=Date.now(),port=await availablePort(),rpcUrl="http://127.0.0.1:"+port;
 const chain=defineChain({id:31337,name:"IntentGuard isolated integration",nativeCurrency:{name:"Test ETH",symbol:"ETH",decimals:18},rpcUrls:{default:{http:[rpcUrl]}}});
 const accounts=Array.from({length:4},()=>privateKeyToAccount(generatePrivateKey()));
 const [owner,gateway,attestor,merchant]=accounts;
 const gatewayKey=generatePrivateKey(),attestorKey=generatePrivateKey();
 const gatewaySigner=privateKeyToAccount(gatewayKey),attestorSigner=privateKeyToAccount(attestorKey);
 // Anvil keys are never exported. Only fresh in-process test keys are used.
 const child=spawn("anvil",["--host","127.0.0.1","--port",String(port),"--chain-id","31337","--mnemonic-random","--block-time","0.2","--gas-limit","30000000","--quiet"],{stdio:"ignore"});
 let launchError:Error|undefined;child.once("error",e=>{launchError=e});
 const transport=http(rpcUrl,{timeout:10000,retryCount:0});
 const publicClient=createPublicClient({chain,transport,pollingInterval:100,cacheTime:0});
 const testClient=createTestClient({chain,transport,mode:"anvil"});
 const ownerWallet=createWalletClient({chain,transport,account:owner});
 const envKeys=["INTENTGUARD_MODE","XLAYER_CHAIN_ID","XLAYER_RPC_URL","PAYMENT_TOKEN","CARD_FACTORY_ADDRESS","GATEWAY_ADDRESS","ATTESTOR_ADDRESS","TAPEOUT_PROCESSOR","TAPEOUT_CIRCUIT_ID","TAPEOUT_BEACON","TAPEOUT_IMPLEMENTATION","TAPEOUT_NETLIST_HASH","GENLAYER_INTERPRETER_ADDRESS","MONGODB_URI","XLAYER_OPERATOR_PRIVATE_KEY","REVIEW_ATTESTOR_PRIVATE_KEY"];
 const previous=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
 const deadline=setTimeout(()=>child.kill("SIGKILL"),55000);
 let stage="startup";
 let integrationStore:MemoryStore|undefined;
 try{
  let ready=false;
  for(let i=0;i<100;i++){if(launchError)throw launchError;if(child.exitCode!==null)throw Error("Anvil exited before startup");try{ready=await publicClient.getChainId()===31337;if(ready)break}catch{}await pause(50)}
  assert(ready,"isolated Anvil did not start");
  await testClient.setBalance({address:owner.address,value:100n*10n**18n});
  await testClient.setBalance({address:gatewaySigner.address,value:100n*10n**18n});
  const receipt=async(tx:Hex)=>{const r=await publicClient.waitForTransactionReceipt({hash:tx,timeout:15000,pollingInterval:100});assert.equal(r.status,"success");return r};
  async function deploy(name:string,args:unknown[]=[],source=name){
   const a=artifact(name,source);
   const tx=await ownerWallet.deployContract({abi:a.abi,bytecode:a.bytecode.object,args,gas:29_000_000n});
   const r=await receipt(tx);assert(r.contractAddress);return r.contractAddress;
  }
  const netlist=toHex(readFileSync(resolve(root,"circuits/artifacts/policy.netlist.bin")));
  const metadata=JSON.parse(readFileSync(resolve(root,"circuits/artifacts/policy.metadata.json"),"utf8")) as {sha256:string;gateCount:number;bytes:number};
  stage="deploy actual NAND processor";
  const processor=await deploy("LocalNandProcessor",[netlist]);
  const beacon=await deploy("LocalProcessorBeacon",[processor],"LocalNandProcessor");
  const token=await deploy("LocalTestToken"),factory=await deploy("CardFactory");
  Object.assign(process.env,{INTENTGUARD_MODE:"local",XLAYER_CHAIN_ID:"31337",XLAYER_RPC_URL:rpcUrl,PAYMENT_TOKEN:token,
   CARD_FACTORY_ADDRESS:factory,GATEWAY_ADDRESS:gatewaySigner.address,ATTESTOR_ADDRESS:attestorSigner.address,
   TAPEOUT_PROCESSOR:processor,TAPEOUT_CIRCUIT_ID:"1",TAPEOUT_BEACON:beacon,TAPEOUT_IMPLEMENTATION:processor,
   TAPEOUT_NETLIST_HASH:metadata.sha256,GENLAYER_INTERPRETER_ADDRESS:attestor.address,
   MONGODB_URI:"mongodb://127.0.0.1:1/intentguard-test-only-never-connected",XLAYER_OPERATOR_PRIVATE_KEY:gatewayKey,REVIEW_ATTESTOR_PRIVATE_KEY:attestorKey});
  const now=Number((await publicClient.getBlock()).timestamp);
  const policy:Policy=policySchema.parse({version:1,name:"Isolated circuit integration",mission:"Purchase approved test research data",taskContext:"Synthetic integration fixture",
   allowedCategories:["research"],prohibitedPurchases:["personal purchases"],exceptions:[],
   financial:{totalBudget:"100",perPaymentLimit:"40",periodBudget:"80",periodSeconds:3600,validFrom:now-60,validUntil:now+7200},
   merchants:[{name:"Test merchant",recipient:merchant.address,origins:["https://merchant.invalid"],products:["research data"]}],
   evidence:{requiredTypes:["invoice"],approvedOrigins:["https://merchant.invalid"],maxAgeSeconds:600},
   criteria:[{id:"invoice",description:"Invoice corresponds to the approved purchase"}]});
  const config=activationConfig(owner.address,policy);
  const configAbi=artifact("AgentSpendingCard").abi.find(e=>e.type==="constructor");
  assert(configAbi?.type==="constructor");
  const tuple=configAbi.inputs[0] as {components:readonly {name:string;type:string}[]};
  const typedConfig=Object.fromEntries(tuple.components.map(c=>[c.name,c.type.startsWith("uint")?BigInt((config as Record<string,unknown>)[c.name] as string):(config as Record<string,unknown>)[c.name]]));
  const factoryArtifact=artifact("CardFactory"),cardArtifact=artifact("AgentSpendingCard"),tokenArtifact=artifact("LocalTestToken");
  stage="factory card activation";
  const activationTx=await ownerWallet.writeContract({address:factory,abi:factoryArtifact.abi,functionName:"createCard",args:[typedConfig],gas:8_000_000n});
  const activationReceipt=await receipt(activationTx);
  const created=activationReceipt.logs.map(log=>{try{return decodeEventLog({abi:factoryArtifact.abi,data:log.data,topics:log.topics})}catch{return null}}).find(e=>e?.eventName==="CardCreated");
  assert(created);const cardAddress=(created.args as unknown as {card:Address}).card;
  await receipt(await ownerWallet.writeContract({address:token,abi:tokenArtifact.abi,functionName:"mint",args:[cardAddress,parseAmount("100")]}));
  await testClient.mine({blocks:2});
  const store=new MemoryStore(),evm=new Evm(store);integrationStore=store;
  // Reproduce X Layer testnet returning an older pending nonce than latest.
  const originalNonce=evm.public.getTransactionCount.bind(evm.public);
  evm.public.getTransactionCount=async args=>{const actual=await originalNonce(args);return args.blockTag==="pending"?Math.max(0,actual-1):actual};
  const card:Card={_id:hash(),owner:owner.address,draftId:"isolated-draft",address:cardAddress,activationTx,
   activationBlock:activationReceipt.blockNumber.toString(),policy,policyHash:digest(policy),state:"ACTIVE",keyStatus:"ACTIVE",reviewerAddress:attestor.address,createdAt:Date.now(),updatedAt:Date.now()};
  stage="adapter activation verification";
  assert.equal(await evm.verifyActivation(owner.address,policy,cardAddress,activationTx),activationReceipt.blockNumber.toString());
  const balance=()=>publicClient.readContract({address:token,abi:tokenArtifact.abi,functionName:"balanceOf",args:[merchant.address]}) as Promise<bigint>;
  const makePayment=(amount:string,invoiceId:string):Payment=>{
   const fetchedAt=Math.floor(Date.now()/1000),url="https://merchant.invalid/invoice/"+invoiceId;
   const input={recipient:merchant.address,amount,purchaseDescription:"Approved test research dataset",justification:"Synthetic test mission evidence",category:"research",invoiceId,evidence:[{url}]};
   const snapshots=[{url,content:'{"testOnly":true}',sha256:contentDigest('{"testOnly":true}'),fetchedAt}];
   const evidenceHash=digest(snapshots),canonical:CanonicalRequest={...input,cardId:card._id,cardAddress,owner:owner.address,policyHash:card.policyHash,token,chainId:31337,amountAtomic:parseAmount(amount).toString(),evidenceHash,expiresAt:Number((now+7200))};
   const requestHash=digest(canonical);
   const review:ReviewDecision={decision:"APPROVE",requestHash,policyHash:card.policyHash,evidenceHash,
    criteria:[{id:"invoice",status:"PASS",reason:"TEST ONLY: synthetic invoice approval",sources:[url]}],
    reason:"TEST ONLY: synthetic finalized GenLayer output; no foreign consensus performed"};
   return {_id:hash(),owner:owner.address,cardId:card._id,keyId:"isolated-key",input,inputHash:digest(input),status:"APPROVED",
    canonical,snapshots,requestHash,evidenceHash,review,genLayerTxHash:digest("TEST ONLY synthetic finalized GenLayer transaction"),
    createdAt:Date.now(),updatedAt:Date.now()};
  };
  const first=makePayment("40","invoice-once");
  const preview=await evm.preview(card,first.input,first.canonical!.expiresAt);assert.equal(preview.allow,true);
  stage="adapter initial reserve";
  const reserveTx=await evm.reserve(card,first);assert.equal((await evm.request(card,first._id)).status,1);
  const reserved=await evm.request(card,first._id);assert.equal(reserved.requestHash,first.requestHash);assert.equal(reserved.evidenceHash,first.evidenceHash);
  stage="adapter initial EIP712 settlement";
  const paymentTx=await evm.settle(card,first);assert.equal((await evm.request(card,first._id)).status,2);
  assert.equal(await balance(),parseAmount("40"));
  assert.equal(await evm.settle(card,first),paymentTx);assert.equal(await balance(),parseAmount("40"));
  assert.equal(await evm.reserve(card,first),reserveTx);assert.equal(await balance(),parseAmount("40"));
  const duplicate=makePayment("1","invoice-once");await assert.rejects(()=>evm.reserve(card,duplicate));
  const sig=await attestorSigner.signTypedData({domain:{name:"IntentGuard",version:"1",chainId:31337,verifyingContract:cardAddress},
   primaryType:"Release",types:{Release:[{name:"requestId",type:"bytes32"},{name:"requestHash",type:"bytes32"},{name:"policyHash",type:"bytes32"},
    {name:"evidenceHash",type:"bytes32"},{name:"decisionHash",type:"bytes32"},{name:"genLayerTxHash",type:"bytes32"},{name:"validUntil",type:"uint64"}]},
   message:{requestId:first._id as Hex,requestHash:first.requestHash as Hex,policyHash:card.policyHash as Hex,evidenceHash:first.evidenceHash as Hex,
    decisionHash:digest(first.review) as Hex,genLayerTxHash:first.genLayerTxHash as Hex,validUntil:BigInt(first.canonical!.expiresAt)}});
  await assert.rejects(()=>publicClient.simulateContract({address:cardAddress,abi:cardArtifact.abi,functionName:"settle",
   args:[first._id,BigInt(first.canonical!.expiresAt),digest(first.review),first.genLayerTxHash,sig],account:owner}));
  assert.equal(await balance(),parseAmount("40"));
  stage="two pending concurrency and period limits";
  const pendingA=makePayment("20","invoice-pending-a"),pendingB=makePayment("20","invoice-pending-b");
  stage="pending A reserve";await evm.reserve(card,pendingA);stage="pending B reserve";await evm.reserve(card,pendingB);
  await assert.rejects(()=>evm.reserve(card,makePayment("1","invoice-third-pending")));
  stage="pending B cancellation";await evm.cancel(card,pendingB);assert.equal((await evm.request(card,pendingB._id)).status,3);
  const overPeriod=makePayment("21","invoice-period-excess");
  assert.deepEqual((await evm.preview(card,overPeriod.input,overPeriod.canonical!.expiresAt)).failures,["Period budget"]);
  await assert.rejects(()=>evm.reserve(card,overPeriod));
  stage="pending A settlement";await evm.settle(card,pendingA);assert.equal(await balance(),parseAmount("60"));
  if(extra){
 stage="API and worker pipeline";
 await extra({evm,store,
 balance:recipient=>publicClient.readContract({address:token,abi:tokenArtifact.abi,functionName:"balanceOf",args:[recipient]}) as Promise<bigint>,
 fund:async(address,amount)=>{await receipt(await ownerWallet.writeContract({address:token,abi:tokenArtifact.abi,functionName:"mint",args:[address,parseAmount(amount)]}))},
 createCard:async p=>{
 const plain=activationConfig(owner.address,p);
 const cfg=Object.fromEntries(tuple.components.map(c=>[c.name,c.type.startsWith("uint")?BigInt((plain as Record<string,unknown>)[c.name] as string):(plain as Record<string,unknown>)[c.name]]));
 const tx=await ownerWallet.writeContract({address:factory,abi:factoryArtifact.abi,functionName:"createCard",args:[cfg],gas:8_000_000n});const r=await receipt(tx);await testClient.mine({blocks:2});
 let address:string|undefined;for(const log of r.logs){try{const event=decodeEventLog({abi:factoryArtifact.abi,data:log.data,topics:log.topics});if(event.eventName==="CardCreated")address=(event.args as unknown as {card:string}).card}catch{}}
 if(!address)throw Error("Missing pipeline card event");return {...card,_id:hash(),address,activationTx:tx,activationBlock:r.blockNumber.toString(),policy:p,policyHash:digest(p),state:"READY",keyStatus:"NONE",token,chainId:31337};
 }
 });
 }
 stage="period rollover and lifetime limits";
  await testClient.increaseTime({seconds:3600});await testClient.mine({blocks:2});
  const final=makePayment("40","invoice-next-period");await evm.reserve(card,final);
  const overTotal=makePayment("1","invoice-total-excess");
  assert.deepEqual((await evm.preview(card,overTotal.input,overTotal.canonical!.expiresAt)).failures,["Total budget"]);
  await assert.rejects(()=>evm.reserve(card,overTotal));await evm.settle(card,final);
  assert.equal(await balance(),parseAmount("100"));
  const view=await evm.view(card);assert.equal(view.balances.spent,"100");assert.equal(view.balances.reserved,"0");assert.equal(view.balances.funded,"0");
  const report={mode:"ISOLATED_LOCAL_TEST",genLayerFinality:"TEST_ONLY_SYNTHETIC_FIXTURE",chainId:31337,
   circuit:{gates:metadata.gateCount,bytes:metadata.bytes,sha256:metadata.sha256},contracts:{processor,beacon,token,factory,card:cardAddress},
   verified:["owner factory activation config","genuine TapeOut NAND eval","adapter EIP712 settlement","merchant paid exactly once per request",
    "idempotent raw transaction recovery","paid invoice rejected","signed release replay rejected","two pending requests maximum",
    "period overspend rejected","lifetime reservations across rollover rejected","exact six-decimal spent ledger"],merchantAmount:"100",
   elapsedMs:Date.now()-started};
  assert(report.elapsedMs<55000,"integration exceeded 55 seconds");
  return report;
 }catch(error){
  const transactions=await integrationStore?.find<{_id:string;hash:Hex}>("transactions",{});
  for(const tx of transactions??[]){const r=await publicClient.getTransactionReceipt({hash:tx.hash}).catch(()=>null);if(r?.status==="reverted"){const t=await publicClient.getTransaction({hash:tx.hash});console.error("Local failed transaction",JSON.stringify({operation:tx._id.split(":").at(-1),gasUsed:r.gasUsed.toString(),gasLimit:t.gas.toString()}))}}
  throw new Error("EVM integration phase "+stage+": "+(error instanceof Error?error.message:String(error)))
 }finally{clearTimeout(deadline);for(const key of envKeys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}await stop(child)}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runEvmIntegration().then(report=>{console.log(JSON.stringify(report,null,2));console.log("EVM_INTEGRATION_CHECK_PASSED")}).catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1});
}
