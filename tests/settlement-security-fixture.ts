import {test} from "node:test";
import assert from "node:assert/strict";
import {MemoryStore} from "../apps/web/lib/store";
import {Worker,requestId} from "../apps/web/lib/worker";
import {digest} from "../packages/shared";
import {card,owner,input,invoice,FakeEvm,FakeGenLayer} from "./fixtures";
import type {Payment} from "../apps/web/lib/models";
export async function settlementFixture(){
 const store=new MemoryStore(),evm=new FakeEvm(),gl=new FakeGenLayer();await store.create("cards",card);await store.create("keys",{_id:"key",cardId:card._id,owner,revoked:false});
 const p:Payment={_id:requestId(),owner,cardId:card._id,keyId:"key",input,inputHash:digest(input),status:"QUEUED",createdAt:Date.now(),updatedAt:Date.now()};await store.create("requests",p);
 const worker=new Worker(store,evm,gl,async()=>invoice()),step=async()=>{const current=(await store.get<Payment>("requests",p._id))!;const values=await worker.payment(current);await store.patch("requests",p._id,values);return values;};
 for(let i=0;i<4;i++)await step();return {store,evm,gl,p,step};
}
