import {readFile} from "node:fs/promises";
import {createAccount,createClient,decodeInputData} from "genlayer-js";
import {studionet} from "genlayer-js/chains";
import {TransactionHashVariant,transactionsStatusNumberToName,executionResultNumberToName,transactionResultNumberToName,CalldataAddress,type CalldataEncodable,type GenLayerTransaction,type Hash as GLHash} from "genlayer-js/types";
import {createPublicClient,http,decodeEventLog,keccak256,toBytes,toHex,type Abi,type Hex,type Address} from "viem";
import {canonical,digest,policySchema,type DraftResult,type ReviewDecision} from "../../../packages/shared";
import {configuration} from "./config";
import type {Store,Doc} from "./store";
import type {Card,Draft,Payment} from "./models";
export const genLayerAddress=(address:string)=>new CalldataAddress(toBytes(address as Hex));
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
 const leaders=raw.consensus_data?.leader_receipt;
 const receipts=Array.isArray(leaders)?leaders:leaders?[leaders]:[];
 const latest=receipts.at(-1);
 return {...tx,
  statusName:raw.status_name??raw.statusName??raw.status,
  resultName:raw.result_name??raw.resultName,
  txExecutionResultName:latest?.execution_result==="SUCCESS"?"FINISHED_WITH_RETURN":"FINISHED_WITH_ERROR",
  txDataDecoded:decoded,
 } as GenLayerTransaction;
}

