import assert from "node:assert/strict";
import {loadEnvFile} from "node:process";
import {database} from "../apps/web/lib/store";
import {GenLayer} from "../apps/web/lib/genlayer";
import {canonical,digest} from "../packages/shared";
import type {Draft,Card} from "../apps/web/lib/models";
loadEnvFile(".local/testnet-secrets.env");loadEnvFile(".local/hosting.env");
const id=process.argv[2];assert.match(id??"",/^0x[0-9a-f]{64}$/);
try{
 const store=await database(),draft=await store.get<Draft>("drafts",id);
 assert.ok(draft,"Draft must exist");assert.equal(draft.inputHash,digest(draft.input));
 const result=await new GenLayer(store).draft(draft);
 assert.equal(result.status,"PROPOSED");assert.ok(result.policy);
 assert.equal(draft.state,"FINALIZED");assert.equal(canonical(draft.result),canonical(result));
 assert.equal(canonical(result.policy),canonical(draft.input.guidance),"Every owner guidance field must be preserved");
 const card=await store.get<Card>("cards",id);
 console.log(JSON.stringify({id,state:draft.state,status:result.status,genLayerTxHash:draft.genLayerTxHash,name:result.policy.name,policyHash:digest(result.policy),createdAt:draft.createdAt,finalizedAt:draft.updatedAt,card:card?{address:card.address,state:card.state}:null}));
 console.log("DRAFT_FINALITY_VERIFIED");process.exit(0);
}catch{console.error("DRAFT_FINALITY_CHECK_FAILED");process.exit(1);}
