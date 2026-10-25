import {MongoClient,type Document} from "mongodb";
import {randomUUID} from "node:crypto";
import {parseAmount,formatAmount} from "../../../packages/shared";
export type UsageTotals={counts:Record<string,number>;fundsMoved:string};
export type Doc={_id:string;[key:string]:unknown};
export interface Store{
 usage(cardId:string):Promise<UsageTotals>;
 get<T extends Doc>(table:string,id:string):Promise<T|null>;
 find<T extends Doc>(table:string,query:Record<string,unknown>,options?:{limit?:number}):Promise<T[]>;
 create<T extends Doc>(table:string,doc:T):Promise<boolean>;
 put<T extends Doc>(table:string,doc:T):Promise<void>;
 patch(table:string,id:string,values:Record<string,unknown>):Promise<void>;
 take<T extends Doc>(table:string,id:string):Promise<T|null>;
 claim<T extends Doc>(table:string,query:Record<string,unknown>,now:number,leaseMs:number):Promise<T|null>;
 complete(table:string,id:string,leaseToken:string,values:Record<string,unknown>):Promise<boolean>;
}
export class MongoStore implements Store{
 constructor(private client:MongoClient,private database:string){}
 async usage(cardId:string):Promise<UsageTotals>{
  const rows=await this.c("requests").aggregate<{_id:string;count:number;paid:import("mongodb").Decimal128}>([
   {$match:{cardId}},{$group:{_id:"$status",count:{$sum:1},paid:{$sum:{$cond:[{$eq:["$status","PAID"]},{$toDecimal:"$input.amount"},{$toDecimal:"0"}]}}}}
  ]).toArray();
  const counts:Record<string,number>={};let paid="0";
  for(const row of rows){counts[row._id]=row.count;if(row._id==="PAID")paid=row.paid.toString()}
  return {counts,fundsMoved:normalizeDecimal(paid)};
 }
 private c(table:string){return this.client.db(this.database).collection<Document>(table)}
 async get<T extends Doc>(t:string,id:string){return await this.c(t).findOne({_id:id as never}) as unknown as T|null}
 async find<T extends Doc>(t:string,q:Record<string,unknown>,options:{limit?:number}={}){return await this.c(t).find(q).sort({createdAt:-1,_id:-1}).limit(options.limit??200).toArray() as unknown as T[]}
 async create<T extends Doc>(t:string,d:T){try{await this.c(t).insertOne(d as never);return true}catch(e){if((e as {code?:number}).code===11000)return false;throw e}}
 async put<T extends Doc>(t:string,d:T){await this.c(t).replaceOne({_id:d._id as never},d as never,{upsert:true})}
 async patch(t:string,id:string,v:Record<string,unknown>){await this.c(t).updateOne({_id:id as never},{$set:v})}
 async take<T extends Doc>(t:string,id:string){return await this.c(t).findOneAndDelete({_id:id as never}) as unknown as T|null}
 async claim<T extends Doc>(t:string,q:Record<string,unknown>,now:number,leaseMs:number){return await this.c(t).findOneAndUpdate({...q,$and:[{$or:[{leaseUntil:{$lt:now}},{leaseUntil:{$exists:false}}]},{$or:[{nextAt:{$lte:now}},{nextAt:{$exists:false}}]}]},{$set:{leaseToken:randomUUID(),leaseUntil:now+leaseMs}},{returnDocument:"after",sort:{createdAt:1}}) as unknown as T|null}
 async complete(t:string,id:string,leaseToken:string,v:Record<string,unknown>){const r=await this.c(t).updateOne({_id:id as never,leaseToken},{$set:{...v,leaseUntil:0,leaseToken:null}});return r.modifiedCount===1}
}
function matches(d:Doc,q:Record<string,unknown>):boolean{return Object.entries(q).every(([k,v])=>{
 if(k==="$or"&&Array.isArray(v))return v.some(condition=>matches(d,condition));
 if(k==="$and"&&Array.isArray(v))return v.every(condition=>matches(d,condition));
 if(v&&typeof v==="object")return Object.entries(v).every(([op,value])=>op==="$in"?Array.isArray(value)&&value.includes(d[k]):op==="$lt"?(d[k] as any)<value:op==="$lte"?(d[k] as any)<=value:false);
 return d[k]===v;
})}
export class MemoryStore implements Store{
 private data=new Map<string,Map<string,Doc>>();
 async usage(cardId:string):Promise<UsageTotals>{const counts:Record<string,number>={};let total=0n;for(const d of this.c("requests").values()){if(d.cardId!==cardId)continue;const status=String(d.status);counts[status]=(counts[status]??0)+1;if(status==="PAID")total+=parseAmount(String((d.input as {amount:string}).amount))}return {counts,fundsMoved:formatAmount(total)};}
 private c(t:string){let c=this.data.get(t);if(!c)this.data.set(t,c=new Map());return c}
 async get<T extends Doc>(t:string,id:string){const d=this.c(t).get(id);return d?structuredClone(d) as T:null}
 async find<T extends Doc>(t:string,q:Record<string,unknown>,options:{limit?:number}={}){return[...this.c(t).values()].filter(d=>matches(d,q)).sort((a,b)=>Number(b.createdAt??0)-Number(a.createdAt??0)||(a._id<b._id?1:a._id>b._id?-1:0)).slice(0,options.limit??200).map(d=>structuredClone(d) as T)}
 async create<T extends Doc>(t:string,d:T){if(this.c(t).has(d._id))return false;this.c(t).set(d._id,structuredClone(d));return true}
 async put<T extends Doc>(t:string,d:T){this.c(t).set(d._id,structuredClone(d))}
 async patch(t:string,id:string,v:Record<string,unknown>){const d=this.c(t).get(id);if(d)Object.assign(d,structuredClone(v))}
 async take<T extends Doc>(t:string,id:string){const d=await this.get<T>(t,id);this.c(t).delete(id);return d}
 async claim<T extends Doc>(t:string,q:Record<string,unknown>,now:number,leaseMs:number){const d=[...this.c(t).values()].find(d=>matches(d,q)&&Number(d.leaseUntil??0)<now&&Number(d.nextAt??0)<=now);if(!d)return null;Object.assign(d,{leaseToken:randomUUID(),leaseUntil:now+leaseMs});return structuredClone(d) as T}
 async complete(t:string,id:string,token:string,v:Record<string,unknown>){const d=this.c(t).get(id);if(!d||d.leaseToken!==token)return false;Object.assign(d,structuredClone(v),{leaseUntil:0,leaseToken:null});return true}
}
let pending:Promise<Store>|undefined;
export function database():Promise<Store>{if(!process.env.MONGODB_URI)throw Error("MONGODB_URI is required");return pending??=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000,maxPoolSize:5,minPoolSize:0,maxIdleTimeMS:30000}).connect().then(async c=>{const db=process.env.MONGODB_DB??"intentguard";await c.db(db).collection("rate").createIndex({expiresAt:1},{expireAfterSeconds:0});return new MongoStore(c,db)}).catch(e=>{pending=undefined;throw e})}

// Decimal128 may format an exact sum in scientific notation; convert without Number.
function normalizeDecimal(raw:string){const m=raw.match(/^(\d+)(?:\.(\d+))?(?:E([+-]?\d+))?$/i);if(!m)throw Error("Invalid paid amount aggregate");const digits=m[1]+(m[2]??""),point=m[1].length+Number(m[3]??0);const expanded=point<=0?"0."+"0".repeat(-point)+digits:point>=digits.length?digits+"0".repeat(point-digits.length):digits.slice(0,point)+"."+digits.slice(point);return expanded.replace(/(\.\d*?)0+$/,"$1").replace(/\.$/,"");}
