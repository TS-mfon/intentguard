import {readFile} from "node:fs/promises";
import {createAccount,createClient,decodeInputData} from "genlayer-js";
import {studionet} from "genlayer-js/chains";
import {TransactionHashVariant,transactionsStatusNumberToName,executionResultNumberToName,transactionResultNumberToName,CalldataAddress,type CalldataEncodable,type GenLayerTransaction,type Hash as GLHash} from "genlayer-js/types";
import {createPublicClient,http,decodeEventLog,keccak256,parseTransaction,toBytes,toHex,type Abi,type Hex,type Address} from "viem";
import {canonical,digest,policySchema,isSettlementV2,type DraftResult,type ReviewDecision} from "../../../packages/shared";
import {configuration,STUDIONET_CHAIN_ID,STUDIONET_CONSENSUS} from "./config";
import {assertSigningLease} from "./signing-lease";
import {validateTransactionJournal} from "./transaction-profile";
import {assertCardEnvironment} from "./settlement";
import type {Store,Doc} from "./store";
import type {Card,Draft,Payment} from "./models";
export const genLayerAddress=(address:string)=>new CalldataAddress(toBytes(address as Hex));
export type StudioExecutionDiagnostic={code:"DRAFT_GENERATION_INVALID_AMOUNT"|"DRAFT_GENERATION_INVALID_SCHEMA"|"DRAFT_GENERATION_CHANGED_GUIDANCE";message:string};
function finalStudioLeader(tx:GenLayerTransaction){
 const leaders=(tx as unknown as {consensus_data?:{leader_receipt?:unknown}}).consensus_data?.leader_receipt;
 const receipts=(Array.isArray(leaders)?leaders:leaders?[leaders]:[]) as {mode?:unknown;execution_result?:unknown;result?:{status?:unknown;payload?:unknown}}[];
 const labelled=receipts.some(receipt=>typeof receipt?.mode==="string");
 return (labelled?receipts.filter(receipt=>receipt?.mode==="leader"):receipts).at(-1);
}
// Only expose known contract diagnostics. Never copy arbitrary model output,
// provider configuration, or another validator's idle error into owner messages.
export function studioExecutionDiagnostic(tx:GenLayerTransaction):StudioExecutionDiagnostic|undefined{
 const leader=finalStudioLeader(tx);
 if(leader?.execution_result!=="ERROR"||leader.result?.status!=="rollback")return;
 switch(leader.result.payload){
  case "Exact decimal amount required":return {code:"DRAFT_GENERATION_INVALID_AMOUNT",message:"The generated proposal used an invalid budget format. Your exact submitted amounts were not authorized; review the saved terms and submit a new proposal."};
  case "Invalid draft result fields":return {code:"DRAFT_GENERATION_INVALID_SCHEMA",message:"GenLayer generated a malformed policy proposal. No policy was authorized; review the saved terms and submit a new proposal."};
  case "Draft changed explicit structured guidance":return {code:"DRAFT_GENERATION_CHANGED_GUIDANCE",message:"The generated proposal changed explicit owner terms. No policy was authorized; review the saved terms and submit a new proposal."};
 }
}
export function normalizedCalldata(value:unknown):unknown{
 if(typeof value==="bigint"){const number=Number(value);if(!Number.isSafeInteger(number))throw Error("GenLayer integer exceeds exact JSON range");return number;}
 if(value instanceof CalldataAddress)return toHex(value.bytes).toLowerCase();
 if(value instanceof Map)return Object.fromEntries([...value].map(([k,v])=>[k,normalizedCalldata(v)]));
 if(Array.isArray(value))return value.map(normalizedCalldata);
 if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalizedCalldata(v)]));
 return value;
}

