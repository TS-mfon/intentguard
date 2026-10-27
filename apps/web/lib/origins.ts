import {ApiError} from "./errors";
import {configuration} from "./config";
export type OwnerContext={origin:string;transport:"cookie"|"owner-bearer"};
function context(req:Request,canonicalOrigin:string):OwnerContext{
 const cfg=configuration(),target=new URL(req.url).origin,supplied=req.headers.get("origin");
 if(!supplied||supplied==="null")throw new ApiError(403,"ORIGIN_DENIED","Use the approved application origin");
 if(supplied===target&&(!cfg.mainnet||target===canonicalOrigin)){
  if(req.headers.get("sec-fetch-site")==="cross-site")throw new ApiError(403,"ORIGIN_DENIED","Action must originate from this application");
  return {origin:target,transport:"cookie"};
 }
 if(target===canonicalOrigin&&supplied===cfg.frontendOrigin&&cfg.frontendOrigin!==canonicalOrigin)return {origin:supplied,transport:"owner-bearer"};
 throw new ApiError(403,"ORIGIN_DENIED","Use the approved application origin");
}
export function ownerContext(req:Request){return context(req,configuration().origin);}
export function assertApplicationOrigin(req:Request,canonicalOrigin:string){return context(req,new URL(canonicalOrigin).origin).origin;}
export function assertPaymentEnvironment(req:Request){
 const declared=req.headers.get("x-intentguard-environment");
 if(declared!==null&&declared!==configuration().paymentEnvironment)throw new ApiError(409,"PAYMENT_ENVIRONMENT_MISMATCH","This request belongs to a different payment deployment");
}
const allowedHeaders=new Set(["authorization","content-type","idempotency-key","x-intentguard-environment"]);
export function browserCors(req:Request,methods:string[]):Record<string,string>{
 assertPaymentEnvironment(req);
 const supplied=req.headers.get("origin");
 const headers:Record<string,string>={Vary:"Origin, Access-Control-Request-Method, Access-Control-Request-Headers"};
 if(!supplied){if(req.method==="OPTIONS")throw new ApiError(403,"ORIGIN_DENIED","A browser preflight requires its Origin");return headers;}
 const c=ownerContext(req);
 if(c.transport==="owner-bearer"&&req.method!=="OPTIONS"&&req.headers.get("x-intentguard-environment")!==configuration().paymentEnvironment)throw new ApiError(409,"PAYMENT_ENVIRONMENT_MISMATCH","The frontend must declare its payment environment");
 headers["Access-Control-Allow-Origin"]=supplied;
 headers["Access-Control-Expose-Headers"]="X-Request-Id, Retry-After, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Allow";
 if(req.method==="OPTIONS"){
  const method=req.headers.get("access-control-request-method")??"";
  const requested=(req.headers.get("access-control-request-headers")??"").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean);
  if(!methods.includes(method)||requested.some(v=>!allowedHeaders.has(v))||new Set(requested).size!==requested.length)throw new ApiError(403,"PREFLIGHT_DENIED","Unsupported browser method or header");
  if(c.transport==="owner-bearer"&&!requested.includes("x-intentguard-environment"))throw new ApiError(403,"PREFLIGHT_DENIED","The frontend must declare its payment environment");
  headers["Access-Control-Allow-Methods"]=methods.join(", ");
  headers["Access-Control-Allow-Headers"]=[...allowedHeaders].join(", ");
  headers["Access-Control-Max-Age"]="300";
 }
 // Cross-origin owner sessions use explicit memory-only tokens, never cookies.
 return headers;
}
