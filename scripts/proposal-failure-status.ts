import assert from "node:assert/strict";
import {loadEnvFile} from "node:process";
import {database} from "../apps/web/lib/store";
import {GenLayer,assertFinalized,GenLayerTerminalError} from "../apps/web/lib/genlayer";
import {canonical,digest} from "../packages/shared";
import type {Draft} from "../apps/web/lib/models";
loadEnvFile(".local/testnet-secrets.env");loadEnvFile(".local/hosting.env");
try{
 const store=await database(),gl=new GenLayer(store),id=process.argv[2];let d=await store.get<Draft>("drafts",id);assert.ok(d?.genLayerTxHash);
 const tx=await gl.client.getTransaction({hash:d.genLayerTxHash as any});assert.throws(()=>assertFinalized(tx),GenLayerTerminalError);
 const deadline=Date.now()+600000;while(d.state!=="FAILED"&&Date.now()<deadline){await new Promise(r=>setTimeout(r,5000));d=await store.get<Draft>("drafts",id);assert.ok(d);}
 assert.equal(d.state,"FAILED");assert.equal(d.inputHash,digest(d.input));assert.ok(!d.result?.policy);assert.match(d.error??"",/submit a new proposal/);
 const stable=canonical(d);await new Promise(r=>setTimeout(r,6000));assert.equal(canonical(await store.get("drafts",id)),stable,"Terminal proposal must no longer be retried");
 console.log(JSON.stringify({id,state:d.state,genLayerTxHash:d.genLayerTxHash,status:tx.statusName,execution:tx.txExecutionResultName,result:tx.resultName}));
 console.log("FAILED_PROPOSAL_HANDLED_SAFELY");process.exit(0);
}catch{console.error("FAILED_PROPOSAL_HANDLING_CHECK_FAILED");process.exit(1);}
