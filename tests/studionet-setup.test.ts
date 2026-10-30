import {test} from "node:test";
import assert from "node:assert/strict";
import {abi} from "genlayer-js";
import {TransactionHashVariant} from "genlayer-js/types";
import {toHex,toRlp} from "viem";
import {assertFinalized,GenLayer,GenLayerTerminalError,normalizeStudioTransaction,studioExecutionDiagnostic} from "../apps/web/lib/genlayer";
import {MemoryStore} from "../apps/web/lib/store";
import type {Draft} from "../apps/web/lib/models";
import {inspectSetupTransaction} from "../scripts/studionet-setup-inspect";
import {canonical,digest} from "../packages/shared";
import {policy} from "./fixtures";

const hash="0x"+"ab".repeat(32),target="0x"+"11".repeat(20),sender="0x"+"22".repeat(20),draftId="0x"+"cd".repeat(32);
const input={description:policy.mission,guidance:policy},args=[draftId,canonical(input)];
const success={mode:"leader",execution_result:"SUCCESS",result:{status:"return"}},idle={mode:"validator",vote:"idle",execution_result:"ERROR",result:{status:"rollback",payload:"Invalid draft result fields"},genvm_result:{error_code:"CONSENSUS_VALIDATOR_QUORUM_REACHED"}};
const error=(payload:string)=>({mode:"leader",execution_result:"ERROR",result:{status:"rollback",payload}});
function fixture(receipts:unknown[],changes:Record<string,unknown>={}){
 return {hash,statusName:"FINALIZED",status:7,result_name:"MAJORITY_DISAGREE",sender,recipient:target,created_at:"2026-10-30T05:10:16Z",tx_data:toRlp([toHex(abi.calldata.encode({method:"propose",args})),"0x"]).slice(2),consensus_data:{leader_receipt:receipts},...changes};
}
const normalize=(raw:ReturnType<typeof fixture>)=>normalizeStudioTransaction(raw as never,hash);

test("persisted lowercase Studio contract authority can read its canonical finalized identifier",async()=>{
 const interpreter="0x4a96E2dFCa2cae0f77cC7Dcc1B5e50a865F0437f",gl=new GenLayer(new MemoryStore());gl.identity=async()=>{};
 let reads=0;gl.client.readContract=async call=>{reads++;assert.equal(call.address,interpreter,"Studio cannot find the lowercase identifier");assert.equal(call.transactionHashVariant,TransactionHashVariant.LATEST_FINAL);assert.equal(call.functionName,"get_draft");assert.deepEqual(call.args,[draftId]);return canonical({status:"NEEDS_CLARIFICATION",policy:null,questions:["Choose one budget period."],interpretation:"Budget clarification required."}) as never;};
 for(const target of [interpreter,interpreter.toLowerCase()]){const result=JSON.parse(String(await gl.read(target,"get_draft",[draftId])));assert.equal(result.status,"NEEDS_CLARIFICATION");assert.equal(result.policy,null);}
 await assert.rejects(gl.read("invalid","get_draft",[draftId]));assert.equal(reads,2);
});

