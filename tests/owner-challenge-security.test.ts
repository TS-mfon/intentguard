import {test} from "node:test";
import assert from "node:assert/strict";
import {privateKeyToAccount} from "viem/accounts";
import {MemoryStore} from "../apps/web/lib/store";
import {challenge,login} from "../apps/web/lib/auth";
test("S01 copied testnet wallet challenge cannot authorize a mainnet session",async()=>{
 const names=["INTENTGUARD_MODE","INTENTGUARD_PAYMENT_ENV","XLAYER_CHAIN_ID","MONGODB_DB","APP_URL","SESSION_SECRET"];
 const prior=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 try{
  for(const k of names)delete process.env[k];
  Object.assign(process.env,{INTENTGUARD_MODE:"testnet",XLAYER_CHAIN_ID:"1952",APP_URL:"https://testnet.example",SESSION_SECRET:"fixture-session-secret-longer-than-32"});
  const account=privateKeyToAccount(("0x"+"12".repeat(32)) as `0x${string}`),store=new MemoryStore();
  const first=await challenge(store,account.address,"https://testnet.example");
  const signature=await account.signMessage({message:first.message});
  Object.assign(process.env,{INTENTGUARD_MODE:"mainnet",INTENTGUARD_PAYMENT_ENV:"mainnet",XLAYER_CHAIN_ID:"196",MONGODB_DB:"intentguard_mainnet",APP_URL:"https://mainnet.example"});
  await assert.rejects(login(store,account.address,signature));
  for(const k of names)delete process.env[k];
  Object.assign(process.env,{INTENTGUARD_MODE:"testnet",XLAYER_CHAIN_ID:"1952",APP_URL:"https://testnet.example",SESSION_SECRET:"fixture-session-secret-longer-than-32"});
  assert.ok(await login(store,account.address,signature),"positive control must accept the original deployment");
 }finally{for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
