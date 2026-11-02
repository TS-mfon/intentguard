/** Deploy and independently verify the versioned testnet permission interpreter. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,open,readFile,rename,unlink} from "node:fs/promises";
import {loadEnvFile} from "node:process";
import {execFileSync} from "node:child_process";
import {canonical,digest} from "../packages/shared";
import {configuration} from "../apps/web/lib/config";
import {database,type Store} from "../apps/web/lib/store";
import {GenLayer,assertFinalized,genLayerAddress,normalizedCalldata} from "../apps/web/lib/genlayer";
import type {Draft,Job} from "../apps/web/lib/models";
import type {Hash as GLHash} from "genlayer-js/types";

type InterpreterReleaseState={
 version:1;kind:"testnet-interpreter-v3-release";operator:string;sourceFile:string;sourceSha256:string;
 paymentChainId:1952;reviewChainId:61999;operationId:string;preparedAt:string;
 sourceCommitAtPreparation:string;sourceDirtyAtPreparation:boolean;
 legacyDraftPins:{id:string;hadInterpreterPin:boolean;interpreterAddress?:string;inputHash:string}[];
 transactionHash?:GLHash;address?:string;verifiedAt?:string;lastVerifiedAt?:string;
};

const action=process.argv[2];
assert.ok(action==="deploy"||action==="verify","Choose deploy or verify");
for(const file of [".local/testnet-secrets.env",".local/hosting.env"])loadEnvFile(file);
const cfg=configuration();
assert.equal(cfg.mode,"testnet");assert.equal(cfg.chainId,1952);assert.equal(cfg.databaseName,"intentguard");
const sourceFile="contracts/genlayer/versions/permission_interpreter_v3.py";
const source=await readFile(sourceFile),sourceSha256=createHash("sha256").update(source).digest("hex");
assert.equal(createHash("sha256").update(await readFile("contracts/genlayer/versions/permission_interpreter_v2.py")).digest("hex"),"61483b2fee8a48a0821cd23a137dc64e280914a764032f0d037d9e82d6544995");
const folder=".local/interpreter-v3-release",statePath=folder+"/state.json";
await mkdir(folder,{recursive:true,mode:0o700});
const lock=await open(folder+"/operator.lock","wx",0o600);
await lock.writeFile(JSON.stringify({pid:process.pid,action,sourceSha256}));
let state:InterpreterReleaseState|undefined;
async function save(){
 assert.ok(state,"An admitted deployment state is required");
 const file=await open(statePath+".tmp","w",0o600);
 try{await file.writeFile(JSON.stringify(state,null,2)+"\n");await file.sync();}finally{await file.close();}
 await rename(statePath+".tmp",statePath);
}
try{
 let store:Store|undefined;
 for(let attempt=0;attempt<3;attempt++){try{store=await database();break;}catch(error){if(attempt===2)throw error;}}
 assert.ok(store);const gl=new GenLayer(store),operator=gl.account().address.toLowerCase();
 const legacy=JSON.parse(await readFile("docs/production/interpreter-v2-deployment.json","utf8"));
 assert.equal(operator,legacy.operator.toLowerCase());assert.equal(await gl.client.getChainId(),61999);
 assert.equal((await gl.public.getBlock({blockNumber:0n})).hash,"0x"+"0".repeat(64));
 try{state=JSON.parse(await readFile(statePath,"utf8"));}catch(error){if((error as {code?:string}).code!=="ENOENT")throw error;}
 if(!state){
  assert.equal(action,"deploy","No admitted interpreter deployment exists");
  const drafts=await store.find<Draft>("drafts",{},{limit:10000});assert.ok(drafts.length<10000,"Legacy snapshot exceeded its bound");
  assert.ok(drafts.every(d=>digest(d.input)===d.inputHash),"Existing draft input commitments must remain intact");
  const legacyDraftPins:InterpreterReleaseState["legacyDraftPins"]=[];
  for(const draft of drafts){
   const hadInterpreterPin=Object.hasOwn(draft,"interpreterAddress");
   if(hadInterpreterPin)assert.ok(typeof draft.interpreterAddress==="string"&&/^0x[0-9a-fA-F]{40}$/.test(draft.interpreterAddress)&&!/^0x0{40}$/i.test(draft.interpreterAddress),"Existing interpreter pins must remain valid");
   else{
    // A historical draft that failed before submission has no interpreter
    // authority to recover. Preserve that absence; never assign the new one.
    assert.equal(draft.state,"FAILED","Only an unsubmitted failed draft may lack a historical pin");
    assert.ok(!draft.genLayerTxHash,"A submitted historical draft must retain its interpreter pin");
    assert.equal(await store.get("transactions","gl:draft:"+draft._id),null,"A signed historical draft must retain its interpreter pin");
   }
   legacyDraftPins.push({id:draft._id,hadInterpreterPin,...(hadInterpreterPin?{interpreterAddress:draft.interpreterAddress}:{}),inputHash:draft.inputHash});
  }
  state={version:1,kind:"testnet-interpreter-v3-release",operator,sourceFile,sourceSha256,paymentChainId:1952,reviewChainId:61999,operationId:"deploy:permission-interpreter-v3:"+sourceSha256,preparedAt:new Date().toISOString(),sourceCommitAtPreparation:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),sourceDirtyAtPreparation:execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim()!=="",legacyDraftPins};
  await save();
 }
 assert.equal(state.version,1);assert.equal(state.kind,"testnet-interpreter-v3-release");assert.equal(state.operator,operator);assert.equal(state.sourceFile,sourceFile);assert.equal(state.sourceSha256,sourceSha256);assert.equal(state.reviewChainId,61999);assert.equal(state.paymentChainId,1952);assert.equal(state.operationId,"deploy:permission-interpreter-v3:"+sourceSha256);
 if(!state.transactionHash){
  const journal=await store.get<{_id:string;protocolHash?:GLHash;evmHash:GLHash}>("transactions","gl:"+state.operationId);
  if(journal?.protocolHash){state.transactionHash=journal.protocolHash;await save();}
  else if(action==="verify"){
   assert.ok(journal,"No recorded submission exists to verify");
   // An uncertain submission may already be visible by its signed EVM hash.
   // Verification never signs or broadcasts; failed lookup leaves the durable
   // raw journal available for a deploy retry under the global signing lease.
   state.transactionHash=journal.evmHash;
  }
  else{
   assert.equal(action,"deploy","A deployment must be explicitly admitted before verification");
   await store.create("locks",{_id:"worker",createdAt:Date.now()});
   const lease=await store.claim<Job>("locks",{_id:"worker"},Date.now(),120000);
   assert.ok(lease,"The existing worker owns the signing lease; retry after it releases");
   // GenLayer.send validates the existing intent and rebroadcasts only its
   // persisted raw transaction when a submission was interrupted or uncertain.
   try{state.transactionHash=await gl.send(state.operationId,client=>client.deployContract({code:source,args:[genLayerAddress(operator)]}),{table:"locks",id:"worker",token:lease.leaseToken}) as GLHash;await save();}
   finally{await store.complete("locks","worker",lease.leaseToken!,{nextAt:0});}
  }
 }
 assert.ok(state.transactionHash,"A recorded transaction is required");
 const tx=await gl.client.getTransaction({hash:state.transactionHash});
 console.log(JSON.stringify({stage:action,transactionHash:state.transactionHash,status:tx.statusName,result:tx.resultName}));
 assertFinalized(tx);const decoded=tx.txDataDecoded;
 assert.ok(decoded&&decoded.type==="deploy"&&"contractAddress" in decoded,"Expected a committed interpreter deployment");assert.equal(decoded.code,source.toString());
 assert.equal(canonical((normalizedCalldata(decoded.constructorArgs) as {args?:unknown[]}).args),canonical([operator]));
 assert.equal((tx.sender??tx.from_address)?.toLowerCase(),operator);
 const address=decoded.contractAddress??tx.recipient??tx.to_address;assert.ok(address);
 assert.equal(Number(await gl.read(address,"get_version")),3);assert.equal(String(await gl.read(address,"get_operator")).toLowerCase(),operator);
 for(const before of state.legacyDraftPins){
  const after:Draft|null=await store.get<Draft>("drafts",before.id);assert.ok(after);assert.equal(Object.hasOwn(after,"interpreterAddress"),before.hadInterpreterPin);
  if(before.hadInterpreterPin)assert.equal(after.interpreterAddress?.toLowerCase(),before.interpreterAddress?.toLowerCase());
  else{assert.equal(after.state,"FAILED");assert.ok(!after.genLayerTxHash);assert.equal(await store.get("transactions","gl:draft:"+after._id),null);}
  assert.equal(after.inputHash,before.inputHash);assert.equal(digest(after.input),before.inputHash);
 }
 state.address=address;state.lastVerifiedAt=new Date().toISOString();state.verifiedAt??=state.lastVerifiedAt;await save();
 const report={version:1,kind:"VERIFIED_STUDIONET_PERMISSION_INTERPRETER",paymentEnvironment:"testnet",paymentChainId:1952,reviewEnvironment:"testnet",reviewChainId:61999,interpreterVersion:3,interpreterAddress:address,deploymentTransaction:state.transactionHash,operator,sourceFile,sourceSha256,verifiedAt:state.verifiedAt,sourceCommitAtPreparation:state.sourceCommitAtPreparation,sourceDirtyAtPreparation:state.sourceDirtyAtPreparation,historicalDraftsPreserved:state.legacyDraftPins.length,legacyDraftPinsVerified:state.legacyDraftPins.filter(d=>d.hadInterpreterPin).length,unsubmittedFailedDraftsWithoutPinsPreserved:state.legacyDraftPins.filter(d=>!d.hadInterpreterPin).length,runtimePublicationSeparatelyRequired:true,liveTemplateAcceptanceSeparatelyRequired:true};
 const reportPath="docs/production/interpreter-v3-deployment.json";
 try{assert.equal(canonical(JSON.parse(await readFile(reportPath,"utf8"))),canonical(report),"The published deployment descriptor must retain its verified identity");}
 catch(error){
  if((error as {code?:string}).code!=="ENOENT")throw error;
  const output=await open(reportPath,"wx",0o644);
  try{await output.writeFile(JSON.stringify(report,null,2)+"\n");await output.sync();}finally{await output.close();}
 }
 console.log(JSON.stringify({...report,checkedAt:state.lastVerifiedAt}));console.log("TESTNET_INTERPRETER_V3_VERIFIED");
}catch(error){console.error(JSON.stringify({stage:action,errorType:error instanceof Error?error.constructor.name:"Unknown",pending:error instanceof Error&&error.constructor.name==="PendingFinality",networkFetchFailed:error instanceof Error&&error.message==="fetch failed",detail:error instanceof assert.AssertionError?error.message:undefined}));process.exitCode=1;}
finally{await lock.close();await unlink(folder+"/operator.lock");}
process.exit(process.exitCode??0);
