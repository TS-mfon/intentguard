import test from "node:test";import assert from "node:assert/strict";import {randomBytes,createHash} from "node:crypto";
import {runtimePrivileges,validateRole,validateCluster,encryptBackup,decryptBackup,DATABASE,PROJECT,CLUSTER,databasePlan,validateProvisionQuote,validateBootstrapExpiry,cleanupProbes,isAuthorizationDenial} from "./production-database";
test("API and worker roles cannot alter identity indexes or another database",()=>{
 for(const principal of ["api","worker"] as const){const actions=runtimePrivileges(principal);
  for(const grant of actions){assert.equal(grant.resource.db,DATABASE);assert(!grant.actions.includes("CREATE_INDEX"));assert(!grant.actions.includes("DROP_COLLECTION"));if(grant.resource.collection==="metadata")assert.deepEqual(grant.actions,["FIND"]);}
  validateRole({roleName:"intentguard_mainnet_"+principal,privileges:actions,inheritedRoles:[]},principal);
  const wider=structuredClone(actions);wider[0].actions.push("UPDATE");assert.throws(()=>validateRole({roleName:"intentguard_mainnet_"+principal,privileges:wider,inheritedRoles:[]},principal));
  assert.throws(()=>validateRole({roleName:"intentguard_mainnet_"+principal,privileges:actions,inheritedRoles:[{role:"readWriteAnyDatabase"}]},principal));
 }
 assert(!runtimePrivileges("api").some(p=>p.resource.collection==="transactions"));assert(!runtimePrivileges("worker").some(p=>p.resource.collection==="keys"&&p.actions.includes("UPDATE")));
});
test("provisioning rejects a paid changed paused or foreign cluster",()=>{
 const good={name:CLUSTER,groupId:PROJECT,stateName:"IDLE",paused:false,replicationSpecs:[{regionConfigs:[{electableSpecs:{instanceSize:"M0"}}]}],connectionStrings:{standardSrv:"mongodb+srv://example.mongodb.net"}};
 assert.equal(validateCluster(good).hostname,"example.mongodb.net");
 for(const mutation of [{name:"other"},{groupId:"other"},{paused:true},{stateName:"UPDATING"},{replicationSpecs:[{regionConfigs:[{electableSpecs:{instanceSize:"M10"}}]}]},{connectionStrings:{standardSrv:"mongodb+srv://username:password@example.mongodb.net"}}])assert.throws(()=>validateCluster({...good,...mutation}));
});
test("encrypted backup roundtrip preserves bytes and rejects tampering or another key",()=>{
 const key=randomBytes(32),data=randomBytes(256),backup=encryptBackup(data,key);assert.deepEqual(decryptBackup(backup,key),data);
 assert.throws(()=>decryptBackup(backup,randomBytes(32)));
 const altered={...backup,data:Buffer.alloc(256).toString("base64")};assert.throws(()=>decryptBackup(altered,key));
 assert.throws(()=>encryptBackup(data,randomBytes(16)));
});

test("approved provisioning operations cannot change after quotation",()=>{
 const plan=databasePlan(),approved={...plan,generatedAt:new Date().toISOString(),quoteSha256:createHash("sha256").update(JSON.stringify(plan)).digest("hex")};assert.deepEqual(validateProvisionQuote(approved),plan);
 const changed={...plan,collections:[...plan.collections,"unexpected"]};assert.throws(()=>validateProvisionQuote({...changed,generatedAt:approved.generatedAt,quoteSha256:createHash("sha256").update(JSON.stringify(changed)).digest("hex")}));
 assert.throws(()=>validateProvisionQuote({...approved,quoteSha256:"a".repeat(64)}));
});
test("existing bootstrap users must have the exact future bounded expiry",()=>{const expected=new Date(Date.now()+3600000).toISOString();validateBootstrapExpiry({deleteAfterDate:expected},expected);for(const date of [undefined,new Date(Date.now()-1).toISOString(),new Date(Date.now()+7200000).toISOString()])assert.throws(()=>validateBootstrapExpiry({deleteAfterDate:date},expected));});
test("transport authentication or arbitrary Atlas errors never count as an authorization denial",()=>{assert(isAuthorizationDenial({code:13}));assert(isAuthorizationDenial({code:8000,message:"user is not allowed to do action [find] on [intentguard.cards]"}));for(const e of [{code:18},{code:8000,message:"timed out"},{name:"MongoNetworkError"},{},null]){if(e===null)continue;assert.equal(isAuthorizationDenial(e),false);}});
test("interrupted provisioning probes clean up idempotently while preserving unrelated records",async()=>{
 const quote="a".repeat(64),rows=new Map<string,Map<string,any>>(),dropped:string[]=[];
 const get=(table:string)=>{if(!rows.has(table))rows.set(table,new Map());return rows.get(table)!;};
 const db={collection:(table:string)=>({findOne:async(q:any)=>rows.get(table)?.get(q._id)??null,deleteOne:async(q:any)=>{const value=get(table).get(q._id);if(value&&value.provisioningQuote===q.provisioningQuote&&value.probeKind===q.probeKind)get(table).delete(q._id)},countDocuments:async()=>get(table).size,drop:async()=>{dropped.push(table);rows.delete(table)}}),listCollections:(q:any)=>({toArray:async()=>rows.has(q.name)?[{name:q.name}]:[]})};
 for(const [table,suffix]of [["challenges","api"],["transactions","worker"],["_provision_probe","fixture"],["_restore_probe","fixture"]]){const id="provision-"+quote+"-"+suffix;get(table).set(id,{_id:id,provisioningQuote:quote,probeKind:"database-provisioning"});}
 get("challenges").set("owner-history",{_id:"owner-history"});get("_restore_probe").set("unrelated",{_id:"unrelated"});
 await cleanupProbes(db as any,quote);await cleanupProbes(db as any,quote);assert.equal(get("challenges").size,1);assert.equal(get("transactions").size,0);assert.equal(get("_restore_probe").size,1);assert.deepEqual(dropped,["_provision_probe"]);
});
test("a business record at a reserved probe identity is never deleted",async()=>{let deleted=false;const db={collection:()=>({findOne:async()=>({_id:"provision",business:true}),deleteOne:async()=>{deleted=true}})};await assert.rejects(cleanupProbes(db as any,"a".repeat(64)));assert.equal(deleted,false);});
