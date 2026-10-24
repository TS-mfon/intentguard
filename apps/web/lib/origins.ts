import {ApiError} from "./errors";
// Compare the browser Origin with the actual requested app URL. Vercel production
// aliases are legitimate same-origin sites even when APP_URL names another alias.
export function assertApplicationOrigin(req:Request,canonicalOrigin:string){
 const supplied=req.headers.get("origin"),target=new URL(req.url).origin;
 let configured:string;try{configured=new URL(canonicalOrigin).origin}catch{throw new ApiError(503,"NOT_CONFIGURED","Application origin is not configured")}
 if(!supplied||supplied==="null"||!([target,configured].includes(supplied))||req.headers.get("sec-fetch-site")==="cross-site")throw new ApiError(403,"ORIGIN_DENIED","Action must originate from this application");
 return target;
}
