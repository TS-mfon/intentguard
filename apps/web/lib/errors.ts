import {randomUUID} from "node:crypto";
export type ErrorDetails={field?:string;code?:string;message:string}[];
export class ApiError extends Error {
 constructor(public status:number,public code:string,message:string,public details?:ErrorDetails,public retryAfter?:number,public allow?:string){super(message)}
}
export function responseHeaders(response:Response,requestId:string,extra:Record<string,string>={}){
 response.headers.set("X-Request-Id",requestId);if(!response.headers.has("Cache-Control"))response.headers.set("Cache-Control","no-store");
 response.headers.set("X-Content-Type-Options","nosniff");
 for(const [key,value]of Object.entries(extra))response.headers.set(key,value);
 return response;
}
export function responseError(error:unknown,requestId=randomUUID()){
 const known=error instanceof ApiError,errorStatus=known?error.status:503,code=known?error.code:"UNAVAILABLE";
 const retryable=errorStatus===429||errorStatus===503||["REVIEWER_PENDING","REVIEWER_RETRY_PENDING","POLICY_NOT_FINAL"].includes(code);
 const headers:Record<string,string>={};
 if(retryable)headers["Retry-After"]=String(known&&error.retryAfter!==undefined?error.retryAfter:errorStatus===429?60:5);
 if(known&&error.allow)headers.Allow=error.allow;
 return responseHeaders(Response.json({error:{code,message:known?error.message:"Service unavailable. Retry later.",retryable,requestId,...(known&&error.details?{details:error.details}:{})}},{status:errorStatus,headers}),requestId);
}
