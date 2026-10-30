/** Journalled operator tooling for the dedicated testnet visitor release. */
import assert from "node:assert/strict";
import {loadEnvFile} from "node:process";
import {readFile,writeFile,rename,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {privateKeyToAccount} from "viem/accounts";
import {decodeFunctionData,decodeEventLog,encodeFunctionData,parseAbi,type Abi,type Address,type Hex} from "viem";
import {canonical,digest,parseAmount,policySchema} from "../packages/shared";
import {CCTP_TESTNETS} from "../packages/shared/assets";
import {database} from "../apps/web/lib/store";
import {GenLayer,assertFinalized,normalizedCalldata,genLayerAddress} from "../apps/web/lib/genlayer";
import {Evm,activationConfig} from "../apps/web/lib/evm";
import {sandboxPolicy} from "../apps/web/lib/sandbox";
import {configuration} from "../apps/web/lib/config";
import type {Draft,Job,Card} from "../apps/web/lib/models";
import artifacts from "../contracts/evm/abi.json";

for(const file of [".local/testnet-secrets.env",".local/hosting.env"])loadEnvFile(file);
const action=process.argv[2];assert.ok(["backfill","deploy-interpreter","verify-interpreter","prepare-sandbox","revise-sandbox","activate-sandbox","fund-sandbox","status"].includes(action),"Choose an explicit testnet visitor stage");
const cfg=configuration();assert.equal(cfg.mode,"testnet");assert.equal(cfg.chainId,1952);assert.notEqual(cfg.databaseName,"intentguard_mainnet");
// Operator startup has intermittent TCP timeouts from this environment. Retry
// only the idempotent connection/index preflight, before any release stage runs.
// Each failed client is closed by database(); runtime pool limits stay intact.
async function connectStore(){for(let attempt=1;attempt<=3;attempt++){try{return await database();}catch(error){if(attempt===3)throw error;console.log(JSON.stringify({stage:"database-startup",retry:attempt}));}}throw Error("Database startup failed");}
const store=await connectStore(),gl=new GenLayer(store),evm=new Evm(store),owner=privateKeyToAccount(process.env.XLAYER_OPERATOR_PRIVATE_KEY as Hex);
assert.equal(owner.address.toLowerCase(),cfg.gateway?.toLowerCase());
const statePath=".local/visitor-release/state.json",reportPath=".local/visitor-release/report.json";
await mkdir(".local/visitor-release",{recursive:true,mode:0o700});
let state:any;try{state=JSON.parse(await readFile(statePath,"utf8"));}catch(e){if((e as {code?:string}).code!=="ENOENT")throw e;state={version:1,owner:owner.address.toLowerCase(),origin:cfg.origin};}
assert.equal(state.version,1);assert.equal(state.owner,owner.address.toLowerCase());assert.equal(state.origin,cfg.origin);
async function save(){await writeFile(statePath+".tmp",JSON.stringify(state,null,2)+"\n",{mode:0o600});await rename(statePath+".tmp",statePath);const {cookie,...report}=state;await writeFile(reportPath,JSON.stringify({...report,paymentEnvironment:"testnet",paymentChainId:1952,reviewEnvironment:"testnet",reviewChainId:61999},null,2)+"\n",{mode:0o600});}
async function api(path:string,method="GET",body?:unknown){
 const response=await fetch(cfg.origin+"/api/v1"+path,{method,headers:{Origin:cfg.origin,"X-IntentGuard-Environment":"testnet","Content-Type":"application/json",...(state.cookie?{Cookie:state.cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});
 const value=await response.json();if(!response.ok)throw Error("HOSTED_"+response.status+"_"+(value.error?.code??"FAILED"));return {response,value};
}
async function authenticate(){
 if(state.cookie){const session=await api("/auth/session").catch(()=>null);if(session?.value.address===state.owner)return;}
 delete state.cookie;const {value:challenge}=await api("/auth/challenge","POST",{address:owner.address});
 const lines=challenge.message.split("\n");assert.equal(lines.length,10);
 assert.deepEqual(lines.slice(0,7),["IntentGuard owner login",new URL(cfg.origin).host,owner.address.toLowerCase(),"URI: "+cfg.origin,"API: "+cfg.origin,"Payment environment: testnet","Chain ID: 1952"]);
 // The hosted clock can lead the operator by a few seconds. The server still
 // enforces its five-minute challenge; tolerate only five seconds of skew here.
 assert.match(lines[7],/^Nonce: [a-f0-9]{48}$/);const expires=Date.parse(lines[8].replace(/^Expires: /,""));assert.ok(expires>Date.now()&&expires<=Date.now()+305000);
 assert.equal(lines[9],"This signature authorizes a dashboard session only.");
 const signature=await owner.signMessage({message:challenge.message});const {response,value}=await api("/auth/login","POST",{address:owner.address,signature});assert.equal(value.address,state.owner);
 state.cookie=response.headers.get("set-cookie")?.split(";")[0];assert.ok(state.cookie?.startsWith("ig_session="));await save();
}
async function signingLock<T>(operation:(token:string)=>Promise<T>){await store.create("locks",{_id:"worker",createdAt:Date.now()});const lock=await store.claim<Job>("locks",{_id:"worker"},Date.now(),120000);assert.ok(lock,"A worker is signing; retry this stage after its lease releases");try{return await operation(lock.leaseToken!);}finally{await store.complete("locks","worker",lock.leaseToken!,{nextAt:0});}}
try{
 if(action==="backfill"){
  const manifest=JSON.parse(await readFile("docs/deployments/testnet.json","utf8"));assert.equal(cfg.interpreter?.toLowerCase(),manifest.interpreter.toLowerCase(),"Backfill before rotating the verified legacy interpreter");
  const deployment=await gl.client.getTransaction({hash:manifest.interpreterTx});assertFinalized(deployment);assert.equal(deployment.txDataDecoded?.type,"deploy");assert.equal((deployment.txDataDecoded as any).code,await readFile("contracts/genlayer/permission_interpreter.py","utf8"));assert.equal(String(await gl.read(manifest.interpreter,"get_operator")).toLowerCase(),gl.account().address.toLowerCase());
  const rows=await store.find<Draft>("drafts",{}),targets=[];
  for(const draft of rows){if(draft.interpreterAddress)continue;if(draft.genLayerTxHash){const tx=await gl.client.getTransaction({hash:draft.genLayerTxHash as any}),call=normalizedCalldata((tx.txDataDecoded as any)?.callData) as any;assert.equal((tx.recipient??tx.to_address)?.toLowerCase(),manifest.interpreter.toLowerCase());assert.equal((tx.sender??tx.from_address)?.toLowerCase(),gl.account().address.toLowerCase());assert.equal(tx.txDataDecoded?.leaderOnly,false);assert.equal(call.method,"propose");assert.equal(canonical(call.args),canonical([draft._id,canonical(draft.input)]));assert.equal(draft.inputHash,digest(draft.input));}targets.push(draft._id);}
  for(const id of targets)await store.patch("drafts",id,{interpreterAddress:manifest.interpreter});state.legacyBackfill={interpreterAddress:manifest.interpreter,drafts:targets.length,verifiedAt:new Date().toISOString()};await save();console.log(JSON.stringify(state.legacyBackfill));
 }else if(action==="deploy-interpreter"||action==="verify-interpreter"){
  const source=await readFile("contracts/genlayer/versions/permission_interpreter_v2.py"),sourceSha256=createHash("sha256").update(source).digest("hex");assert.equal(await gl.client.getChainId(),61999);
  if(state.interpreter)assert.equal(state.interpreter.sourceSha256,sourceSha256,"Interpreter source changed after journal creation");
  if(!state.interpreter){assert.equal(action,"deploy-interpreter","No journalled interpreter deployment");state.interpreter={version:2,sourceSha256,transactionHash:await signingLock(token=>gl.send("deploy:permission-interpreter-v2:"+sourceSha256,client=>client.deployContract({code:source,args:[genLayerAddress(gl.account().address)]}),{table:"locks",id:"worker",token}))};await save();}
  const tx=await gl.client.getTransaction({hash:state.interpreter.transactionHash});console.log(JSON.stringify({stage:action,transactionHash:state.interpreter.transactionHash,status:tx.statusName,result:tx.resultName}));
  assertFinalized(tx);const decoded=tx.txDataDecoded as any;assert.equal(decoded.type,"deploy");assert.equal(decoded.code,source.toString());assert.equal(canonical((normalizedCalldata(decoded.constructorArgs) as any).args),canonical([gl.account().address.toLowerCase()]));assert.equal((tx.sender??tx.from_address)?.toLowerCase(),gl.account().address.toLowerCase());
  const address=decoded.contractAddress??tx.recipient??tx.to_address;assert.ok(address);assert.equal(Number(await gl.read(address,"get_version")),2);assert.equal(String(await gl.read(address,"get_operator")).toLowerCase(),gl.account().address.toLowerCase());state.interpreter={...state.interpreter,address,operator:gl.account().address,verifiedAt:new Date().toISOString()};await save();console.log(JSON.stringify(state.interpreter));
 }else if(action==="revise-sandbox"){
  assert.ok(state.sandbox?.draftId);assert.ok(!state.sandbox.cardId&&!state.sandbox.activationTransaction,"Never revise an activated sandbox in place");await authenticate();
  const {value}=await api("/owner/drafts/"+state.sandbox.draftId);assert.ok(value.state==="FAILED"||(value.state==="FINALIZED"&&value.status==="NEEDS_CLARIFICATION"),"Only a terminal unauthorizing sandbox proposal may be revised");
  state.sandboxHistory=[...(state.sandboxHistory??[]),{...state.sandbox,terminalState:value.state,terminalStatus:value.status,questions:value.questions??[],archivedAt:new Date().toISOString()}];delete state.sandbox;await save();console.log(JSON.stringify({stage:action,archivedDraft:value.id,signatures:0,broadcasts:0}));
 }else if(action==="prepare-sandbox"){
  assert.equal(cfg.interpreter?.toLowerCase(),state.interpreter?.address?.toLowerCase(),"Configure the verified V2 interpreter first");await authenticate();
  if(!state.sandbox){const guidance=sandboxPolicy(process.env.DEMO_MERCHANT_RECIPIENT!,cfg.origin),input={description:guidance.mission,guidance,settlement:{asset:"USDC",destinationChainIds:[1952]}};state.sandbox={input,policyHash:digest(guidance)};await save();}
  if(!state.sandbox.draftId){const {value}=await api("/owner/drafts","POST",state.sandbox.input);state.sandbox.draftId=value.id;await save();}
  const {value}=await api("/owner/drafts/"+state.sandbox.draftId);state.sandbox.draftState=value.state;state.sandbox.draftTransaction=value.genLayerTxHash;await save();console.log(JSON.stringify({id:value.id,state:value.state,status:value.status,transactionHash:value.genLayerTxHash}));
 }else if(action==="activate-sandbox"){
  assert.ok(state.sandbox?.draftId);await authenticate();const draft=await store.get<Draft>("drafts",state.sandbox.draftId);assert.ok(draft);assert.equal(draft.state,"FINALIZED");const result=await gl.draft(draft);assert.equal(result.status,"PROPOSED");assert.equal(digest(result.policy),state.sandbox.policyHash,"Finalized terms changed from the dedicated policy");policySchema.parse(result.policy);
  const factory=process.env.CCTP_CARD_FACTORY_ADDRESS as Address;assert.ok(factory);const abi=artifacts.CctpCardFactory as Abi,config=activationConfig(state.owner,result.policy!,draft.settlement),tuple={...config,circuitId:BigInt(config.circuitId),totalLimit:BigInt(config.totalLimit),perPaymentLimit:BigInt(config.perPaymentLimit),periodLimit:BigInt(config.periodLimit),periodSeconds:BigInt(config.periodSeconds),validFrom:BigInt(config.validFrom),validUntil:BigInt(config.validUntil)};
  const domains=[CCTP_TESTNETS[1952].domain];
  const tx=await signingLock(()=>evm.execute("visitor-sandbox:"+draft._id+":activate",factory,"createCard",[tuple,domains],abi));const receipt=await evm.public.getTransactionReceipt({hash:tx as Hex});const created=receipt.logs.filter(log=>log.address.toLowerCase()===factory.toLowerCase()).flatMap(log=>{try{const decoded=decodeEventLog({abi,data:log.data,topics:log.topics});return decoded.eventName==="CardCreated"?[decoded.args as unknown as {owner:string;card:string;policyHash:string}]:[];}catch{return[];}});assert.equal(created.length,1);assert.equal(created[0].owner.toLowerCase(),state.owner);assert.equal(created[0].policyHash,state.sandbox.policyHash);const address=created[0].card;assert.equal((await evm.verifyActivation(state.owner,result.policy!,address,tx,draft.settlement)).length>0,true);
  const {value}=await api("/owner/cards","POST",{draftId:draft._id,cardAddress:address,activationTx:tx});state.sandbox={...state.sandbox,address,activationTransaction:tx,cardId:value.card.id,reviewerState:value.card.setupState};await save();console.log(JSON.stringify({cardId:state.sandbox.cardId,address,activationTransaction:tx,reviewerState:state.sandbox.reviewerState}));
 }else if(action==="fund-sandbox"){
  const card=await store.get<Card>("cards",state.sandbox?.cardId);assert.ok(card);assert.equal(card.owner,state.owner);assert.equal(card.state,"READY");assert.equal(card.policyHash,state.sandbox.policyHash);assert.equal(card.token?.toLowerCase(),CCTP_TESTNETS[1952].token.toLowerCase());assert.equal(card.address.toLowerCase(),state.sandbox.address.toLowerCase());
  const amount=parseAmount("0.001"),abi=parseAbi(["function transfer(address,uint256) returns(bool)","function balanceOf(address) view returns(uint256)"]);const tx=await signingLock(()=>evm.execute("visitor-sandbox:"+card._id+":fund",card.token!,"transfer",[card.address,amount],abi));
  const receipt=await evm.public.getTransactionReceipt({hash:tx as Hex});assert.equal(receipt.status,"success");const transaction=await evm.public.getTransaction({hash:tx as Hex});assert.equal(transaction.from.toLowerCase(),state.owner);assert.equal(transaction.to?.toLowerCase(),card.token?.toLowerCase());assert.equal(transaction.input,encodeFunctionData({abi,functionName:"transfer",args:[card.address as Address,amount]}));const decoded=decodeFunctionData({abi,data:transaction.input});assert.equal(decoded.args?.[1],amount);state.sandbox.fundingTransaction=tx;state.sandbox.fundedTestnetUSDC="0.001";await save();console.log(JSON.stringify({cardId:card._id,transactionHash:tx,amount:"0.001",token:card.token,chainId:1952}));
 }else{console.log(JSON.stringify({...state,cookie:undefined,paymentEnvironment:"testnet",paymentChainId:1952}));}
}catch(error){console.error(JSON.stringify({stage:action,errorType:error instanceof Error?error.constructor.name:"Unknown",pending:error instanceof Error&&error.constructor.name==="PendingFinality",detail:error instanceof assert.AssertionError?error.message:undefined}));process.exitCode=1;}
process.exit(process.exitCode??0);
