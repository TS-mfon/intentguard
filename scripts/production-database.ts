import assert from "node:assert/strict";
import {randomBytes,createHash,createCipheriv,createDecipheriv} from "node:crypto";
import {spawnSync} from "node:child_process";
import {readFile,writeFile,mkdir,chmod} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {MongoClient,BSON} from "mongodb";
import {requiredIndexes} from "../apps/web/lib/database-profile";
import {mongoClientOptions} from "../apps/web/lib/store";

export const PROJECT="6add0e4935a25d87d121f2ff",CLUSTER="intentguard",DATABASE="intentguard_mainnet";
const atlas=resolve(".local/atlas-cli/mongodb-atlas-cli_1.59.3_linux_x86_64/bin/atlas");
const directory=resolve(".local/mainnet-database");
let currentPhase="initialization";function phase(name:string){currentPhase=name;console.log("Database phase: "+name);}
export const tables=["metadata","cards","drafts","requests","keys","challenges","rate","locks","demoInvoices","transactions"] as const;
type Principal="api"|"worker";
type Privilege={actions:string[];resource:{db:string;collection:string}};
export function runtimePrivileges(principal:Principal):Privilege[]{
 const writable=principal==="api"?["cards","drafts","requests","keys","challenges","rate","locks","demoInvoices"]:["cards","drafts","requests","locks","transactions"];
 const readable=principal==="api"?[]:["keys","rate","challenges","demoInvoices"];
 return [
  {actions:["FIND"],resource:{db:DATABASE,collection:"metadata"}},
  ...writable.map(collection=>({actions:["FIND","INSERT","UPDATE","REMOVE"],resource:{db:DATABASE,collection}})),
  ...readable.map(collection=>({actions:["FIND"],resource:{db:DATABASE,collection}})),
  ...Object.keys(requiredIndexes).map(collection=>({actions:["LIST_INDEXES"],resource:{db:DATABASE,collection}}))
 ];
}
export function validateRole(actual:any,principal:Principal){
 assert.equal(actual.roleName,"intentguard_mainnet_"+principal);
 const normalize=(p:Privilege[])=>p.map(item=>{assert.notEqual((item.resource as any).cluster,true,"Cluster-wide access is forbidden");return JSON.stringify({actions:[...item.actions].sort(),resource:{db:item.resource.db,collection:item.resource.collection}})}).sort();
 const returned:Privilege[]=actual.privileges??actual.actions?.flatMap((entry:any)=>entry.resources.map((resource:any)=>({actions:[entry.action],resource})));
 const grouped=(p:Privilege[])=>Object.values(p.reduce((map:Record<string,Privilege>,entry)=>{const key=JSON.stringify(entry.resource);map[key]??={resource:entry.resource,actions:[]};map[key].actions.push(...entry.actions);return map},{})).map(entry=>({...entry,actions:[...new Set(entry.actions)]}));
 assert.deepEqual(normalize(grouped(returned)),normalize(grouped(runtimePrivileges(principal))),"Atlas role does not match the reviewed collection permissions");
 assert.deepEqual(actual.inheritedRoles??[],[],"Runtime roles must not inherit broader permissions");
}
function call(args:string[],input?:unknown){
 currentPhase="atlas "+args.slice(0,3).join(" ");
 const result=spawnSync(atlas,args,{input:input===undefined?undefined:JSON.stringify(input),encoding:"utf8",timeout:30000,maxBuffer:4*1024*1024});
 // Never print subprocess requests or responses on failure: they may contain credentials.
 if(result.error||result.status!==0)throw Error("Atlas operation failed: "+args.slice(0,3).join(" "));
 return JSON.parse(result.stdout);
}
async function save(path:string,value:unknown){await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);await writeFile(path,JSON.stringify(value,null,2)+"\n",{mode:0o600,flag:"wx"});}
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function validateCluster(cluster:any){
 assert.equal(cluster.name,CLUSTER);assert.equal(cluster.groupId,PROJECT);assert.equal(cluster.stateName,"IDLE");
 assert.equal(cluster.paused,false);
 const tiers=cluster.replicationSpecs.flatMap((spec:any)=>spec.regionConfigs.map((region:any)=>region.electableSpecs?.instanceSize));
 assert.deepEqual([...new Set(tiers)],["M0"],"This operation may only reuse the existing free cluster");
 const url=new URL(cluster.connectionStrings.standardSrv);assert.equal(url.protocol,"mongodb+srv:");assert.equal(url.username,"");assert.equal(url.password,"");
 return url;
}
function connection(url:URL,user:string,password:string){const copy=new URL(url);copy.username=user;copy.password=password;copy.pathname="/"+DATABASE;copy.searchParams.set("authSource","admin");copy.searchParams.set("retryWrites","true");copy.searchParams.set("w","majority");return copy.toString();}
export function isAuthorizationDenial(error:unknown){if(!error||typeof error!=="object")return false;const e=error as {code?:number;message?:string};return e.code===13||(e.code===8000&&/not authorized|user is not allowed to do action/i.test(e.message??""));}
async function denied(operation:()=>Promise<unknown>){try{await operation();}catch(error){if(isAuthorizationDenial(error))return true;throw Error("Isolation check failed with "+(error as any)?.name+" code "+(error as any)?.code);}throw Error("Database isolation failed: operation was authorized");}
export function encryptBackup(data:Buffer,key:Buffer){
 assert.equal(key.length,32);const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv),encrypted=Buffer.concat([cipher.update(data),cipher.final()]);
 return {version:1,iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),data:encrypted.toString("base64")};
}
export function decryptBackup(backup:ReturnType<typeof encryptBackup>,key:Buffer){
 assert.equal(backup.version,1);const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(backup.iv,"base64"));decipher.setAuthTag(Buffer.from(backup.tag,"base64"));
 return Buffer.concat([decipher.update(Buffer.from(backup.data,"base64")),decipher.final()]);
}
export function databasePlan(){return {version:1,projectId:PROJECT,cluster:CLUSTER,database:DATABASE,clusterTier:"M0",clusterUpgrade:false,recurringIncrementUsd:0,
  runtimeRoles:["api","worker"].map(principal=>({roleName:"intentguard_mainnet_"+principal,privileges:runtimePrivileges(principal as Principal)})),
  temporaryBootstrapRoles:[{roleName:"readWrite",databaseName:DATABASE},{roleName:"dbAdmin",databaseName:DATABASE}],
  collections:tables,indexes:requiredIndexes,identityBinding:"pending verified release and actual operator addresses; spending stays disabled",
  restoreExercise:"AES-256-GCM encrypted BSON fixture only; real funded-state recovery still requires release acceptance"};}
