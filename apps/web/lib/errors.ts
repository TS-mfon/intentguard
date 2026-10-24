
export class ApiError extends Error { constructor(public status:number,public code:string,message:string){super(message)} }
export function responseError(error:unknown){if(error instanceof ApiError)return Response.json({error:{code:error.code,message:error.message}},{status:error.status});return Response.json({error:{code:"UNAVAILABLE",message:"Service unavailable. Retry later."}},{status:503})}