// Studionet returns the simulator RPC shape even when accessed through genlayer-js.
// Decode the committed RLP bytes; never infer calldata or VM success from UI fields.
export function normalizeStudioTransaction(tx:GenLayerTransaction,expectedHash?:string):GenLayerTransaction{
 const raw=tx as unknown as Record<string,any>;
 if(expectedHash&&raw.hash&&String(raw.hash).toLowerCase()!==expectedHash.toLowerCase())throw Error("GenLayer transaction hash mismatch");
 if(typeof raw.tx_data!=="string")return tx;
 const encoded=(raw.tx_data.startsWith("0x")?raw.tx_data:"0x"+raw.tx_data) as Hex;
 if(!/^0x[0-9a-fA-F]+$/.test(encoded))throw Error("Invalid GenLayer committed transaction data");
 const decoded=decodeInputData(encoded,raw.recipient??raw.to_address);
 // Studio can append an idle validator receipt to the leader_receipt array.
 // Its execution error is not the leader's VM outcome. Select the final leader
 // in explicitly labelled arrays; legacy unlabelled arrays retain their order.
 const latest=finalStudioLeader(tx);
 const returned=latest?.execution_result==="SUCCESS"&&(!latest.result?.status||latest.result.status==="return");
 return {...tx,
  statusName:raw.status_name??raw.statusName??raw.status,
  resultName:raw.result_name??raw.resultName,
  txExecutionResultName:returned?"FINISHED_WITH_RETURN":"FINISHED_WITH_ERROR",
  txDataDecoded:decoded,
 } as GenLayerTransaction;
}