test("actual interpreter error classes produce safe actionable diagnostics while retaining terminal failure",()=>{
 for(const [payload,code]of [["Exact decimal amount required","DRAFT_GENERATION_INVALID_AMOUNT"],["Invalid draft result fields","DRAFT_GENERATION_INVALID_SCHEMA"],["Draft changed explicit structured guidance","DRAFT_GENERATION_CHANGED_GUIDANCE"]]){
  const tx=normalize(fixture([error(payload),idle]));assert.equal(studioExecutionDiagnostic(tx)?.code,code);
  assert.throws(()=>assertFinalized(tx,{target,method:"propose",args,sender}),e=>e instanceof GenLayerTerminalError&&e.diagnostic?.code===code&&/submit a new proposal/.test(e.message));
 }
});
test("trailing idle validator errors and superseded leader failures do not blame successful execution",()=>{
 for(const receipts of [[success,idle],[error("Invalid draft result fields"),success,idle]]){
  const tx=normalize(fixture(receipts,{result_name:"MAJORITY_AGREE"}));assert.equal(studioExecutionDiagnostic(tx),undefined);assert.doesNotThrow(()=>assertFinalized(tx,{target,method:"propose",args,sender}));
 }
});
test("last rotated leader failure remains terminal after an earlier success",()=>{
 const tx=normalize(fixture([success,error("Draft changed explicit structured guidance"),idle]));
 assert.equal(studioExecutionDiagnostic(tx)?.code,"DRAFT_GENERATION_CHANGED_GUIDANCE");assert.throws(()=>assertFinalized(tx),GenLayerTerminalError);
});
test("arbitrary model payloads are not copied into owner-visible diagnostics",()=>{
 const payload="unexpected output with private provider material";
 const tx=normalize(fixture([error(payload)]));assert.equal(studioExecutionDiagnostic(tx),undefined);
 assert.throws(()=>assertFinalized(tx),e=>e instanceof GenLayerTerminalError&&!e.message.includes(payload)&&e.diagnostic===undefined);
});
test("successful leader execution never overrides majority disagreement",()=>{
 const tx=normalize(fixture([success,idle]));assert.equal(tx.txExecutionResultName,"FINISHED_WITH_RETURN");assert.equal(studioExecutionDiagnostic(tx),undefined);assert.throws(()=>assertFinalized(tx),GenLayerTerminalError);
});
test("incident inspection decodes committed input and independently measures the policy hash",()=>{
 const raw=fixture([error("Invalid draft result fields")],{consensus_history:{consensus_results:[{consensus_round:"Undetermined",leader_result:[error("Invalid draft result fields")],validator_results:[idle]}]}});
 const report=inspectSetupTransaction(raw as never,hash);
 assert.equal(report.call.draftId,draftId);assert.equal(report.call.inputHash,digest(input));assert.equal(report.call.structuredPolicyValid,true);assert.equal(report.execution,"FINISHED_WITH_ERROR");assert.equal(report.rounds[0].leaders[0].contractError,"Invalid draft result fields");assert.equal(report.rounds[0].validatorVotes[0].errorCode,"CONSENSUS_VALIDATOR_QUORUM_REACHED");assert.match(report.receiptSha256,/^[a-f0-9]{64}$/);
});
test("incident inspection rejects changed identity, a different method and a successful control",()=>{
 assert.throws(()=>inspectSetupTransaction(fixture([error("Invalid draft result fields")]) as never,"0x"+"ef".repeat(32)),/hash mismatch/i);
 const changed=fixture([error("Invalid draft result fields")],{tx_data:toRlp([toHex(abi.calldata.encode({method:"review",args})),"0x"]).slice(2)});
 assert.throws(()=>inspectSetupTransaction(changed as never,hash),/not a permission proposal/);
 assert.throws(()=>inspectSetupTransaction(fixture([success],{result_name:"MAJORITY_AGREE"}) as never,hash),/must remain failed/);
});
test("incident inspection refuses duplicate committed input keys",()=>{
 const duplicate=fixture([error("Invalid draft result fields")],{tx_data:toRlp([toHex(abi.calldata.encode({method:"propose",args:[draftId,'{"description":"research","description":"replacement"}']})),"0x"]).slice(2)});
 assert.throws(()=>inspectSetupTransaction(duplicate as never,hash),/duplicate/i);
});

