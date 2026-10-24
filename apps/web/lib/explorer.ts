import {canonical,validateDecision,hash,type ReviewDecision} from "../../../packages/shared";
import {ApiError} from "./errors";
import {configuration} from "./config";
import {GenLayer,assertFinalized} from "./genlayer";
import {MemoryStore,type Store} from "./store";
import type {Card,Payment} from "./models";
import type {EvmPort} from "./evm";
import type {Hash as GLHash} from "genlayer-js/types";
const states=new Set(["QUEUED","RESERVED","REVIEWING","AWAITING_FINALITY","APPROVED","PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","EXPIRED","CANCELLED","RETRYING"]);
export type PublicReviewReader=(card:Card,payment:Payment)=>Promise<ReviewDecision>;
export async function contractReasoning(card:Card,p:Payment):Promise<ReviewDecision>{
 if(!card.reviewerAddress||!p.genLayerTxHash||!p.canonical||!p.snapshots||!p.review||!p.requestHash)throw Error("Finalized review is not available");
 const gl=new GenLayer(new MemoryStore()),operator=String(await gl.read(card.reviewerAddress,"get_operator"));
 const tx=await gl.client.getTransaction({hash:p.genLayerTxHash as GLHash});
 assertFinalized(tx,{target:card.reviewerAddress,method:"review",args:[p._id,canonical(p.canonical),canonical(p.snapshots)],sender:operator});
 if(await gl.read(card.reviewerAddress,"get_policy_hash")!==card.policyHash)throw Error("Reviewer policy mismatch");
 const review=validateDecision(JSON.parse(String(await gl.read(card.reviewerAddress,"get_review",[p._id]))),card.policy,p.canonical,p.requestHash);
 if(canonical(review)!==canonical(p.review))throw Error("Contract review differs from committed worker decision");
 return review;
}
function pageOptions(url:URL,defaultLimit:number){
 const raw=url.searchParams.get("limit"),limit=raw===null?defaultLimit:Number(raw);
 if(!Number.isInteger(limit)||limit<1||limit>50)throw new ApiError(422,"INVALID_INPUT","Limit must be an integer from1 to50");
 const cursor=url.searchParams.get("cursor");let query:Record<string,unknown>={};
 if(cursor){try{const value=JSON.parse(Buffer.from(cursor,"base64url").toString());if(!Number.isSafeInteger(value.createdAt)||typeof value.id!=="string"||!hash.safeParse(value.id).success)throw Error();query={$or:[{createdAt:{$lt:value.createdAt}},{createdAt:value.createdAt,_id:{$lt:value.id}}]}}catch{throw new ApiError(422,"INVALID_INPUT","Invalid explorer cursor")}}
 return {limit,query};
}
function cursor(row:Card|Payment|undefined){return row?Buffer.from(JSON.stringify({createdAt:row.createdAt,id:row._id})).toString("base64url"):null}
async function publicAgent(card:Card,evm:EvmPort){
 let view:Awaited<ReturnType<EvmPort["view"]>>|null=null;try{view=await evm.view(card)}catch{}
 return {id:card._id,name:card.policy.name,mission:card.policy.mission,address:card.address,owner:card.owner,policyHash:card.policyHash,chainId:Number(card.chainId??configuration().chainId),token:String(card.token??configuration().token),status:view?.status??"UNAVAILABLE",setupState:card.state,reviewerAddress:card.reviewerAddress??"",financial:card.policy.financial,balances:view?.balances??null,createdAt:card.createdAt};
}
function publicTransaction(p:Payment,card:Card|null){
 return {id:p._id,cardId:p.cardId,agentName:card?.policy.name??"Agent",status:p.status,amount:p.input.amount,recipient:p.input.recipient,category:p.input.category,purchaseDescription:p.input.purchaseDescription,createdAt:p.createdAt,updatedAt:p.updatedAt,guard:p.guard,review:p.review,genLayerTxHash:p.genLayerTxHash,paymentTxHash:p.paymentTxHash,requestHash:p.requestHash??"",evidenceHash:p.evidenceHash??"",chainId:Number(card?.chainId??configuration().chainId),token:String(card?.token??configuration().token)};
}
export function createExplorer(store:Store,evm:EvmPort,readReview:PublicReviewReader=contractReasoning){
 return async(req:Request,path:string)=>{
 if(req.method!=="GET")throw new ApiError(404,"NOT_FOUND","Explorer endpoint not found");
 const url=new URL(req.url);
 if(path==="/explorer/agents"){
 const {limit,query}=pageOptions(url,20),rows=await store.find<Card>("cards",query,{limit:limit+1}),page=rows.slice(0,limit);
 return {agents:await Promise.all(page.map(card=>publicAgent(card,evm))),nextCursor:rows.length>limit?cursor(page.at(-1)):null};
 }
 if(path==="/explorer/transactions"){
 const {limit,query}=pageOptions(url,20),status=url.searchParams.get("status"),agentId=url.searchParams.get("agentId");
 if(status){if(!states.has(status))throw new ApiError(422,"INVALID_INPUT","Unknown transaction status");query.status=status}
 if(agentId){if(!hash.safeParse(agentId).success)throw new ApiError(422,"INVALID_INPUT","Invalid agent identifier");query.cardId=agentId}
 const rows=await store.find<Payment>("requests",query,{limit:limit+1}),page=rows.slice(0,limit);
 const cards=new Map<string,Card|null>();await Promise.all([...new Set(page.map(p=>p.cardId))].map(async id=>cards.set(id,await store.get<Card>("cards",id))));
 return {transactions:page.map(p=>publicTransaction(p,cards.get(p.cardId)??null)),nextCursor:rows.length>limit?cursor(page.at(-1)):null};
 }
 const match=path.match(/^\/explorer\/transactions\/(0x[0-9a-fA-F]{64})$/);
 if(match){
 const p=await store.get<Payment>("requests",match[1]);if(!p)throw new ApiError(404,"NOT_FOUND","Transaction not found");
 const card=await store.get<Card>("cards",p.cardId);let reasoningSource="pending",verified:ReviewDecision|undefined;
 if(p.review&&card){try{verified=await readReview(card,p);reasoningSource="genlayer-finalized-contract"}catch{reasoningSource="unavailable"}}
 const transaction=publicTransaction(p,card);transaction.review=verified;
 return {transaction,agent:card?await publicAgent(card,evm):null,reasoningSource};
 }
 throw new ApiError(404,"NOT_FOUND","Explorer endpoint not found");
 };
}
