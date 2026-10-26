import {test} from "node:test";
import assert from "node:assert/strict";
import {MemoryStore} from "../apps/web/lib/store";
import {revokeKeys} from "../apps/web/lib/auth";
import {Worker,requestId} from "../apps/web/lib/worker";
import {digest} from "../packages/shared";
import {card,owner,input,invoice,FakeEvm,FakeGenLayer} from "./fixtures";
import type {Payment} from "../apps/web/lib/models";
import {settlementFixture} from "./settlement-security-fixture";
test("S02 revocation during the last finality read cancels rather than settles",async()=>{
 const store=new MemoryStore(),evm=new FakeEvm(),gl=new FakeGenLayer();
 await store.create("cards",card);await store.create("keys",{_id:"key",cardId:card._id,owner,revoked:false});
 const p:Payment={_id:requestId(),owner,cardId:card._id,keyId:"key",input,inputHash:digest(input),status:"QUEUED",createdAt:Date.now(),updatedAt:Date.now()};
 await store.create("requests",p);const worker=new Worker(store,evm,gl,async()=>invoice());
 const step=async()=>{const current=(await store.get<Payment>("requests",p._id))!;const values=await worker.payment(current);await store.patch("requests",p._id,values);return values;};
 for(let i=0;i<4;i++)await step();
 const original=gl.decision.bind(gl);gl.decision=async(c,payment)=>{await revokeKeys(store,c._id);await store.patch("requests",payment._id,{cancelRequested:true});return original(c,payment);};
 assert.equal((await step()).status,"CANCELLED");assert.equal(evm.settlements,0);assert.equal(evm.cancellations,1);
});
test("rotation, explicit cancellation and late expiry interrupt final approval",async()=>{
 for(const variant of ["rotation","cancel","expiry"]){const t=await settlementFixture(),original=t.gl.decision.bind(t.gl),clock=Date.now;
  try{t.gl.decision=async(c,p)=>{
   if(variant==="rotation")await t.store.patch("cards",card._id,{activeKeyId:"replacement-key"});
   if(variant==="cancel")await t.store.patch("requests",p._id,{cancelRequested:true});
   if(variant==="expiry")Date.now=()=>p.canonical!.expiresAt*1000+1000;
   return original(c,p);
  };assert.equal((await t.step()).status,variant==="expiry"?"EXPIRED":"CANCELLED");assert.equal(t.evm.settlements,0);assert.equal(t.evm.cancellations,1);}
  finally{Date.now=clock;}
 }
});
test("changed final commitments and lost leases never reach the signer",async()=>{
 for(const variant of ["policy","reviewer","request","input","snapshots","lease"]){const t=await settlementFixture(),original=t.gl.decision.bind(t.gl);
  if(variant==="lease"){await t.store.patch("requests",t.p._id,{leaseToken:"old",leaseUntil:Date.now()+120000});await t.store.create("locks",{_id:"worker",leaseUntil:Date.now()+120000});}
  t.gl.decision=async(c,p)=>{
   if(variant==="policy")await t.store.patch("cards",card._id,{policyHash:"0x"+"ff".repeat(32)});
   if(variant==="reviewer")await t.store.patch("cards",card._id,{reviewerAddress:owner});
   if(variant==="request")await t.store.patch("requests",p._id,{requestHash:"0x"+"ff".repeat(32)});
   if(variant==="input")await t.store.patch("requests",p._id,{input:{...input,amount:"9"}});
   if(variant==="snapshots")await t.store.patch("requests",p._id,{snapshots:[]});
   if(variant==="lease")await t.store.patch("requests",p._id,{leaseToken:"new"});
   return original(c,p);
  };await assert.rejects(t.step());assert.equal(t.evm.settlements,0,variant);
 }
});
test("valid final approval continues to settle once after the new rechecks",async()=>{const t=await settlementFixture();assert.equal((await t.step()).status,"PAID");assert.equal(t.evm.settlements,1);assert.equal((await t.step()).status,"PAID");assert.equal(t.evm.settlements,1);});
