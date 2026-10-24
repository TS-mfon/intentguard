import {z} from "zod";
import {randomBytes,timingSafeEqual} from "node:crypto";
import {address,hash,parseAmount,paymentSchema,digest,canonical,type RequestView,type DraftView} from "../../../packages/shared";
import {ApiError,responseError} from "./errors";
import {configuration,publicConfiguration} from "./config";
import {challenge,login,requireOwner,requireAgent,ownerSession,issueKey,revokeKeys,rateLimit} from "./auth";
import {database,type Store} from "./store";
import type {Card,Draft,Payment} from "./models";
import {activeStatuses} from "./models";
import {Evm,activationConfig,type EvmPort} from "./evm";
import {evidenceAllowed,requestId} from "./worker";
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"no-store"}});
async function body(req:Request){const length=Number(req.headers.get("content-length")??0);if(length>32768)throw new ApiError(413,"BODY_TOO_LARGE","Request exceeds 32 KiB");const reader=req.body?.getReader();if(!reader)throw new ApiError(422,"INVALID_JSON","Supply a JSON request body");const chunks:Uint8Array[]=[];let size=0;while(true){const result=await reader.read();if(result.done)break;size+=result.value.byteLength;if(size>32768){await reader.cancel();throw new ApiError(413,"BODY_TOO_LARGE","Request exceeds 32 KiB")}chunks.push(result.value)}const raw=new TextDecoder().decode(Buffer.concat(chunks));if(Buffer.byteLength(raw)>32768)throw new ApiError(413,"BODY_TOO_LARGE","Request exceeds 32 KiB");try{return JSON.parse(raw)}catch{throw new ApiError(422,"INVALID_JSON","Supply a JSON request body")}}
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const r=schema.safeParse(value);if(!r.success)throw new ApiError(422,"INVALID_INPUT",r.error.issues[0]?.message??"Invalid input");return r.data}
function origin(req:Request){if(req.headers.get("origin")!==new URL(configuration().origin).origin)throw new ApiError(403,"ORIGIN_DENIED","Action must originate from this application")}
export function createApi(store:Store,evm:EvmPort,{requireConfigured=true}={}){
 return async (req:Request,path:string):Promise<Response>=>{
 try{
 const c=configuration(),method=req.method;
 if(path==="/config"&&method==="GET")return json(publicConfiguration());
 if(path==="/auth/session"&&method==="GET")return json({address:process.env.SESSION_SECRET?ownerSession(req.headers.get("cookie")):null});
 if(path==="/auth/logout"&&method==="POST"){origin(req);return new Response(null,{status:204,headers:{"Set-Cookie":"ig_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"}});}
 if(requireConfigured&&!c.configured)throw new ApiError(503,"NOT_CONFIGURED","IntentGuard runtime is not configured");
 if(path==="/auth/challenge"&&method==="POST"){origin(req);const v=parse(z.object({address}).strict(),await body(req));await rateLimit(store,"login:"+v.address.toLowerCase(),10);return json(await challenge(store,v.address,c.origin));}
 if(path==="/auth/login"&&method==="POST"){origin(req);const v=parse(z.object({address,signature:z.string().regex(/^0x[0-9a-fA-F]+$/)}).strict(),await body(req));const cookie=await login(store,v.address,v.signature);return Response.json({address:v.address.toLowerCase()},{headers:{"Cache-Control":"no-store","Set-Cookie":"ig_session="+cookie+"; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600"+(new URL(c.origin).protocol==="https:"?"; Secure":"")}});}
 if(c.testnet&&path.startsWith("/demo/invoices")){
 const match=path.match(/^\/demo\/invoices\/([a-f0-9]{32})$/);
 if(method==="GET"&&match){
 const saved=await store.get<{_id:string;content:string}>("demoInvoices",match[1]);
 if(!saved)throw new ApiError(404,"NOT_FOUND","Invoice not found");
 return new Response(saved.content,{headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=31536000, immutable"}});
 }
 if(path==="/demo/invoices"&&method==="POST"){
 const configured=process.env.DEMO_MERCHANT_ADMIN_KEY??"",provided=req.headers.get("authorization")?.replace(/^Bearer /,"")??"";
 const a=Buffer.from(provided),b=Buffer.from(configured);
 if(b.length<32||a.length!==b.length||!timingSafeEqual(a,b))throw new ApiError(401,"MERCHANT_ADMIN_REQUIRED","Merchant administrator key required");
 const v=parse(z.object({buyer:address,amount:z.string().refine(value=>{try{return parseAmount(value)>0n}catch{return false}}),description:z.string().min(3).max(1000)}).strict(),await body(req));
 const recipient=address.parse(process.env.DEMO_MERCHANT_RECIPIENT);
 const invoiceId=randomBytes(16).toString("hex"),issuedAt=Math.floor(Date.now()/1000);
 const invoice={invoiceId,buyer:v.buyer.toLowerCase(),token:c.token.toLowerCase(),chainId:c.chainId,recipient:recipient.toLowerCase(),amount:v.amount,description:v.description,issuedAt,expiresAt:issuedAt+7200};
 await store.create("demoInvoices",{_id:invoiceId,content:JSON.stringify(invoice),createdAt:Date.now()});
 return json({invoice,url:c.origin+"/api/v1/demo/invoices/"+invoiceId},201);
 }
 throw new ApiError(404,"NOT_FOUND","Invoice endpoint not found");
 }
 if(path.startsWith("/owner/")){
 const owner=requireOwner(req,c.origin);await rateLimit(store,"owner:"+owner,120);
 const owned=async(id:string)=>{const card=await store.get<Card>("cards",id);if(!card||card.owner!==owner)throw new ApiError(404,"NOT_FOUND","Card not found");return card};
 if(path==="/owner/drafts"&&method==="POST"){const input=parse(z.object({description:z.string().min(10).max(12000),guidance:z.record(z.string(),z.unknown()).optional()}).strict(),await body(req));if(Buffer.byteLength(canonical(input))>16384)throw new ApiError(422,"INPUT_TOO_LARGE","Keep the complete mission and guidance within 16 KiB");const id=requestId(),now=Date.now();await store.create("drafts",{_id:id,owner,input,inputHash:digest(input),state:"QUEUED",createdAt:now,updatedAt:now});return json({id,status:"QUEUED"},202);}
 let match=path.match(/^\/owner\/drafts\/([^/]+)$/);
 if(match&&method==="GET"){const d=await store.get<Draft>("drafts",match[1]);if(!d||d.owner!==owner)throw new ApiError(404,"NOT_FOUND","Draft not found");const result={id:d._id,state:d.state,status:d.result?.status??"PENDING",policy:d.result?.policy??null,questions:d.result?.questions??[],interpretation:d.result?.interpretation??"",genLayerTxHash:d.genLayerTxHash,error:d.error,...(d.state==="FINALIZED"&&d.result?.policy?{activation:{factoryAddress:c.factoryAddress,config:activationConfig(owner,d.result.policy)}}:{})};return json(result);}
 if(path==="/owner/cards"&&method==="GET"){const cards=await store.find<Card>("cards",{owner});return json({cards:await Promise.all(cards.map(card=>evm.view(card)))});}
 if(path==="/owner/cards"&&method==="POST"){
 const input=parse(z.object({draftId:hash,cardAddress:address,activationTx:hash}).strict(),await body(req));const draft=await store.get<Draft>("drafts",input.draftId);
 if(!draft||draft.owner!==owner)throw new ApiError(404,"NOT_FOUND","Draft not found");
 if(draft.state!=="FINALIZED"||draft.result?.status!=="PROPOSED"||!draft.result.policy)throw new ApiError(409,"POLICY_NOT_FINAL","Wait for a finalized policy proposal");
 let block;try{block=await evm.verifyActivation(owner,draft.result.policy,input.cardAddress,input.activationTx)}catch{throw new ApiError(422,"ACTIVATION_INVALID","Activation must match this owner, policy and configured factory")}
 const now=Date.now();const card:Card={_id:input.draftId,owner,draftId:input.draftId,address:input.cardAddress.toLowerCase(),activationTx:input.activationTx,activationBlock:block,policy:draft.result.policy,policyHash:digest(draft.result.policy),state:"SETTING_UP",keyStatus:"NONE",createdAt:now,updatedAt:now,chainId:c.chainId,token:c.token};
 if(!await store.create("cards",card)){const existing=await owned(card._id);if(existing.address!==card.address)throw new ApiError(409,"DRAFT_ALREADY_ACTIVATED","This draft already has a spending card");return json({card:await evm.view(existing)});}
 return json({card:await evm.view(card)},201);
 }
 match=path.match(/^\/owner\/cards\/([^/]+)\/keys$/);
 if(match){const card=await owned(match[1]);if(method==="POST"){if(card.state!=="READY")throw new ApiError(409,"REVIEWER_PENDING","GenLayer reviewer is still being initialized");const view=await evm.view(card);if(view.status!=="ACTIVE")throw new ApiError(409,"CARD_DISABLED","Enable this card before issuing a key");const apiKey=await issueKey(store,card._id,owner);await store.patch("cards",card._id,{keyStatus:"ACTIVE"});return json({apiKey},201);}
 if(method==="DELETE"){await revokeKeys(store,card._id);await store.patch("cards",card._id,{keyStatus:"REVOKED"});for(const p of await store.find<Payment>("requests",{cardId:card._id,status:{$in:activeStatuses}}))await store.patch("requests",p._id,{cancelRequested:true});return new Response(null,{status:204});}}
 if(path==="/owner/requests"&&method==="GET"){const requests=await store.find<Payment>("requests",{owner});return json({requests:await Promise.all(requests.sort((a,b)=>b.createdAt-a.createdAt).map(p=>requestView(store,p)))});}
 match=path.match(/^\/owner\/requests\/([^/]+)$/);
 if(match&&method==="GET"){const p=await store.get<Payment>("requests",match[1]);if(!p||p.owner!==owner)throw new ApiError(404,"NOT_FOUND","Request not found");return json(await requestView(store,p));}
 }else{
 const key=await requireAgent(store,req);const card=await store.get<Card>("cards",key.cardId);if(!card||card.owner!==key.owner)throw new ApiError(401,"KEY_INVALID","Agent card is unavailable");
 if(path==="/me"&&method==="GET")return json({card:await evm.view(card)});
 if(path==="/requests"&&method==="POST"){
 const idempotency=req.headers.get("idempotency-key");if(!idempotency||!/^[ -~]{1,128}$/.test(idempotency))throw new ApiError(422,"IDEMPOTENCY_REQUIRED","Provide an Idempotency-Key of 1–128 printable characters");
 const input=parse(paymentSchema,await body(req));if(Buffer.byteLength(canonical(input))>14000)throw new ApiError(422,"INPUT_TOO_LARGE","Keep payment details within 14 KiB");
 // Stable card-scoped request ID makes admission atomic even across key rotations.
 const id=digest({cardId:card._id,idempotency}),inputHash=digest(input),existing=await store.get<Payment>("requests",id);
 if(existing){if(existing.inputHash!==inputHash)throw new ApiError(409,"IDEMPOTENCY_CONFLICT","This key was already used for different payment details");return json({id,status:existing.status},202);}
 if(card.state!=="READY")throw new ApiError(409,"REVIEWER_PENDING","GenLayer reviewer is not ready");if((await evm.view(card)).status!=="ACTIVE")throw new ApiError(409,"CARD_DISABLED","The owner has disabled this card");
 try{evidenceAllowed(card,input)}catch{throw new ApiError(422,"EVIDENCE_ORIGIN","Evidence must come from an owner-approved origin")}
 const now=Date.now(),p:Payment={_id:id,owner:card.owner,cardId:card._id,keyId:key._id,input,inputHash,status:"QUEUED",createdAt:now,updatedAt:now};
 if(!await store.create("requests",p)){const prior=await store.get<Payment>("requests",id);if(prior?.inputHash!==inputHash)throw new ApiError(409,"IDEMPOTENCY_CONFLICT","This key was already used for different payment details");return json({id,status:prior.status},202);}
 return json({id,status:"QUEUED"},202);
 }
 const match=path.match(/^\/requests\/([^/]+)$/);if(match&&method==="GET"){const p=await store.get<Payment>("requests",match[1]);if(!p||p.cardId!==card._id)throw new ApiError(404,"NOT_FOUND","Request not found");return json(await requestView(store,p));}
 }
 throw new ApiError(404,"NOT_FOUND","API endpoint not found");
 }catch(e){return responseError(e)}
 };
}
export async function requestView(store:Store,p:Payment):Promise<RequestView>{const card=await store.get<Card>("cards",p.cardId);return {id:p._id,cardId:p.cardId,cardName:card?.policy.name??"Agent",status:p.status,request:p.input,requestHash:p.requestHash??"",evidenceHash:p.evidenceHash??"",guard:p.guard,review:p.review,genLayerTxHash:p.genLayerTxHash,paymentTxHash:p.paymentTxHash,error:p.error,createdAt:p.createdAt,updatedAt:p.updatedAt};}
export async function route(req:Request){
 const pathname=new URL(req.url).pathname;const path=pathname.replace(/^\/api\/v1/,"");
 if(path==="/config"&&req.method==="GET")return json(publicConfiguration());
 if(path==="/auth/session"&&req.method==="GET")return json({address:process.env.SESSION_SECRET?ownerSession(req.headers.get("cookie")):null});
 if(path==="/auth/logout"&&req.method==="POST"){try{origin(req);return new Response(null,{status:204,headers:{"Set-Cookie":"ig_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"}})}catch(e){return responseError(e)}}
 try{const store=await database();return await createApi(store,new Evm(store))(req,path)}catch(e){return responseError(e)}
}
