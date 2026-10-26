import {MongoClient} from "mongodb";
import {configuration} from "../apps/web/lib/config";
import {bootstrapMainnetDatabase,expectedDatabaseIdentity} from "../apps/web/lib/database-profile";
import {mongoClientOptions} from "../apps/web/lib/store";
// Quote/read-only inspection is the default; this never provisions an Atlas tier.
const cfg=configuration();if(!cfg.mainnet)throw Error("Explicit mainnet environment required");
const action=process.argv[2]??"inspect";
if(!["inspect","bootstrap"].includes(action))throw Error("Use inspect or bootstrap");
const uri=process.env.MAINNET_DATABASE_ADMIN_URI;if(!uri)throw Error("Dedicated database bootstrap credentials required");
const client=new MongoClient(uri,mongoClientOptions);
try{await client.connect();const db=client.db("intentguard_mainnet");
 if(action==="bootstrap"){if(process.env.INTENTGUARD_DATABASE_BOOTSTRAP_APPROVAL!==cfg.releaseId)throw Error("Bootstrap requires the reviewed release identity as approval");await bootstrapMainnetDatabase(db,cfg);console.log("MAINNET_DATABASE_BOOTSTRAPPED");}
 else {const tables=await db.listCollections().toArray();console.log(JSON.stringify({operation:"mainnet-database-inspection",database:"intentguard_mainnet",expectedIdentity:expectedDatabaseIdentity(cfg),collections:tables.map(table=>table.name),paidProvisioning:false}));}
}finally{await client.close();}