export class PendingFinality extends Error {}
export class GenLayerTerminalError extends Error {constructor(message:string,readonly diagnostic?:StudioExecutionDiagnostic){super(message);}}
export function assertFinalized(tx:GenLayerTransaction,expected?:{target:string;method:string;args:unknown[];sender?:string}){
 const status=tx.statusName??transactionsStatusNumberToName[String(tx.status) as keyof typeof transactionsStatusNumberToName]??tx.status;
 if(status!=="FINALIZED"){if(["CANCELED","UNDETERMINED","VALIDATORS_TIMEOUT","LEADER_TIMEOUT"].includes(String(status)))throw new GenLayerTerminalError("GenLayer transaction failed: "+status);throw new PendingFinality("GenLayer consensus is not finalized");}
 const execution=tx.txExecutionResultName??executionResultNumberToName[String(tx.txExecutionResult) as keyof typeof executionResultNumberToName];
 if(execution!=="FINISHED_WITH_RETURN"){const diagnostic=studioExecutionDiagnostic(tx);throw new GenLayerTerminalError(diagnostic?.message??"GenLayer VM execution was not successful",diagnostic);}
 const result=tx.resultName??transactionResultNumberToName[String(tx.result) as keyof typeof transactionResultNumberToName];if(!["AGREE","MAJORITY_AGREE","SUCCESS"].includes(String(result)))throw new GenLayerTerminalError("GenLayer consensus did not approve execution");if(tx.txDataDecoded?.leaderOnly!==false)throw Error("GenLayer validator consensus is required");
 if(expected){
 if((tx.recipient??tx.to_address)?.toLowerCase()!==expected.target.toLowerCase())throw Error("GenLayer transaction target mismatch");
 if(expected.sender&&(tx.sender??tx.from_address)?.toLowerCase()!==expected.sender.toLowerCase())throw Error("GenLayer transaction sender mismatch");
 const decoded=tx.txDataDecoded;if(!decoded||decoded.type!=="call"||!("callData" in decoded))throw Error("GenLayer decoded call is missing");
 const raw=decoded.callData;const call=normalizedCalldata(raw) as {method?:string;args?:unknown[]};
 if(!call||call.method!==expected.method||canonical(call.args??[])!==canonical(expected.args))throw Error("GenLayer transaction calldata mismatch");
 }
}
export interface GenLayerPort{
 propose(draft:Draft):Promise<string>;
 draft(draft:Draft):Promise<DraftResult>;
 deployReviewer(card:Card):Promise<string>;
 reviewer(card:Card):Promise<string>;
 submit(card:Card,p:Payment):Promise<string>;
 decision(card:Card,p:Payment):Promise<ReviewDecision>;
}
type Signed=Doc&{raw:Hex;evmHash:Hex;protocolHash?:string};
class Prepared extends Error{constructor(readonly raw:Hex){super("Transaction prepared without broadcasting")}}
export class GenLayer implements GenLayerPort{
 readonly cfg=configuration();
 readonly client=createClient({chain:studionet,endpoint:this.cfg.genLayerRpc});
 readonly public=createPublicClient({transport:http(this.cfg.genLayerRpc,{timeout:15000,retryCount:0})});
 constructor(private store:Store){
 const get=this.client.getTransaction.bind(this.client);
 this.client.getTransaction=async args=>normalizeStudioTransaction(await get(args),args.hash);
 }
 account(){const key=process.env.GENLAYER_OPERATOR_PRIVATE_KEY;if(!key)throw Error("GenLayer operator key is required");return createAccount(key as Hex)}
 async identity(){if(this.cfg.genLayerNetwork!=="studionet"||await this.public.getChainId()!==STUDIONET_CHAIN_ID)throw Error("Unexpected GenLayer review network");if(this.cfg.mainnet){if(this.cfg.genLayerConsensus?.toLowerCase()!==STUDIONET_CONSENSUS)throw Error("Studionet SDK consensus identity mismatch");const genesis=await this.public.getBlock({blockNumber:0n});if(genesis.hash?.toLowerCase()!==this.cfg.genLayerGenesis?.toLowerCase())throw Error("Studionet genesis identity mismatch");}}
 async send(id:string,action:(client:ReturnType<typeof createClient>)=>Promise<unknown>,lease?:{table:string;id:string;token?:string}){
 await this.identity();const binding={reviewNetwork:"studionet",reviewChainId:STUDIONET_CHAIN_ID,paymentEnvironment:this.cfg.paymentEnvironment,reviewGenesis:this.cfg.genLayerGenesis??null,reviewConsensus:this.cfg.genLayerConsensus??STUDIONET_CONSENSUS};
 let saved=await this.store.get<Signed>("transactions","gl:"+id);if(saved&&((this.cfg.mainnet&&!saved.binding)||(saved.binding&&canonical(saved.binding)!==canonical(binding))))throw Error("GenLayer journal belongs to another deployment");
 const account=this.account();let prepared:Hex;
 {
 const capture={...account,signTransaction:async(...args:Parameters<typeof account.signTransaction>)=>{throw new Prepared(await account.signTransaction(...args))}};
 const client=createClient({chain:studionet,endpoint:this.cfg.genLayerRpc,account:capture});
 try{await action(client);throw Error("GenLayer did not produce a signed transaction")}catch(e){if(!(e instanceof Prepared))throw e;prepared=e.raw;}
 }
 const intended=parseTransaction(prepared!);
 if(!intended.to||!intended.data)throw Error("GenLayer transaction intent is missing");
 if(lease)await assertSigningLease(this.store,lease.table,lease.id,lease.token);
 if(!saved){const row={_id:"gl:"+id,raw:prepared!,evmHash:keccak256(prepared!),binding,createdAt:Date.now()};saved=await this.store.create("transactions",row)?row:await this.store.get("transactions",row._id);}
 if(!saved)throw Error("Signed GenLayer transaction was not persisted");
 if((this.cfg.mainnet&&!saved.binding)||(saved.binding&&canonical(saved.binding)!==canonical(binding)))throw Error("GenLayer journal belongs to another deployment");
 await validateTransactionJournal({raw:saved.raw,hash:saved.evmHash},{chainId:STUDIONET_CHAIN_ID,to:intended.to,data:intended.data,gateway:account.address,binding:{paymentEnvironment:this.cfg.paymentEnvironment,paymentChainId:STUDIONET_CHAIN_ID,gateway:account.address.toLowerCase()},requireBinding:false});
 if(saved.protocolHash)return saved.protocolHash;
 // Recover the same raw transaction after a crash; a new nonce can never replace this job.
 if(lease)await assertSigningLease(this.store,lease.table,lease.id,lease.token);
 const hash=await this.client.sendRawTransaction({serializedTransaction:saved.raw}).catch(async e=>{
 const exists=await this.public.getTransaction({hash:saved!.evmHash}).catch(()=>null);if(!exists)throw e;return saved!.evmHash;});
 let protocolHash:string;
 // Studio deployments may expose the transaction directly by its signed EVM hash.
 const direct=await this.client.getTransaction({hash:hash as GLHash}).catch(()=>null);
 if(direct&&direct.txDataDecoded)protocolHash=hash;
 else {
 const receipt=await this.public.waitForTransactionReceipt({hash:saved.evmHash,timeout:25000,pollingInterval:1000});
 if(receipt.status!=="success")throw Error("GenLayer submission reverted");
 const created=[{type:"event",name:"CreatedTransaction",anonymous:false,inputs:[{name:"txId",type:"bytes32",indexed:true}]}] as Abi;
 const consensus=studionet.consensusMainContract;
 let found:string|undefined;
 for(const log of receipt.logs){if(consensus&&log.address.toLowerCase()!==consensus.address.toLowerCase())continue;
 for(const abi of [consensus?.abi as Abi|undefined,created]){if(!abi)continue;try{const event=decodeEventLog({abi,data:log.data,topics:log.topics});const a=event.args as {txId?:string};if(["NewTransaction","CreatedTransaction"].includes(event.eventName??"")&&a.txId)found=a.txId;}catch{}}}
 if(!found)throw Error("Missing GenLayer consensus transaction ID");protocolHash=found;
 }
 await this.store.patch("transactions",saved._id,{protocolHash});return protocolHash;
 }
 async read(address:string,functionName:string,args:string[]=[]){await this.identity();return this.client.readContract({address:address as Address,functionName,args,jsonSafeReturn:true,transactionHashVariant:TransactionHashVariant.LATEST_FINAL})}
 private async draftInterpreter(d:Draft){
  const saved=await this.store.get<Draft>("drafts",d._id);
  if(!saved||saved.owner!==d.owner||saved.inputHash!==d.inputHash||digest(saved.input)!==saved.inputHash||canonical(saved.input)!==canonical(d.input))throw Error("Draft stored input commitment mismatch");
  const target=saved.interpreterAddress;
  // New drafts pin the trusted configured interpreter at admission. Legacy
  // drafts require an explicitly verified backfill; a receipt recipient or the
  // new global configuration can never supply missing historical authority.
  if(typeof target!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(target)||/^0x0{40}$/i.test(target))throw Error("Draft interpreter authority is missing or invalid");
  if(d.interpreterAddress!==undefined&&d.interpreterAddress.toLowerCase()!==target.toLowerCase())throw Error("Draft interpreter authority mismatch");
  if((saved.genLayerTxHash??null)!==(d.genLayerTxHash??null))throw Error("Draft stored transaction mismatch");
  return target.toLowerCase();
 }
 async propose(d:Draft){
  await assertSigningLease(this.store,"drafts",d._id,d.leaseToken);
  const target=await this.draftInterpreter(d);
  if(d.genLayerTxHash)throw Error("Draft proposal is already submitted");
  return this.send("draft:"+d._id,async c=>{
   if(await this.draftInterpreter(d)!==target)throw Error("Draft interpreter authority changed before signing");
   return c.writeContract({address:target as Address,functionName:"propose",args:[d._id,canonical(d.input)],value:0n});
  },{table:"drafts",id:d._id,token:d.leaseToken});
 }
 async draft(d:Draft){if(!d.genLayerTxHash)throw Error("Missing draft transaction");const target=await this.draftInterpreter(d);const tx=await this.client.getTransaction({hash:d.genLayerTxHash as GLHash});assertFinalized(tx,{target,method:"propose",args:[d._id,canonical(d.input)],sender:this.account().address});
 if(await this.read(target,"get_draft_input_hash",[d._id])!==d.inputHash)throw Error("Draft input commitment mismatch");
 const raw=await this.read(target,"get_draft",[d._id]);const result=JSON.parse(String(raw)) as DraftResult;
 if(!["PROPOSED","NEEDS_CLARIFICATION"].includes(result.status)||!Array.isArray(result.questions)||typeof result.interpretation!=="string")throw Error("Invalid draft result");
 if(result.status==="PROPOSED")result.policy=policySchema.parse(result.policy);else if(result.policy!==null)throw Error("Clarification must not authorize policy");return result;}
 reviewerArgs(c:Card){assertCardEnvironment(c);const args=[genLayerAddress(this.account().address),canonical(c.policy),c.policyHash,Number(c.chainId??this.cfg.chainId),String(c.token??this.cfg.token).toLowerCase(),...(c.settlement?[canonical(c.settlement)]:[])];if(c.reviewerVersion===4){if(!c.settlement||!isSettlementV2(c.settlement))throw Error("V4 reviewer requires explicit settlement permissions");args.push(canonical({version:4,paymentEnvironment:c.settlement.paymentEnvironment,reviewEnvironment:"testnet"}));}return args;}
 async reviewerSource(version:number){if(![1,2,3,4].includes(version))throw Error("Unsupported reviewer source version");return readFile(new URL(version===4?"../../../contracts/genlayer/versions/purchase_reviewer_v4.py":version===1?"../../../contracts/genlayer/versions/purchase_reviewer_v1.py":version===3?"../../../contracts/genlayer/versions/purchase_reviewer_v3.py":"../../../contracts/genlayer/purchase_reviewer.py",import.meta.url));}
 async deployReviewer(c:Card){const source=await this.reviewerSource(Number(c.reviewerVersion??2));return this.send("reviewer:"+c._id+(c.reviewerAttempt?":attempt:"+Number(c.reviewerAttempt):""),client=>client.deployContract({code:source,args:this.reviewerArgs(c)}),{table:"cards",id:c._id,token:c.leaseToken})}
 async reviewer(c:Card){assertCardEnvironment(c);if(!c.reviewerTx)throw Error("Missing reviewer deployment");const tx=await this.client.getTransaction({hash:c.reviewerTx as GLHash});assertFinalized(tx);const decoded=tx.txDataDecoded;
 if(!decoded||decoded.type!=="deploy"||!("contractAddress" in decoded))throw Error("Expected reviewer deployment transaction");
 const source=(await this.reviewerSource(Number(c.reviewerVersion??1))).toString("utf8");
 const constructor=normalizedCalldata(decoded.constructorArgs) as {args?:unknown[]};
 if(decoded.code!==source||canonical(constructor?.args??[])!==canonical(normalizedCalldata(this.reviewerArgs(c))))throw Error("Reviewer deployment code or constructor mismatch");
 const address=decoded.contractAddress??tx.recipient??tx.to_address;if(!address)throw Error("Missing reviewer address");
 if((tx.sender??tx.from_address)?.toLowerCase()!==this.account().address.toLowerCase())throw Error("Reviewer deployer mismatch");
 if(await this.read(address,"get_policy_hash")!==c.policyHash)throw Error("Reviewer policy mismatch");
 if(String(await this.read(address,"get_operator")).toLowerCase()!==this.account().address.toLowerCase())throw Error("Reviewer operator mismatch");
 if(Number(await this.read(address,"get_chain_id"))!==Number(c.chainId??this.cfg.chainId)||String(await this.read(address,"get_token")).toLowerCase()!==String(c.token??this.cfg.token).toLowerCase())throw Error("Reviewer payment network mismatch");if(c.settlement&&await this.read(address,"get_settlement_hash")!==digest(c.settlement))throw Error("Reviewer settlement permission mismatch");if(c.reviewerVersion===4){const profile={version:4,paymentEnvironment:(c.settlement as import("../../../packages/shared").SettlementV2).paymentEnvironment,reviewEnvironment:"testnet"};if(Number(await this.read(address,"get_version"))!==4||await this.read(address,"get_settlement_profile_hash")!==digest(profile))throw Error("Reviewer environment profile mismatch");}return address;}
 async submit(c:Card,p:Payment){assertCardEnvironment(c);if(!c.reviewerAddress||!p.canonical||!p.snapshots)throw Error("Missing review context");return this.send("review:"+p._id,client=>client.writeContract({address:c.reviewerAddress as Address,functionName:"review",args:[p._id,canonical(p.canonical),canonical(p.snapshots)],value:0n}),{table:"requests",id:p._id,token:p.leaseToken})}
 async decision(c:Card,p:Payment){assertCardEnvironment(c);if(!p.genLayerTxHash||!c.reviewerAddress||!p.canonical||!p.snapshots)throw Error("Missing review transaction");const tx=await this.client.getTransaction({hash:p.genLayerTxHash as GLHash});assertFinalized(tx,{target:c.reviewerAddress,method:"review",args:[p._id,canonical(p.canonical),canonical(p.snapshots)],sender:this.account().address});return JSON.parse(String(await this.read(c.reviewerAddress,"get_review",[p._id]))) as ReviewDecision;}
}
