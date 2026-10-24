
import {MongoClient,type Document} from "mongodb";
import {randomUUID} from "node:crypto";
export type Doc={_id:string;[key:string]:unknown};
export interface Store{
 get<T extends Doc>(table:string,id:string):Promise<T|null>;
 find<T extends Doc>(table:string,query:Record<string,unknown>):Promise<T[]>;
 create<T extends Doc>(table:string,doc:T):Promise<boolean>;
 put<T extends Doc>(table:string,doc:T):Promise<void>;
 patch(table:string,id:string,values:Record<string,unknown>):Promise<void>;
 take<T extends Doc>(table:string,id:string):Promise<T|null>;
 claim<T extends Doc>(table:string,query:Record<string,unknown>,now:number,leaseMs:number):Promise<T|null>;
 complete(table:string,id:string,leaseToken:string,values:Record<string,unknown>):Promise<boolean>;
}
export class MongoStore implements Store{
 constructor(private client:MongoClient,private database:string){}
 private c(table:string){return this.client.db(this.database).collection<Document>(table)}
 async get<T extends Doc>(t:string,id:string){return await this.c(t).findOne({_id:id as never}) as unknown as T|null}
 async find<T extends Doc>(t:string,q:Record<string,unknown>){return await this.c(t).find(q).sort({createdAt:-1}).limit(200).toArray() as unknown as T[]}
 async create<T extends Doc>(t:string,d:T){try{await this.c(t).insertOne(d as never);return true}catch(e){if((e as {code?:number}).code===11000)return false;throw e}}
 async put<T extends Doc>(t:string,d:T){await this.c(t).replaceOne({_id:d._id as never},d as never,{upsert:true})}
 async patch(t:string,id:string,v:Record<string,unknown>){await this.c(t).updateOne({_id:id as never},{$set:v})}
 async take<T extends Doc>(t:string,id:string){return await this.c(t).findOneAndDelete({_id:id as never}) as unknown as T|null}
 async claim<T extends Doc>(t:string,q:Record<string,unknown>,now:number,leaseMs:number){return await this.c(t).findOneAndUpdate({...q,$and:[{$or:[{leaseUntil:{$lt:now}},{leaseUntil:{$exists:false}}]},{$or:[{nextAt:{$lte:now}},{nextAt:{$exists:false}}]}]},{$set:{leaseToken:randomUUID(),leaseUntil:now+leaseMs}},{returnDocument:"after",sort:{createdAt:1}}) as unknown as T|null}
 async complete(t:string,id:string,leaseToken:string,v:Record<string,unknown>){const r=await this.c(t).updateOne({_id:id as never,leaseToken},{$set:{...v,leaseUntil:0,leaseToken:null}});return r.modifiedCount===1}
}
function matches(d:Doc,q:Record<string,unknown>):boolean{return Object.entries(q).every(([k,v])=>typeof v==="object"&&v!==null&&"$in"in v?(v as {$in:unknown[]}).$in.includes(d[k]):d[k]===v)}
export class MemoryStore implements Store{
 private data=new Map<string,Map<string,Doc>>();
 private c(t:string){let c=this.data.get(t);if(!c)this.data.set(t,c=new Map());return c}
 async get<T extends Doc>(t:string,id:string){const d=this.c(t).get(id);return d?structuredClone(d) as T:null}
 async find<T extends Doc>(t:string,q:Record<string,unknown>){return[...this.c(t).values()].filter(d=>matches(d,q)).sort((a,b)=>Number(b.createdAt??0)-Number(a.createdAt??0)).slice(0,200).map(d=>structuredClone(d) as T)}
 async create<T extends Doc>(t:string,d:T){if(this.c(t).has(d._id))return false;this.c(t).set(d._id,structuredClone(d));return true}
 async put<T extends Doc>(t:string,d:T){this.c(t).set(d._id,structuredClone(d))}
 async patch(t:string,id:string,v:Record<string,unknown>){const d=this.c(t).get(id);if(d)Object.assign(d,structuredClone(v))}
 async take<T extends Doc>(t:string,id:string){const d=await this.get<T>(t,id);this.c(t).delete(id);return d}
 async claim<T extends Doc>(t:string,q:Record<string,unknown>,now:number,leaseMs:number){const d=[...this.c(t).values()].find(d=>matches(d,q)&&Number(d.leaseUntil??0)<now&&Number(d.nextAt??0)<=now);if(!d)return null;Object.assign(d,{leaseToken:randomUUID(),leaseUntil:now+leaseMs});return structuredClone(d) as T}
 async complete(t:string,id:string,token:string,v:Record<string,unknown>){const d=this.c(t).get(id);if(!d||d.leaseToken!==token)return false;Object.assign(d,structuredClone(v),{leaseUntil:0,leaseToken:null});return true}
}
let pending:Promise<Store>|undefined;
export function database():Promise<Store>{if(!process.env.MONGODB_URI)throw Error("MONGODB_URI is required");return pending??=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:5000}).connect().then(async c=>{const db=process.env.MONGODB_DB??"intentguard";await c.db(db).collection("rate").createIndex({expiresAt:1},{expireAfterSeconds:0});return new MongoStore(c,db)}).catch(e=>{pending=undefined;throw e})}
