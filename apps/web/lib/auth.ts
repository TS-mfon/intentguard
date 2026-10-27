import {randomBytes,createHmac,timingSafeEqual} from "node:crypto";
import {verifyMessage} from "viem";
import {address,digest} from "../../../packages/shared";
import {ApiError} from "./errors";
import {configuration} from "./config";
import {assertApplicationOrigin,ownerContext,type OwnerContext} from "./origins";
import type {Store,Doc} from "./store";
type KeyDoc=Doc&{cardId:string;owner:string;revoked:boolean;createdAt:number;credentialScope?:string};
function credentialScope(){const c=configuration();return digest({paymentEnvironment:c.paymentEnvironment,paymentChainId:c.chainId});}
export function secret(){const s=process.env.SESSION_SECRET;if(!s||s.length<32)throw Error("SESSION_SECRET must be at least 32 characters");return s}
export async function challenge(store:Store,owner:string,origin:string,transport:OwnerContext["transport"]="cookie"){
 address.parse(owner);const cfg=configuration(),nonce=randomBytes(24).toString("hex"),expires=Date.now()+300000;
 const message=["IntentGuard owner login",new URL(origin).host,owner.toLowerCase(),"URI: "+origin,"API: "+cfg.origin,"Payment environment: "+cfg.paymentEnvironment,"Chain ID: "+cfg.chainId,"Nonce: "+nonce,"Expires: "+new Date(expires).toISOString(),"This signature authorizes a dashboard session only."].join("\n");
 await store.put("challenges",{_id:owner.toLowerCase(),message,expires,origin,transport,apiOrigin:cfg.origin,credentialScope:credentialScope()});return{message};
}
export function session(owner:string,context:OwnerContext={origin:configuration().origin,transport:"cookie"}){
 const data=Buffer.from(JSON.stringify({owner:address.parse(owner).toLowerCase(),nonce:randomBytes(16).toString("hex"),expires:Date.now()+(context.transport==="owner-bearer"?600000:3600000),credentialScope:credentialScope(),apiOrigin:configuration().origin,...context})).toString("base64url");
 return data+"."+createHmac("sha256",secret()).update(data).digest("base64url");
}
type SessionData={owner:string;expires:number;credentialScope:string;apiOrigin:string;origin:string;transport:OwnerContext["transport"]};
function decodeSession(token:string):SessionData|null{
 if(token.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))return null;
 const[a,b]=token.split("."),sig=createHmac("sha256",secret()).update(a).digest(),received=Buffer.from(b,"base64url");
 if(received.length!==sig.length||!timingSafeEqual(received,sig))return null;
 try{const v=JSON.parse(Buffer.from(a,"base64url").toString()) as SessionData;
  if(v.credentialScope!==credentialScope()||v.apiOrigin!==configuration().origin||typeof v.owner!=="string"||!Number.isSafeInteger(v.expires)||v.expires<=Date.now()||!["cookie","owner-bearer"].includes(v.transport))return null;
  v.owner=address.parse(v.owner).toLowerCase();return v;
 }catch{return null;}
}
export function ownerSessionExpiry(token:string){return decodeSession(token)?.expires??null;}
export function ownerSession(cookie:string|null,origin?:string){
 const token=cookie?.split(";").map(s=>s.trim()).find(s=>s.startsWith("ig_session="))?.slice(11);if(!token)return null;
 const v=decodeSession(token);return v?.transport==="cookie"&&(!origin||v.origin===origin)?v.owner:null;
}
export async function login(store:Store,owner:string,signature:string,context?:OwnerContext){
 const cfg=configuration(),id=address.parse(owner).toLowerCase(),c=await store.get<Doc&{message:string;expires:number;credentialScope?:string;apiOrigin?:string;origin?:string;transport?:OwnerContext["transport"]}>("challenges",id);
 if(!c||c.expires<=Date.now()||c.credentialScope!==credentialScope()||c.apiOrigin!==cfg.origin||(context&&(c.origin!==context.origin||c.transport!==context.transport))||(!context&&c.transport!=="cookie"))throw new ApiError(401,"CHALLENGE_EXPIRED","Request a fresh wallet challenge");
 if(!await verifyMessage({address:id as `0x${string}`,message:c.message,signature:signature as `0x${string}`}).catch(()=>false))throw new ApiError(401,"INVALID_SIGNATURE","Wallet signature did not match");
 if(c.expires<=Date.now())throw new ApiError(401,"CHALLENGE_EXPIRED","Request a fresh wallet challenge");
 const taken=await store.claim("challenges",{_id:id,message:c.message,expires:c.expires,credentialScope:c.credentialScope,apiOrigin:c.apiOrigin,origin:c.origin,transport:c.transport},Date.now(),300000);
 if(!taken||taken.message!==c.message)throw new ApiError(401,"CHALLENGE_USED","This challenge was already used");
 if(c.expires<=Date.now()||taken.expires!==c.expires)throw new ApiError(401,"CHALLENGE_EXPIRED","Request a fresh wallet challenge");
 const token=session(id,context??{origin:c.origin!,transport:"cookie"});
 if(context?.transport==="owner-bearer"){
  const data=decodeSession(token)!;if(!await store.create("challenges",{_id:"owner-session:"+digest(token),owner:id,expires:data.expires,origin:data.origin,apiOrigin:data.apiOrigin,credentialScope:data.credentialScope,createdAt:Date.now()}))throw new ApiError(503,"SESSION_NOT_PERSISTED","Request a fresh wallet challenge");
  if(data.expires<=Date.now()){await store.take("challenges","owner-session:"+digest(token));throw new ApiError(401,"SESSION_EXPIRED","Request a fresh wallet challenge");}
 }
 return token;
}
export async function requestOwnerSession(store:Store|undefined,req:Request){
 const cfg=configuration(),target=new URL(req.url).origin,authorization=req.headers.get("authorization");
 if(authorization?.startsWith("Owner ")){
  const c=ownerContext(req);if(c.transport!=="owner-bearer"||req.headers.get("x-intentguard-environment")!==cfg.paymentEnvironment)return null;
  const token=authorization.slice(6),v=decodeSession(token);
  if(!v||v.transport!=="owner-bearer"||v.origin!==c.origin||v.expires>Date.now()+600000||!store)return null;
  const saved=await store.get<Doc>("challenges","owner-session:"+digest(token));
  return v.expires>Date.now()&&saved?.owner===v.owner&&saved.origin===v.origin&&saved.apiOrigin===v.apiOrigin&&saved.credentialScope===v.credentialScope&&saved.expires===v.expires?v.owner:null;
 }
 if(cfg.mainnet&&target!==cfg.origin)return null;
 const supplied=req.headers.get("origin");
 if(req.headers.get("sec-fetch-site")==="cross-site"||(supplied&&supplied!==target))return null;
 return ownerSession(req.headers.get("cookie"),target);
}
export async function logoutOwnerSession(store:Store|undefined,req:Request){
 assertApplicationOrigin(req,configuration().origin);
 const token=req.headers.get("authorization")?.startsWith("Owner ")?req.headers.get("authorization")!.slice(6):null;
 if(token&&await requestOwnerSession(store,req))await store!.take("challenges","owner-session:"+digest(token));
}
export async function requireOwner(req:Request,origin:string,store?:Store){
 if(req.method!=="GET")assertApplicationOrigin(req,origin);
 const owner=await requestOwnerSession(store,req);if(!owner)throw new ApiError(401,"LOGIN_REQUIRED","Connect and sign in with the owner wallet");return owner;
}
export async function issueKey(store:Store,cardId:string,owner:string){for(const key of await store.find<KeyDoc>("keys",{cardId,revoked:false}))await store.patch("keys",key._id,{revoked:true});const token=(configuration().mainnet?"ig_mainnet_":"ig_")+randomBytes(32).toString("base64url");await store.create("keys",{_id:digest(token),cardId,owner,revoked:false,createdAt:Date.now(),credentialScope:credentialScope()});await store.patch("cards",cardId,{activeKeyId:digest(token),keyStatus:"ACTIVE"});return token}
export async function revokeKeys(store:Store,cardId:string){await store.patch("cards",cardId,{activeKeyId:null,keyStatus:"REVOKED"});for(const key of await store.find<KeyDoc>("keys",{cardId,revoked:false}))await store.patch("keys",key._id,{revoked:true})}
export async function requireAgent(store:Store,req:Request){const value=req.headers.get("authorization");if(!value?.startsWith("Bearer ig_"))throw new ApiError(401,"KEY_REQUIRED","Supply the agent API key");const key=await store.get<KeyDoc>("keys",digest(value.slice(7)));if(!key||key.revoked||(key.credentialScope!==credentialScope()&&(key.credentialScope!==undefined||configuration().mainnet)))throw new ApiError(401,"KEY_REVOKED","Agent API key is invalid or revoked");const card=await store.get("cards",key.cardId);if(!card||card.activeKeyId!==key._id)throw new ApiError(401,"KEY_REVOKED","This credential has been rotated or revoked");const quota=await rateLimit(store,"agent:"+key._id,60);return {...key,quota}}
export async function rateLimit(store:Store,key:string,limit:number){const window=Math.floor(Date.now()/60000);const id=digest({key,window});for(let i=0;i<limit;i++){if(await store.create("rate",{_id:id+":"+i,expiresAt:new Date(Date.now()+120000)}))return {limit,remaining:limit-i-1,reset:Math.ceil(((window+1)*60000-Date.now())/1000)}}throw new ApiError(429,"RATE_LIMIT","Rate limit reached. Retry after the current 60-second window.",undefined,Math.ceil(((window+1)*60000-Date.now())/1000))}
