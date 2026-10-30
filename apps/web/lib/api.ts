import {parseStrictJson} from "../../../packages/shared/strict-json";
import {z} from "zod";
import {randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import {address,hash,parseAmount,paymentSchema,digest,canonical,isSettlementV2,type RequestView,type DraftView} from "../../../packages/shared";
import {ApiError,responseError,responseHeaders} from "./errors";
import {assertApplicationOrigin,ownerContext,browserCors} from "./origins";
import {createExplorer} from "./explorer";
import {reviewStage} from "./review-stage";
import {configuration} from "./config";
import {publicDeploymentConfiguration} from "./capabilities";
import {runtimeManifest} from "./deployment-profile";
import {challenge,login,requireOwner,requireAgent,requestOwnerSession,logoutOwnerSession,ownerSessionExpiry,issueKey,revokeKeys,rateLimit} from "./auth";
import {database,type Store} from "./store";
import type {Card,Draft,Payment} from "./models";
import {activeStatuses} from "./models";
import {Evm,activationConfig,type EvmPort} from "./evm";
import {evidenceAllowed,requestId} from "./worker";
import {CCTP_TESTNETS} from "../../../packages/shared/assets";
import {normalizeSettlement,settlementFactory,destinationDomains,cardSymbol,paymentDestination,settlementToken,assertSettlementReady,assertCardEnvironment} from "./settlement";
import {replacementDetails,createReplacementDraft,replacementWarnings} from "./replacement";
import {wakeWorker} from "./worker-wake";
import {createSandbox} from "./sandbox";
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"no-store"}});
async function body(req:Request){if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type")??""))throw new ApiError(415,"UNSUPPORTED_MEDIA_TYPE","Use Content-Type: application/json for JSON request bodies");const length=Number(req.headers.get("content-length")??0);if(length>32768)throw new ApiError(413,"BODY_TOO_LARGE","Request exceeds 32 KiB");const reader=req.body?.getReader();if(!reader)throw new ApiError(400,"INVALID_JSON","Supply a JSON request body");const chunks:Uint8Array[]=[];let size=0;while(true){const result=await reader.read();if(result.done)break;size+=result.value.byteLength;if(size>32768){await reader.cancel();throw new ApiError(413,"BODY_TOO_LARGE","Request exceeds 32 KiB")}chunks.push(result.value)}const raw=new TextDecoder().decode(Buffer.concat(chunks));if(Buffer.byteLength(raw)>32768)throw new ApiError(413,"BODY_TOO_LARGE","Request exceeds 32 KiB");try{return parseStrictJson(raw)}catch{throw new ApiError(400,"INVALID_JSON","Supply a JSON request body")}}
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const r=schema.safeParse(value);if(!r.success)throw new ApiError(422,"INVALID_INPUT",r.error.issues[0]?.message??"Invalid input",r.error.issues.map(i=>({field:i.path.join("."),code:i.code,message:i.message})));return r.data}
function origin(req:Request){return assertApplicationOrigin(req,configuration().origin)}
async function requestConfiguration(req:Request){
 const config=await publicDeploymentConfiguration(),c=configuration(),target=new URL(req.url).origin;
 // Existing testnet aliases serve the same API and use their own host cookies.
 // Separate frontends and mainnet keep their explicitly pinned origins.
 if(c.testnet&&c.frontendOrigin===c.origin&&target!==c.origin)return {...config,apiOrigin:target,frontendOrigin:target};
 return config;
}
export function createApi(store:Store,evm:EvmPort,{requireConfigured=true,wake=()=>wakeWorker(store)}:{requireConfigured?:boolean;wake?:()=>unknown|Promise<unknown>}={}){
 const notifyWorker=async()=>{try{await wake();}catch{console.error("Worker wake failed; the durable queue is retained for recovery.");}};
 const handler=async (req:Request,path:string):Promise<Response>=>{
 const correlation=randomUUID(),headers:Record<string,string>={};
 const response=await (async():Promise<Response>=>{
 try{
 const allowed=endpointMethods(path);
 Object.assign(headers,browserCors(req,allowed??[]));
 if(req.method==="OPTIONS")return new Response(null,{status:204});
 if(!allowed)throw new ApiError(404,"NOT_FOUND","API endpoint not found");
 if(!allowed.includes(req.method))throw new ApiError(405,"METHOD_NOT_ALLOWED","Use "+allowed.join(" or ")+" for this endpoint",undefined,undefined,allowed.join(", "));

 const c=configuration(),method=req.method;
 if(path==="/config"&&method==="GET")return json(await requestConfiguration(req));
 if(path==="/auth/session"&&method==="GET")return json({address:process.env.SESSION_SECRET?await requestOwnerSession(store,req):null});
 if(path==="/auth/logout"&&method==="POST"){await logoutOwnerSession(store,req);return new Response(null,{status:204,headers:{"Set-Cookie":"ig_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"}});}
 if(path==="/health"&&method==="GET"){const config=await publicDeploymentConfiguration(),runtime=await store.get("locks","worker-runtime"),heartbeat=Number(runtime?.heartbeatAt??0),workerFresh=heartbeat>Date.now()-15*60000;return json({status:config.configured&&workerFresh?"ready":"degraded",releaseId:c.releaseId,sourceCommit:c.sourceCommit,paymentEnvironment:c.paymentEnvironment,paymentChainId:c.chainId,reviewEnvironment:"testnet",reviewNetwork:"studionet",reviewChainId:61999,reviewInfrastructure:"studionet-simulator",deploymentVerified:config.configured,database:"reachable",worker:{fresh:workerFresh,lastHeartbeatAt:heartbeat||null},readinessReasons:[...config.readinessReasons,...(workerFresh?[]:["WORKER_STALE"])]},config.configured&&workerFresh?200:503);}
 if(requireConfigured&&!c.configured)throw new ApiError(503,"NOT_CONFIGURED","IntentGuard runtime is not configured");
 if(c.mainnet){try{await runtimeManifest(c)}catch{throw new ApiError(503,"DEPLOYMENT_NOT_VERIFIED","The mainnet deployment proof does not match this runtime.");}}
 if(path.startsWith("/sandbox"))return await createSandbox(store,evm,{submit:r=>handler(r,"/requests"),view:p=>requestView(store,p),wake:notifyWorker})(req,path,method==="POST"?await body(req):undefined);
 if(path==="/auth/challenge"&&method==="POST"){origin(req);const v=parse(z.object({address}).strict(),await body(req));await rateLimit(store,"login:"+v.address.toLowerCase(),10);const context=ownerContext(req);return json(await challenge(store,v.address,context.origin,context.transport));}
 if(path==="/auth/login"&&method==="POST"){origin(req);const v=parse(z.object({address,signature:z.string().regex(/^0x[0-9a-fA-F]+$/)}).strict(),await body(req));const context=ownerContext(req),cookie=await login(store,v.address,v.signature,context);if(context.transport==="owner-bearer")return json({address:v.address.toLowerCase(),ownerSession:cookie,expiresAt:ownerSessionExpiry(cookie)});return Response.json({address:v.address.toLowerCase()},{headers:{"Cache-Control":"no-store","Set-Cookie":"ig_session="+cookie+"; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600"+(new URL(req.url).protocol==="https:"?"; Secure":"")}});}
 if(path.startsWith("/explorer/")){const result=await createExplorer(store,evm)(req,path);return result instanceof Response?result:json(result)}
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
 const v=parse(z.object({buyer:address,amount:z.string().refine(value=>{try{return parseAmount(value)>0n}catch{return false}}),description:z.string().min(3).max(1000),chainId:z.number().int().positive().optional(),token:address.optional()}).strict(),await body(req));
 const invoiceChain=v.chainId??c.chainId,invoiceToken=v.token??c.token;
 if((v.chainId===undefined)!==(v.token===undefined))throw new ApiError(422,"INVOICE_ASSET_REQUIRED","Provide both chainId and token or omit both for the legacy configured asset.");
 const issuerRoute=CCTP_TESTNETS[invoiceChain as keyof typeof CCTP_TESTNETS];
 if((invoiceChain!==c.chainId||invoiceToken.toLowerCase()!==c.token.toLowerCase())&&(!issuerRoute||issuerRoute.token.toLowerCase()!==invoiceToken.toLowerCase()))throw new ApiError(422,"ASSET_OR_ROUTE_UNSUPPORTED","Invoice assets must be the configured legacy token or official USDC on a supported testnet.");
 const recipient=address.parse(process.env.DEMO_MERCHANT_RECIPIENT);
 const invoiceId=randomBytes(16).toString("hex"),issuedAt=Math.floor(Date.now()/1000);
 const invoice={invoiceId,buyer:v.buyer.toLowerCase(),token:invoiceToken.toLowerCase(),chainId:invoiceChain,recipient:recipient.toLowerCase(),amount:v.amount,description:v.description,issuedAt,expiresAt:issuedAt+7200};
 await store.create("demoInvoices",{_id:invoiceId,content:JSON.stringify(invoice),createdAt:Date.now()});
 return json({invoice,url:new URL(req.url).origin+"/api/v1/demo/invoices/"+invoiceId},201);
 }
 throw new ApiError(404,"NOT_FOUND","Invoice endpoint not found");
 }
 if(path.startsWith("/owner/")){
 const owner=await requireOwner(req,c.origin,store);Object.assign(headers,quotaHeaders(await rateLimit(store,"owner:"+owner,120)));
 const owned=async(id:string)=>{const card=await store.get<Card>("cards",id);if(!card||card.owner!==owner)throw new ApiError(404,"NOT_FOUND","Card not found");assertCardEnvironment(card);return card};
 if(path==="/owner/drafts"&&method==="POST"){const input=parse(z.object({description:z.string().min(10).max(12000),guidance:z.record(z.string(),z.unknown()).optional(),settlement:z.unknown().optional()}).strict(),await body(req));const settlement=normalizeSettlement(input.settlement);if(settlement){settlementFactory(settlement);await assertSettlementReady(settlement);}const interpreterInput={description:input.description,...(input.guidance?{guidance:input.guidance}:{})};if(Buffer.byteLength(canonical(interpreterInput))>16384)throw new ApiError(422,"INPUT_TOO_LARGE","Keep the complete mission and guidance within 16 KiB");const id=requestId(),now=Date.now();await store.create("drafts",{_id:id,owner,input:interpreterInput,inputHash:digest(interpreterInput),...(settlement?{settlement}:{}),state:"QUEUED",interpreterAddress:c.interpreter,createdAt:now,updatedAt:now});await notifyWorker();return json({id,status:"QUEUED"},202);}
 let match=path.match(/^\/owner\/drafts\/([^/]+)$/);
 if(match&&method==="GET"){const d=await store.get<Draft>("drafts",match[1]);if(!d||d.owner!==owner)throw new ApiError(404,"NOT_FOUND","Draft not found");if(["QUEUED","AWAITING_FINALITY"].includes(d.state))await notifyWorker();const result={id:d._id,state:d.state,status:d.result?.status??"PENDING",input:d.input,policy:d.result?.policy??null,questions:d.result?.questions??[],interpretation:d.result?.interpretation??"",genLayerTxHash:d.genLayerTxHash,error:d.error,settlement:d.settlement,...(d.state==="FINALIZED"&&d.result?.policy?{activation:{factoryAddress:settlementFactory(d.settlement),config:activationConfig(owner,d.result.policy,d.settlement),...(d.settlement?{kind:d.settlement.asset==="USDT0"?"USDT0_LOCAL":isSettlementV2(d.settlement)?"CCTP_V4":"CCTP_V2",destinationDomains:destinationDomains(d.settlement),settlement:d.settlement}:{})}}:{})};return json(result);}
 if(path==="/owner/cards"&&method==="GET"){const cards=await store.find<Card>("cards",{owner});if(cards.some(card=>card.state==="SETTING_UP"))await notifyWorker();return json({cards:await Promise.all(cards.map(card=>evm.view(card)))});}
 if(path==="/owner/cards"&&method==="POST"){
 const input=parse(z.object({draftId:hash,cardAddress:address,activationTx:hash}).strict(),await body(req));const draft=await store.get<Draft>("drafts",input.draftId);
 if(!draft||draft.owner!==owner)throw new ApiError(404,"NOT_FOUND","Draft not found");
 if(draft.state!=="FINALIZED"||draft.result?.status!=="PROPOSED"||!draft.result.policy)throw new ApiError(409,"POLICY_NOT_FINAL","Wait for a finalized policy proposal");
 let block;try{block=await evm.verifyActivation(owner,draft.result.policy,input.cardAddress,input.activationTx,draft.settlement)}catch{throw new ApiError(422,"ACTIVATION_INVALID","Activation must match this owner, policy and configured factory")}
 const now=Date.now();const card:Card={_id:input.draftId,owner,draftId:input.draftId,...(draft.replacesCardId?{replacesCardId:draft.replacesCardId}:{}),address:input.cardAddress.toLowerCase(),activationTx:input.activationTx,activationBlock:block,policy:draft.result.policy,policyHash:digest(draft.result.policy),state:"SETTING_UP",keyStatus:"NONE",createdAt:now,updatedAt:now,chainId:c.chainId,token:settlementToken(draft.settlement),...(draft.settlement?{settlement:draft.settlement,...(isSettlementV2(draft.settlement)?{reviewerVersion:4,paymentEnvironment:c.paymentEnvironment as "mainnet"|"testnet",reviewNetwork:"studionet",reviewGenesis:c.genLayerGenesis,reviewConsensus:c.genLayerConsensus}:{})}: {})};
 if(!await store.create("cards",card)){const existing=await owned(card._id);if(existing.address!==card.address)throw new ApiError(409,"DRAFT_ALREADY_ACTIVATED","This draft already has a spending card");if(existing.state==="SETTING_UP")await notifyWorker();return json({card:await evm.view(existing)});}
 await notifyWorker();return json({card:await evm.view(card)},201);
 }
 match=path.match(/^\/owner\/cards\/([^/]+)\/replacement$/);
 if(match){
  const card=await owned(match[1]);
  if(method==="GET")return json(await replacementDetails(store,evm,card));
  const value=parse(z.object({settlement:z.unknown(),acknowledgeAccountingReset:z.literal(true)}).strict(),await body(req)),settlement=normalizeSettlement(value.settlement);
  if(!settlement||!isSettlementV2(settlement))throw new ApiError(422,"EXPLICIT_SETTLEMENT_REQUIRED","Select a versioned settlement in this deployment's payment environment.");
  settlementFactory(settlement);await assertSettlementReady(settlement);
  const draft=await createReplacementDraft(store,card,settlement);
  return json({id:draft._id,state:draft.state,replacesCardId:card._id,sourceEnvironment:card.paymentEnvironment??(card.chainId===1952?"testnet":"mainnet"),accountingReset:true,warnings:replacementWarnings},201);
 }
 match=path.match(/^\/owner\/cards\/([^/]+)\/reviewer$/);
 if(match&&method==="POST"){
  const card=await owned(match[1]);if(card.state!=="FAILED")throw new ApiError(409,"REVIEWER_NOT_FAILED","Reviewer initialization can be retried only after a failed deployment");
  const claim=await store.claim<Card>("cards",{_id:card._id,state:"FAILED"},Date.now(),10000);
  if(!claim)throw new ApiError(409,"REVIEWER_RETRY_PENDING","Another reviewer retry is already in progress");
  const updated={state:"SETTING_UP",reviewerAttempt:Number(claim.reviewerAttempt??0)+1,reviewerTx:null,reviewerAddress:null,error:null,nextAt:0,updatedAt:Date.now()};
  if(!await store.complete("cards",card._id,claim.leaseToken!,updated))throw new ApiError(409,"REVIEWER_RETRY_PENDING","Retry ownership changed; refresh the agent");
  await notifyWorker();const current=await owned(card._id);return json({card:await evm.view(current)},202);
 }
 match=path.match(/^\/owner\/cards\/([^/]+)\/keys$/);
 if(match){const card=await owned(match[1]);if(method==="POST"){if(card.state==="FAILED")throw new ApiError(409,"REVIEWER_FAILED","GenLayer reviewer initialization failed. Retry it in My agents");if(card.state!=="READY"){await notifyWorker();throw new ApiError(409,"REVIEWER_PENDING","GenLayer reviewer is still being initialized. Refresh My agents; the worker was notified");}const view=await evm.view(card);if(view.status!=="ACTIVE")throw new ApiError(409,"CARD_DISABLED","Enable this card before issuing a key");const apiKey=await issueKey(store,card._id,owner);await store.patch("cards",card._id,{keyStatus:"ACTIVE"});return json({apiKey},201);}
 if(method==="DELETE"){await revokeKeys(store,card._id);await store.patch("cards",card._id,{keyStatus:"REVOKED"});for(const p of await store.find<Payment>("requests",{cardId:card._id,status:{$in:activeStatuses}}))await store.patch("requests",p._id,{cancelRequested:true});await notifyWorker();return new Response(null,{status:204});}}
 if(path==="/owner/requests"&&method==="GET"){const requests=await store.find<Payment>("requests",{owner});if(requests.some(p=>activeStatuses.includes(p.status)))await notifyWorker();return json({requests:await Promise.all(requests.sort((a,b)=>b.createdAt-a.createdAt).map(p=>requestView(store,p)))});}
 match=path.match(/^\/owner\/requests\/([^/]+)$/);
 if(match&&method==="GET"){const p=await store.get<Payment>("requests",match[1]);if(!p||p.owner!==owner)throw new ApiError(404,"NOT_FOUND","Request not found");if(activeStatuses.includes(p.status))await notifyWorker();return json(await requestView(store,p));}
 }else{
 const key=await requireAgent(store,req);Object.assign(headers,quotaHeaders(key.quota));const card=await store.get<Card>("cards",key.cardId);if(!card||card.owner!==key.owner)throw new ApiError(401,"KEY_INVALID","Agent card is unavailable");assertCardEnvironment(card);
 if(path==="/me"&&method==="GET")return json({card:await evm.view(card)});
 if(path==="/requests"&&method==="POST"){
 const idempotency=req.headers.get("idempotency-key");if(!idempotency||!/^[ -~]{1,128}$/.test(idempotency))throw new ApiError(422,"IDEMPOTENCY_REQUIRED","Provide an Idempotency-Key of 1–128 printable characters");
 const input=parse(paymentSchema,await body(req));paymentDestination(card,input);if(Buffer.byteLength(canonical(input))>14000)throw new ApiError(422,"INPUT_TOO_LARGE","Keep payment details within 14 KiB");
 // Stable card-scoped request ID makes admission atomic even across key rotations.
 const id=digest({cardId:card._id,idempotency}),inputHash=digest(input),existing=await store.get<Payment>("requests",id);
 if(existing){if(existing.inputHash!==inputHash)throw new ApiError(409,"IDEMPOTENCY_CONFLICT","This key was already used for different payment details");if(activeStatuses.includes(existing.status))await notifyWorker();return json({id,status:existing.status},202);}
 if(card.state==="FAILED")throw new ApiError(409,"REVIEWER_FAILED","Reviewer initialization failed. The owner must retry initialization in My agents");if(card.state!=="READY"){await notifyWorker();throw new ApiError(409,"REVIEWER_PENDING","GenLayer reviewer is not ready. Poll /me; the worker was notified");}if((await evm.view(card)).status!=="ACTIVE")throw new ApiError(409,"CARD_DISABLED","The owner has disabled this card");
 try{evidenceAllowed(card,input)}catch{throw new ApiError(422,"EVIDENCE_ORIGIN","Evidence must come from an owner-approved origin")}
 const now=Date.now(),p:Payment={_id:id,owner:card.owner,cardId:card._id,keyId:key._id,input,inputHash,status:"QUEUED",createdAt:now,updatedAt:now};
 if(!await store.create("requests",p)){const prior=await store.get<Payment>("requests",id);if(prior?.inputHash!==inputHash)throw new ApiError(409,"IDEMPOTENCY_CONFLICT","This key was already used for different payment details");if(activeStatuses.includes(prior.status))await notifyWorker();return json({id,status:prior.status},202);}
 await notifyWorker();return json({id,status:"QUEUED"},202);
 }
 const match=path.match(/^\/requests\/([^/]+)$/);if(match&&method==="GET"){const p=await store.get<Payment>("requests",match[1]);if(!p||p.cardId!==card._id)throw new ApiError(404,"NOT_FOUND","Request not found");if(activeStatuses.includes(p.status))await notifyWorker();return json(await requestView(store,p));}
 }
 throw new ApiError(404,"NOT_FOUND","API endpoint not found");
 }catch(e){return responseError(e,correlation)}
 })();
 return responseHeaders(response,correlation,headers);
 };
 return handler;
}
export async function requestView(store:Store,p:Payment):Promise<RequestView>{const card=await store.get<Card>("cards",p.cardId);return {id:p._id,cardId:p.cardId,cardName:card?.policy.name??"Agent",status:p.status,request:p.input,requestHash:p.requestHash??"",evidenceHash:p.evidenceHash??"",guard:p.guard,review:p.review,reviewStage:reviewStage(p),errorCode:p.errorCode as string|undefined,genLayerTxHash:p.genLayerTxHash,paymentTxHash:p.paymentTxHash,bridge:p.bridge,paymentSymbol:card?cardSymbol(card):undefined,paymentEnvironment:card?.paymentEnvironment??configuration().paymentEnvironment,reviewEnvironment:"testnet",reviewNetwork:"studionet",reviewChainId:61999,reviewerVersion:card?.reviewerVersion,error:p.error,createdAt:p.createdAt,updatedAt:p.updatedAt};}
async function routeInternal(req:Request,scheduleWake?:(task:()=>Promise<unknown>)=>void){
 const correlation=randomUUID(),pathname=new URL(req.url).pathname,path=pathname.replace(/^\/api\/v1/,""),headers:Record<string,string>={};
 try{
  const methods=endpointMethods(path);Object.assign(headers,browserCors(req,methods??[]));
  if(req.method==="OPTIONS")return responseHeaders(new Response(null,{status:204}),randomUUID(),headers);
  if(!methods)throw new ApiError(404,"NOT_FOUND","API endpoint not found");
  if(!methods.includes(req.method))throw new ApiError(405,"METHOD_NOT_ALLOWED","Use "+methods.join(" or ")+" for this endpoint",undefined,undefined,methods.join(", "));
  if(path==="/config")return responseHeaders(json(await requestConfiguration(req)),randomUUID(),headers);
  if(path==="/auth/session"&&!req.headers.get("authorization")?.startsWith("Owner "))return responseHeaders(json({address:process.env.SESSION_SECRET?await requestOwnerSession(undefined,req):null}),randomUUID(),headers);
  if(path==="/auth/logout"&&!req.headers.get("authorization")?.startsWith("Owner ")){await logoutOwnerSession(undefined,req);return responseHeaders(new Response(null,{status:204,headers:{"Set-Cookie":"ig_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"}}),randomUUID(),headers);}
  const store=await database();return await createApi(store,new Evm(store),scheduleWake?{wake:()=>scheduleWake(()=>wakeWorker(store))}:undefined)(req,path);
 }catch(e){return responseHeaders(responseError(e,correlation),correlation,headers);}
}