export function validateProvisionQuote(approved:any){const {quoteSha256,generatedAt,...plan}=approved;assert.equal(hash(plan),quoteSha256,"Database quote changed");assert.deepEqual(plan,databasePlan(),"Current provisioning code differs from the approved quote");assert(Number.isFinite(Date.parse(generatedAt)),"Quote timestamp required");return plan;}
export function validateBootstrapExpiry(user:any,expected:string){assert.equal(Math.floor(Date.parse(user.deleteAfterDate)/1000),Math.floor(Date.parse(expected)/1000),"Bootstrap expiry differs");assert(Date.parse(user.deleteAfterDate)>Date.now(),"Bootstrap principal expired");}
export async function cleanupProbes(db:import("mongodb").Db,quoteSha256:string){
 for(const [table,suffix]of [["challenges","api"],["transactions","worker"],["_provision_probe","fixture"],["_restore_probe","fixture"]]){
  const id="provision-"+quoteSha256+"-"+suffix,collection=db.collection<{_id:string;[key:string]:any}>(table),existing=await collection.findOne({_id:id});
  if(existing){assert.equal(existing.provisioningQuote,quoteSha256,"Unknown record at reserved probe identity");assert.equal(existing.probeKind,"database-provisioning","Unknown probe kind");await collection.deleteOne({_id:id,provisioningQuote:quoteSha256,probeKind:"database-provisioning"});}
  if(table.startsWith("_")&&(await db.listCollections({name:table}).toArray()).length&&await collection.countDocuments({})===0)await collection.drop();
 }
}
async function quote(){
 const cluster=call(["clusters","describe",CLUSTER,"--projectId",PROJECT,"--output","json"]);validateCluster(cluster);
 const plan=databasePlan();
 const evidence={...plan,quoteSha256:hash(plan),generatedAt:new Date().toISOString()};
 await save(resolve(directory,"quote.json"),evidence);
 console.log(JSON.stringify(evidence,null,2));
}
async function provision(){
 const approved=JSON.parse(await readFile(resolve(directory,"quote.json"),"utf8"));
 const {quoteSha256}=approved;const plan=validateProvisionQuote(approved);
 assert.equal(process.env.INTENTGUARD_DATABASE_QUOTE_APPROVAL,quoteSha256,"Use the exact reviewed no-cost database quote digest");
 const cluster=call(["clusters","describe",CLUSTER,"--projectId",PROJECT,"--output","json"]),base=validateCluster(cluster);
 for(const principal of ["api","worker"] as const){
  const roleName="intentguard_mainnet_"+principal;
  const roles=call(["customDbRoles","list","--projectId",PROJECT,"--output","json"]);
  const existing=roles.find((role:any)=>role.roleName===roleName);
  if(existing)validateRole(existing,principal);
  else {const privileges=runtimePrivileges(principal).flatMap(entry=>entry.actions.map(action=>action+"@"+entry.resource.db+"."+entry.resource.collection)).join(",");call(["customDbRoles","create",roleName,"--projectId",PROJECT,"--privilege",privileges,"--output","json"]);}
 }
 let credentials:any;
 const credentialsPath=resolve(directory,"credentials.json");
 try{credentials=JSON.parse(await readFile(credentialsPath,"utf8"));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
  credentials={quoteSha256,apiPassword:randomBytes(32).toString("base64url"),workerPassword:randomBytes(32).toString("base64url"),bootstrapPassword:randomBytes(32).toString("base64url"),backupKey:randomBytes(32).toString("base64"),bootstrapExpires:new Date(Date.now()+24*60*60*1000).toISOString()};await save(credentialsPath,credentials);}
 assert.equal(credentials.quoteSha256,quoteSha256,"Saved credentials belong to another quote");assert(Date.parse(credentials.bootstrapExpires)>Date.now(),"Bootstrap approval expired; renew the bounded bootstrap principal explicitly before resuming");
 const users=call(["dbusers","list","--projectId",PROJECT,"--output","json"]).results;
 for(const principal of ["api","worker","bootstrap"] as const){
  const username="intentguard_mainnet_"+principal;
  const expectedRoles=principal==="bootstrap"?plan.temporaryBootstrapRoles:[{roleName:username,databaseName:"admin"}];
  const found=users.find((user:any)=>user.username===username);
  if(found){assert.deepEqual(found.roles,expectedRoles,"Existing database user has unexpected permissions");assert.deepEqual(found.scopes,[{name:CLUSTER,type:"CLUSTER"}]);if(principal==="bootstrap")validateBootstrapExpiry(found,credentials.bootstrapExpires);}
  else call(["api","databaseUsers","createDatabaseUser","--groupId",PROJECT],{databaseName:"admin",username,password:credentials[principal+"Password"],roles:expectedRoles,scopes:[{name:CLUSTER,type:"CLUSTER"}],...(principal==="bootstrap"?{deleteAfterDate:credentials.bootstrapExpires}:{})});
 }
 const adminUri=connection(base,"intentguard_mainnet_bootstrap",credentials.bootstrapPassword);
 const admin=new MongoClient(adminUri,{...mongoClientOptions,appName:"intentguard-mainnet-provision",family:4});
 try{
  phase("bootstrap connection");await admin.connect();const db=admin.db(DATABASE);await cleanupProbes(db,quoteSha256);
  for(const table of await db.listCollections().toArray())assert.equal(await db.collection(table.name).countDocuments({}),0,"Preparation must never modify an existing funded database");
  for(const table of tables){if(!(await db.listCollections({name:table}).toArray()).length)await db.createCollection(table);}
  for(const[table,indexes]of Object.entries(requiredIndexes))await db.collection(table).createIndexes(indexes);
  const clients=(["api","worker"] as const).map(principal=>({principal,client:new MongoClient(connection(base,"intentguard_mainnet_"+principal,credentials[principal+"Password"]),{...mongoClientOptions,family:4})}));
  try{for(const{principal,client}of clients){phase(principal+" permission checks");
   phase(principal+" connection");await client.connect();phase(principal+" metadata read");await client.db(DATABASE).collection("metadata").findOne({_id:"environment" as never});
   phase(principal+" index read");for(const table of Object.keys(requiredIndexes))await client.db(DATABASE).collection(table).listIndexes().toArray();
   phase(principal+" testnet denial");await denied(()=>client.db("intentguard").collection("cards").findOne({}));
   phase(principal+" metadata-write denial");await denied(()=>client.db(DATABASE).collection("metadata").insertOne({_id:"forbidden" as never}));
   phase(principal+" index-write denial");await denied(()=>client.db(DATABASE).collection("cards").createIndex({unauthorized:1}));
   const table=principal==="api"?"challenges":"transactions",id="provision-"+quoteSha256+"-"+principal;
   await client.db(DATABASE).collection(table).insertOne({_id:id as never,probe:true,probeKind:"database-provisioning",provisioningQuote:quoteSha256});
   assert.equal((await client.db(DATABASE).collection(table).findOne({_id:id as never}))?.probe,true);
   await client.db(DATABASE).collection(table).updateOne({_id:id as never},{$set:{verified:true}});
   await client.db(DATABASE).collection(table).deleteOne({_id:id as never});
  }}finally{for(const{client}of clients)await client.close();}
  phase("testnet permission checks");const testnetPath=resolve(".local/hosting.env"),env=await readFile(testnetPath,"utf8");
  const raw=env.split(/\r?\n/).find(line=>line.startsWith("MONGODB_URI="))?.slice(12);assert(raw,"Testnet credential required for independent isolation verification");
  const testnet=new MongoClient(raw!.replace(/^["']|["']$/g,""),{...mongoClientOptions,family:4});
  try{await testnet.connect();await testnet.db("intentguard").collection("cards").findOne({});await denied(()=>testnet.db(DATABASE).collection("cards").findOne({}));}finally{await testnet.close();}
  // Exercise BSON fidelity and authenticated backup restoration with isolated probes.
  phase("encrypted restore exercise");const id="provision-"+quoteSha256+"-fixture",fixture={_id:id,probeKind:"database-provisioning",provisioningQuote:quoteSha256,createdAt:new Date(approved.generatedAt),amount:BSON.Decimal128.fromString("123456789012345678.123456"),counter:BSON.Long.fromString("9007199254740993"),bytes:new BSON.Binary(createHash("sha256").update(quoteSha256).digest())};
  const source=db.collection<{_id:string;[key:string]:any}>("_provision_probe"),target=db.collection<{_id:string;[key:string]:any}>("_restore_probe");
  await source.insertOne(fixture);const original=await source.findOne({_id:id});assert(original);
  const encoded=Buffer.from(BSON.serialize(original)),key=Buffer.from(credentials.backupKey,"base64"),backup=encryptBackup(encoded,key);
  const backupPath=resolve(directory,"restore-fixture.json");try{await save(backupPath,backup);}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
  const restoredBytes=decryptBackup(JSON.parse(await readFile(backupPath,"utf8")),key);assert.deepEqual(restoredBytes,encoded);
  const restoredDocument=BSON.deserialize(restoredBytes,{promoteLongs:false});assert.equal(restoredDocument._id,id);await target.insertOne({...restoredDocument,_id:id});
  const restored=await target.findOne({_id:id},{promoteLongs:false});assert(restored);assert.deepEqual(Buffer.from(BSON.serialize(restored)),encoded);
  await source.deleteOne({_id:id});await target.deleteOne({_id:id});await source.drop();await target.drop();
  for(const table of tables)assert.equal(await db.collection(table).countDocuments({}),0);
  const runtimePath=resolve(directory,"runtime.env.json"),runtime={apiUri:connection(base,"intentguard_mainnet_api",credentials.apiPassword),workerUri:connection(base,"intentguard_mainnet_worker",credentials.workerPassword),bootstrapUri:adminUri};try{await save(runtimePath,runtime);}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;assert.equal(hash(JSON.parse(await readFile(runtimePath,"utf8"))),hash(runtime),"Runtime credential file differs");}
  const report={version:1,generatedAt:new Date().toISOString(),quoteSha256,projectId:PROJECT,cluster:CLUSTER,database:DATABASE,incrementalRecurringCostUsd:0,
   runtimePrincipals:["intentguard_mainnet_api","intentguard_mainnet_worker"],runtimeMetadataWriteDenied:true,runtimeIndexMutationDenied:true,testnetToMainnetDenied:true,mainnetToTestnetDenied:true,
   collections:tables,indexCount:Object.values(requiredIndexes).reduce((sum,indexes)=>sum+indexes.length,0),financialRecords:0,
   backup:{algorithm:"AES-256-GCM",bsonSha256:createHash("sha256").update(encoded).digest("hex"),restoredExactly:true,scope:"synthetic fixture; funded-state backup remains a release gate"},
   bootstrapExpires:credentials.bootstrapExpires,identityBound:false,spendingEnabled:false};
  await writeFile(resolve(directory,"report.json"),JSON.stringify(report,null,2)+"\n",{mode:0o600});console.log(JSON.stringify(report,null,2));console.log("MAINNET_DATABASE_PREPARED");
 }finally{try{await cleanupProbes(admin.db(DATABASE),quoteSha256);}finally{await admin.close();}}
}
async function main(){const action=process.argv[2]??"quote";if(action==="quote")await quote();else if(action==="provision")await provision();else throw Error("Use quote or provision");}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify({status:"failed",phase:currentPhase,errorName:error?.name,errorCode:error?.code??null,message:String(error?.message??"").replace(/mongodb[^\s]+/g,"[redacted connection]").slice(0,200)}));process.exitCode=1;});
