import type {Db,IndexDescription} from "mongodb";
import type {configuration} from "./config";
export type DatabaseIdentity={_id:string;version:1;paymentEnvironment:string;paymentChainId:number;databaseName:string;releaseId:string;origin:string;frontendOrigin:string;gateway:string;attestor:string};
type Config=ReturnType<typeof configuration>;
export const requiredIndexes:Record<string,IndexDescription[]>={
 rate:[{key:{expiresAt:1},name:"expiry",expireAfterSeconds:0}],
 cards:[{key:{owner:1,createdAt:-1,_id:-1},name:"owner_history"},{key:{state:1,nextAt:1,leaseUntil:1,createdAt:1},name:"setup_queue"},{key:{createdAt:-1,_id:-1},name:"public_history"}],
 drafts:[{key:{owner:1,createdAt:-1,_id:-1},name:"owner_history"},{key:{state:1,nextAt:1,leaseUntil:1,createdAt:1},name:"draft_queue"}],
 requests:[{key:{cardId:1,status:1,createdAt:-1,_id:-1},name:"card_history"},{key:{owner:1,createdAt:-1,_id:-1},name:"owner_history"},{key:{status:1,nextAt:1,leaseUntil:1,createdAt:1},name:"payment_queue"},{key:{createdAt:-1,_id:-1},name:"public_history"}],
 keys:[{key:{cardId:1,revoked:1},name:"card_keys"}],
 // Never expire requests, cards, invoices, signed journals or unresolved burns.
};
export function expectedDatabaseIdentity(cfg:Config):DatabaseIdentity{
 if(!cfg.mainnet||!cfg.releaseId||!cfg.gateway||!cfg.attestor)throw Error("Explicit mainnet release identity required");
 return {_id:"environment",version:1,paymentEnvironment:"mainnet",paymentChainId:196,databaseName:"intentguard_mainnet",releaseId:cfg.releaseId,origin:cfg.origin,frontendOrigin:cfg.frontendOrigin,gateway:cfg.gateway.toLowerCase(),attestor:cfg.attestor.toLowerCase()};
}
export function validateDatabaseIdentity(actual:unknown,expected:DatabaseIdentity){
 if(!actual||typeof actual!=="object")throw Error("Mainnet database must be bootstrapped separately");
 const row=actual as Record<string,unknown>;
 for(const[key,value]of Object.entries(expected))if(row[key]!==value)throw Error("Database environment identity mismatch");
}
export function validateDatabasePrincipal(uri:string){
 const url=new URL(uri);if(!["mongodb:","mongodb+srv:"].includes(url.protocol)||!/^intentguard_mainnet_(api|worker)$/.test(decodeURIComponent(url.username)))throw Error("Mainnet requires a dedicated API or worker database principal");
 if(url.pathname&&url.pathname!=="/"&&url.pathname!=="/intentguard_mainnet")throw Error("Mainnet connection string names a different database");
}
export async function assertDatabaseIdentity(db:Db,cfg:Config,uri:string){
 if(cfg.mainnet){validateDatabasePrincipal(uri);validateDatabaseIdentity(await db.collection("metadata").findOne({_id:"environment" as never}),expectedDatabaseIdentity(cfg));}
 else {const marker=await db.collection("metadata").findOne({_id:"environment" as never});if(marker&&(marker.paymentEnvironment!==cfg.paymentEnvironment||marker.paymentChainId!==cfg.chainId))throw Error("Database belongs to a different environment");}
}
export async function verifyDatabaseIndexes(db:Db){
 for(const[table,indexes]of Object.entries(requiredIndexes)){
  const actual=await db.collection(table).listIndexes().toArray();
  for(const expected of indexes)if(!actual.some(index=>index.name===expected.name&&JSON.stringify(index.key)===JSON.stringify(expected.key)&&(expected.expireAfterSeconds===undefined||index.expireAfterSeconds===expected.expireAfterSeconds)))throw Error("Mainnet database required index missing");
 }
}
export async function bootstrapMainnetDatabase(db:Db,cfg:Config){
 const expected=expectedDatabaseIdentity(cfg);
 const existing=await db.collection("metadata").findOne({_id:"environment" as never});
 if(existing)validateDatabaseIdentity(existing,expected);
 else {
  // Bootstrap never relabels existing financial data as mainnet.
  for(const table of await db.listCollections().toArray())if(await db.collection(table.name).findOne({}))throw Error("Mainnet bootstrap requires an empty database");
  try{await db.collection("metadata").insertOne(expected as never);}
  catch(error){if((error as {code?:number}).code!==11000)throw error;validateDatabaseIdentity(await db.collection("metadata").findOne({_id:"environment" as never}),expected);}
 }
 for(const[table,indexes]of Object.entries(requiredIndexes))await db.collection(table).createIndexes(indexes);
 await verifyDatabaseIndexes(db);
}