function quotaHeaders(quota:{limit:number;remaining:number;reset:number}){return {"RateLimit-Limit":String(quota.limit),"RateLimit-Remaining":String(quota.remaining),"RateLimit-Reset":String(quota.reset),"RateLimit-Policy":quota.limit+";w=60"}}
function endpointMethods(path:string):string[]|null{
 if(["/config","/health","/auth/session","/explorer/agents","/explorer/transactions","/me","/owner/requests","/sandbox"].includes(path)||/^\/sandbox\/requests\/0x[\da-fA-F]{64}$/.test(path)||/^\/explorer\/transactions\/0x[\da-fA-F]{64}(?:\/proof)?$/.test(path)||/^\/explorer\/agents\/0x[\da-fA-F]{64}\/card(?:\.svg)?$/.test(path)||/^\/owner\/(drafts|requests)\/[^/]+$/.test(path)||/^\/requests\/[^/]+$/.test(path))return ["GET"];
 if(["/auth/challenge","/auth/login","/auth/logout","/demo/invoices"].includes(path)||/^\/owner\/cards\/[^/]+\/reviewer$/.test(path))return ["POST"];
 if(["/owner/drafts","/requests","/sandbox/session","/sandbox/requests"].includes(path))return ["POST"];
 if(path==="/owner/cards")return ["GET","POST"];
 if(/^\/owner\/cards\/[^/]+\/keys$/.test(path))return ["POST","DELETE"];
 if(/^\/owner\/cards\/[^/]+\/replacement$/.test(path))return ["GET","POST"];
 if(/^\/demo\/invoices\/[a-f0-9]{32}$/.test(path))return ["GET"];
 return null;
}
export async function route(req:Request,scheduleWake?:(task:()=>Promise<unknown>)=>void){
 const response=await routeInternal(req,scheduleWake);
 return responseHeaders(response,response.headers.get("X-Request-Id")??randomUUID());
}
