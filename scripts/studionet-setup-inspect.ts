import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {createClient} from "genlayer-js";
import {studionet} from "genlayer-js/chains";
import {TransactionHashVariant,type GenLayerTransaction,type Hash} from "genlayer-js/types";
import {assertFinalized,GenLayerTerminalError,normalizeStudioTransaction,normalizedCalldata,studioExecutionDiagnostic} from "../apps/web/lib/genlayer";
import {digest,policySchema} from "../packages/shared";
import {parseStrictJson} from "../packages/shared/strict-json";

export const setupIncidentTransactions=["0xe543a899fb2d5b66e0bc6c009c49fa264ec8775ae1da3c4203a8ff292ef40406","0x86071c7486457360cfd24204e7412fd8dc3da76f77e140109926dab6a2d2946f","0x81de235b84ae254676f281e39f886cb7ae653815fc11bd520b4bf01b6f0bb13b"] as const;
export const suppliedSetupDraft="0xcde48ddfbf7517292e5834eaa017966960e9dfd8711cdff879763489fbf0281d";
export const suppliedClarificationTransaction="0x7e811a75d010ddb5385cec8eac9fda5a3dd76ef7ae15808e3ed03d0e4dc42f17";
const knownErrors=new Set(["Exact decimal amount required","Invalid draft result fields","Draft changed explicit structured guidance"]);
const array=(value:unknown):Record<string,any>[]=>Array.isArray(value)?value:value?[value as Record<string,any>]:[];
function receiptSummary(receipt:Record<string,any>){
 let contractError: string|null=null;
 if(receipt.execution_result==="ERROR"){
  const payload=typeof receipt.result==="string"?Buffer.from(receipt.result,"base64").toString("utf8").replace(/^[\x00-\x1f]/,""):receipt.result?.payload;
  if(knownErrors.has(payload))contractError=payload;
 }
 return {mode:receipt.mode??null,vote:receipt.vote??null,execution:receipt.execution_result??null,contractError,errorCode:receipt.genvm_result?.error_code??null};
}
export function inspectSetupTransaction(raw:GenLayerTransaction,expectedHash:string){
 assert.equal(String(raw.hash).toLowerCase(),expectedHash.toLowerCase(),"Receipt hash mismatch");
 const tx=normalizeStudioTransaction(raw,expectedHash),data=tx.txDataDecoded;
 assert.ok(data?.type==="call"&&"callData"in data,"Committed setup call is missing");
 const call=normalizedCalldata(data.callData) as {method:string;args:unknown[]};
 assert.equal(call.method,"propose","Transaction is not a permission proposal");
 assert.equal(call.args.length,2);assert.equal(typeof call.args[0],"string");assert.equal(typeof call.args[1],"string");
 const input=parseStrictJson(call.args[1] as string) as {description:string;guidance?:Record<string,any>};
 const guidance=input.guidance??{},checked=policySchema.safeParse(guidance);
 const current=raw as unknown as Record<string,any>;
 let finalityError: string|null=null;
 try{assertFinalized(tx);}catch(error){assert.ok(error instanceof GenLayerTerminalError,"Expected an actual terminal failure");finalityError=error.message;}
 assert.ok(finalityError,"Supplied incident receipt must remain failed");
 const rounds=array(current.consensus_history?.consensus_results).map((round,index)=>({index,stage:round.consensus_round??null,leaders:array(round.leader_result).filter(r=>r.mode==="leader").map(receiptSummary),validatorVotes:array(round.validator_results).map(r=>({vote:r.vote??null,execution:r.execution_result??null,errorCode:r.genvm_result?.error_code??null}))}));
 return {hash:expectedHash,publicUrl:"https://explorer-studio.genlayer.com/tx/"+expectedHash,createdAt:current.created_at,sender:tx.sender??tx.from_address,recipient:tx.recipient??tx.to_address,status:tx.statusName,result:current.result_name,execution:tx.txExecutionResultName,finalityError,diagnostic:studioExecutionDiagnostic(tx)??null,call:{method:call.method,draftId:call.args[0],inputHash:digest(input),inputBytes:Buffer.byteLength(call.args[1] as string),structuredPolicyValid:checked.success,financial:guidance.financial??null,financialCriteria:(guidance.criteria??[]).filter((c:{description?:string})=>/\$|budget|spend|amount/i.test(c.description??"")).map((c:{id:string;description:string})=>({id:c.id,description:c.description})),repeatedDigitRecipients:(guidance.merchants??[]).filter((m:{recipient?:string})=>/^0x([\da-fA-F])\1{39}$/.test(m.recipient??"")).map((m:{name:string;recipient:string})=>({name:m.name,recipient:m.recipient}))},rounds,receiptSha256:createHash("sha256").update(JSON.stringify(raw,(_,v)=>typeof v==="bigint"?v.toString():v)).digest("hex")};
}
async function main(){
 const client=createClient({chain:studionet,endpoint:"https://studio.genlayer.com/api"});
 assert.equal(await client.getChainId(),61999,"Unexpected Studionet chain");
 if(process.argv[2]==="--clarification"){
  const raw=await client.getTransaction({hash:suppliedClarificationTransaction as Hash}),tx=normalizeStudioTransaction(raw,suppliedClarificationTransaction);
  assert.ok(tx.hash);assert.equal(tx.hash.toLowerCase(),suppliedClarificationTransaction);
  const data=tx.txDataDecoded;assert.ok(data?.type==="call"&&"callData"in data);
  const call=normalizedCalldata(data.callData) as {method:string;args:string[]};
  assert.equal(call.args.length,2);assert.equal(call.args[0],"0xfc98632ddf79702bec15eac006c0c0a2441eafea7b83c2b690cced3d7b301a48");
  const target="0x4a96E2dFCa2cae0f77cC7Dcc1B5e50a865F0437f";
  assertFinalized(tx,{target,method:"propose",args:call.args,sender:"0xEd9EDd8586b20524CafA4F568413C504C9B03172"});
  const input=parseStrictJson(call.args[1]);policySchema.parse((input as {guidance:unknown}).guidance);
  const read=(functionName:string)=>client.readContract({address:target,functionName,args:[call.args[0]],jsonSafeReturn:true,transactionHashVariant:TransactionHashVariant.LATEST_FINAL});
  assert.equal(await read("get_draft_input_hash"),digest(input));
  const result=parseStrictJson(String(await read("get_draft"))) as {status:string;policy:unknown;questions:string[];interpretation:string};
  assert.equal(result.status,"NEEDS_CLARIFICATION");assert.equal(result.policy,null);assert.ok(result.questions.length>0&&result.questions.every(q=>typeof q==="string"));
  const leaders=array((raw as any).consensus_data?.leader_receipt).filter(r=>r.mode==="leader"),payload=leaders.at(-1)?.result?.payload;
  assert.deepEqual(parseStrictJson(parseStrictJson(payload.readable) as string),result,"Finalized storage differs from the accepted receipt");
  const report={kind:"VERIFIED_STUDIONET_CLARIFICATION",verifiedAt:new Date().toISOString(),chainId:61999,hash:tx.hash,status:tx.statusName,result:tx.resultName,execution:tx.txExecutionResultName,interpreter:target,draftId:call.args[0],inputHash:digest(input),clarification:result,signatures:0,broadcasts:0};
  await mkdir(".local/studionet-setup",{recursive:true});await writeFile(".local/studionet-setup/clarification.json",JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));console.log("STUDIONET_CLARIFICATION_VERIFIED");return;
 }
 assert.equal(process.argv[2],undefined,"Use only --clarification or the original incident inspection");
 const transactions=[];
 for(const hash of setupIncidentTransactions)transactions.push(inspectSetupTransaction(await client.getTransaction({hash:hash as Hash}),hash));
 const report={version:1,kind:"READ_ONLY_STUDIONET_SETUP_INCIDENT",inspectedAt:new Date().toISOString(),rpc:"https://studio.genlayer.com/api",chainId:61999,suppliedSetupDraft,transactions,draftLinkage:transactions.some(t=>t.call.draftId===suppliedSetupDraft)?"MATCHED_PUBLIC_CALL":"SUPPLIED_DRAFT_DIFFERS_FROM_INSPECTED_CALLS; requires an owner-authorized draft read",signatures:0,broadcasts:0};
 await mkdir(".local/studionet-setup",{recursive:true});await writeFile(".local/studionet-setup/report.json",JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify(report,null,2));console.log("STUDIONET_SETUP_INCIDENT_INSPECTED");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error("Studionet setup inspection failed: "+String(error.message).slice(0,500));process.exitCode=1;});