async function pinnedDraft(submitted=true){
 const store=new MemoryStore(),gl=new GenLayer(store),newTarget="0x"+"33".repeat(20);
 const d:Draft={_id:draftId,owner:sender,input,inputHash:digest(input),interpreterAddress:target,state:submitted?"AWAITING_FINALITY":"QUEUED",...(submitted?{genLayerTxHash:hash}:{}),createdAt:1,updatedAt:1};
 await store.create("drafts",d);gl.cfg.interpreter=newTarget;
 gl.account=()=>({address:sender} as never);
 let txReads=0;gl.client.getTransaction=async()=>{txReads++;return normalize(fixture([success],{result_name:"MAJORITY_AGREE"}));};
 const reads:{address:string;method:string}[]=[];
 gl.read=async(address,method)=>{reads.push({address,method});return method==="get_draft_input_hash"?d.inputHash:canonical({status:"PROPOSED",policy,questions:[],interpretation:"Exact original terms."});};
 return {store,gl,d,newTarget,reads,txReads:()=>txReads};
}
test("old in-flight drafts retain their trusted interpreter after global configuration changes",async()=>{
 const t=await pinnedDraft();assert.equal(t.gl.cfg.interpreter,t.newTarget);
 const result=await t.gl.draft(t.d);assert.deepEqual(result.policy,policy);assert.equal(t.txReads(),1);
 assert.deepEqual(t.reads,[{address:target,method:"get_draft_input_hash"},{address:target,method:"get_draft"}]);
});
test("missing or mismatched persisted interpreter authority never falls back to the receipt or current configuration",async()=>{
 for(const value of [undefined,"0x"+"00".repeat(20),"not-an-address","0x"+"33".repeat(20)]){
  const t=await pinnedDraft();await t.store.patch("drafts",draftId,{interpreterAddress:value});
  await assert.rejects(t.gl.draft(t.d),/interpreter authority/);assert.equal(t.txReads(),0);assert.equal(t.reads.length,0);
 }
});
test("persisted target rejects a successful transaction addressed to the newly configured interpreter",async()=>{
 const t=await pinnedDraft();t.gl.client.getTransaction=async()=>normalize(fixture([success],{result_name:"MAJORITY_AGREE",recipient:t.newTarget}));
 await assert.rejects(t.gl.draft(t.d),/target mismatch/);assert.equal(t.reads.length,0);
});
test("persisted draft commitment rejects changed calldata, input and transaction identity",async()=>{
 const calldata=await pinnedDraft();calldata.gl.client.getTransaction=async()=>normalize(fixture([success],{result_name:"MAJORITY_AGREE",tx_data:toRlp([toHex(abi.calldata.encode({method:"propose",args:[draftId,canonical({...input,description:"Changed mission"})]})),"0x"]).slice(2)}));
 await assert.rejects(calldata.gl.draft(calldata.d),/calldata mismatch/);assert.equal(calldata.reads.length,0);
 const changed=await pinnedDraft();await changed.store.patch("drafts",draftId,{input:{...input,description:"Changed stored mission"}});
 await assert.rejects(changed.gl.draft(changed.d),/stored input commitment/);assert.equal(changed.txReads(),0);
 const transaction=await pinnedDraft();await transaction.store.patch("drafts",draftId,{genLayerTxHash:"0x"+"ff".repeat(32)});
 await assert.rejects(transaction.gl.draft(transaction.d),/stored transaction mismatch/);assert.equal(transaction.txReads(),0);
});
test("proposal uses the persisted admission target before preparing a signature",async()=>{
 const t=await pinnedDraft(false);let writes=0;
 t.gl.send=async(_id,action)=>{const saved=await t.store.get<Draft>("drafts",draftId);assert.equal(saved?.interpreterAddress,target);await action({writeContract:async(call:Record<string,unknown>)=>{writes++;assert.equal(call.address,target);assert.deepEqual(call.args,args);return hash;}} as never);return hash;};
 assert.equal(await t.gl.propose(t.d),hash);assert.equal(writes,1);
});
test("proposal refuses absent authority and a changed target before signing",async()=>{
 const missing=await pinnedDraft(false);await missing.store.patch("drafts",draftId,{interpreterAddress:undefined});let sends=0;
 missing.gl.send=async()=>{sends++;return hash;};await assert.rejects(missing.gl.propose(missing.d),/interpreter authority/);assert.equal(sends,0);
 const changed=await pinnedDraft(false);let writes=0;
 changed.gl.send=async(_id,action)=>{await changed.store.patch("drafts",draftId,{interpreterAddress:changed.newTarget});await action({writeContract:async()=>{writes++;return hash;}} as never);return hash;};
 await assert.rejects(changed.gl.propose(changed.d),/interpreter authority/);assert.equal(writes,0);
});