export class PendingFinality extends Error {}
export function assertFinalized(tx:GenLayerTransaction,expected?:{target:string;method:string;args:unknown[];sender?:string}){
 const status=tx.statusName??transactionsStatusNumberToName[String(tx.status) as keyof typeof transactionsStatusNumberToName]??tx.status;
 if(status!=="FINALIZED"){if(["CANCELED","UNDETERMINED","VALIDATORS_TIMEOUT","LEADER_TIMEOUT"].includes(String(status)))throw Error("GenLayer transaction failed: "+status);throw new PendingFinality("GenLayer consensus is not finalized");}
 const execution=tx.txExecutionResultName??executionResultNumberToName[String(tx.txExecutionResult) as keyof typeof executionResultNumberToName];
 if(execution!=="FINISHED_WITH_RETURN")throw Error("GenLayer VM execution was not successful");
 const result=tx.resultName??transactionResultNumberToName[String(tx.result) as keyof typeof transactionResultNumberToName];if(!["AGREE","MAJORITY_AGREE","SUCCESS"].includes(String(result)))throw Error("GenLayer consensus did not approve execution");if(tx.txDataDecoded?.leaderOnly!==false)throw Error("GenLayer validator consensus is required");
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
 async send(id:string,action:(client:ReturnType<typeof createClient>)=>Promise<unknown>){
 let saved=await this.store.get<Signed>("transactions","gl:"+id);if(saved?.protocolHash)return saved.protocolHash;
 if(!saved){
 const account=this.account();const capture={...account,signTransaction:async(...args:Parameters<typeof account.signTransaction>)=>{throw new Prepared(await account.signTransaction(...args))}};
 const client=createClient({chain:studionet,endpoint:this.cfg.genLayerRpc,account:capture});
 try{await action(client);throw Error("GenLayer did not produce a signed transaction")}catch(e){if(!(e instanceof Prepared))throw e;const row={_id:"gl:"+id,raw:e.raw,evmHash:keccak256(e.raw),createdAt:Date.now()};if(await this.store.create("transactions",row))saved=row;else saved=await this.store.get("transactions",row._id);}
 }
 if(!saved)throw Error("Signed GenLayer transaction was not persisted");
 // Recover the same raw transaction after a crash; a new nonce can never replace this job.
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
 async read(address:string,functionName:string,args:string[]=[]){return this.client.readContract({address:address as Address,functionName,args,jsonSafeReturn:true,transactionHashVariant:TransactionHashVariant.LATEST_FINAL})}
 async propose(d:Draft){return this.send("draft:"+d._id,c=>c.writeContract({address:this.cfg.interpreter as Address,functionName:"propose",args:[d._id,canonical(d.input)],value:0n}))}
 async draft(d:Draft){if(!d.genLayerTxHash)throw Error("Missing draft transaction");const tx=await this.client.getTransaction({hash:d.genLayerTxHash as GLHash});assertFinalized(tx,{target:this.cfg.interpreter!,method:"propose",args:[d._id,canonical(d.input)],sender:this.account().address});
 if(await this.read(this.cfg.interpreter!,"get_draft_input_hash",[d._id])!==d.inputHash)throw Error("Draft input commitment mismatch");
 const raw=await this.read(this.cfg.interpreter!,"get_draft",[d._id]);const result=JSON.parse(String(raw)) as DraftResult;
 if(!["PROPOSED","NEEDS_CLARIFICATION"].includes(result.status)||!Array.isArray(result.questions)||typeof result.interpretation!=="string")throw Error("Invalid draft result");
 if(result.status==="PROPOSED")result.policy=policySchema.parse(result.policy);else if(result.policy!==null)throw Error("Clarification must not authorize policy");return result;}
 reviewerArgs(c:Card){return [genLayerAddress(this.account().address),canonical(c.policy),c.policyHash,Number(c.chainId??this.cfg.chainId),String(c.token??this.cfg.token).toLowerCase()]}
 async deployReviewer(c:Card){const source=await readFile(new URL("../../../contracts/genlayer/purchase_reviewer.py",import.meta.url));return this.send("reviewer:"+c._id,client=>client.deployContract({code:source,args:this.reviewerArgs(c)}))}
 async reviewer(c:Card){if(!c.reviewerTx)throw Error("Missing reviewer deployment");const tx=await this.client.getTransaction({hash:c.reviewerTx as GLHash});assertFinalized(tx);const decoded=tx.txDataDecoded;
 if(!decoded||decoded.type!=="deploy"||!("contractAddress" in decoded))throw Error("Expected reviewer deployment transaction");
 const source=await readFile(new URL("../../../contracts/genlayer/purchase_reviewer.py",import.meta.url),"utf8");
 const constructor=normalizedCalldata(decoded.constructorArgs) as {args?:unknown[]};
 if(decoded.code!==source||canonical(constructor?.args??[])!==canonical(normalizedCalldata(this.reviewerArgs(c))))throw Error("Reviewer deployment code or constructor mismatch");
 const address=decoded.contractAddress??tx.recipient??tx.to_address;if(!address)throw Error("Missing reviewer address");
 if((tx.sender??tx.from_address)?.toLowerCase()!==this.account().address.toLowerCase())throw Error("Reviewer deployer mismatch");
 if(await this.read(address,"get_policy_hash")!==c.policyHash)throw Error("Reviewer policy mismatch");
 if(String(await this.read(address,"get_operator")).toLowerCase()!==this.account().address.toLowerCase())throw Error("Reviewer operator mismatch");
 if(Number(await this.read(address,"get_chain_id"))!==Number(c.chainId??this.cfg.chainId)||String(await this.read(address,"get_token")).toLowerCase()!==String(c.token??this.cfg.token).toLowerCase())throw Error("Reviewer payment network mismatch");return address;}
 async submit(c:Card,p:Payment){if(!c.reviewerAddress||!p.canonical||!p.snapshots)throw Error("Missing review context");return this.send("review:"+p._id,client=>client.writeContract({address:c.reviewerAddress as Address,functionName:"review",args:[p._id,canonical(p.canonical),canonical(p.snapshots)],value:0n}))}
 async decision(c:Card,p:Payment){if(!p.genLayerTxHash||!c.reviewerAddress||!p.canonical||!p.snapshots)throw Error("Missing review transaction");const tx=await this.client.getTransaction({hash:p.genLayerTxHash as GLHash});assertFinalized(tx,{target:c.reviewerAddress,method:"review",args:[p._id,canonical(p.canonical),canonical(p.snapshots)],sender:this.account().address});return JSON.parse(String(await this.read(c.reviewerAddress,"get_review",[p._id]))) as ReviewDecision;}
}
