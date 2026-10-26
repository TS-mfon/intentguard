import {test} from "node:test";
import assert from "node:assert/strict";
import {privateKeyToAccount} from "viem/accounts";
import {keccak256,type Hex} from "viem";
import {GenLayer} from "../apps/web/lib/genlayer";
import {MemoryStore} from "../apps/web/lib/store";
const key=("0x"+"12".repeat(32)) as Hex,account=privateKeyToAccount(key),target=("0x"+"34".repeat(20)) as Hex,data="0x12345678" as Hex;
const intent={chainId:61999,type:"legacy",nonce:0,to:target,data,value:0n,gas:100000n,gasPrice:1n} as const;
async function fixture(changes:Record<string,unknown>={},hashChanged=false){
 const previous=process.env.GENLAYER_OPERATOR_PRIVATE_KEY;process.env.GENLAYER_OPERATOR_PRIVATE_KEY=key;
 const store=new MemoryStore(),gl=new GenLayer(store);gl.identity=async()=>{};
 const cfg=gl.cfg,binding={reviewNetwork:"studionet",reviewChainId:61999,paymentEnvironment:cfg.paymentEnvironment,reviewGenesis:cfg.genLayerGenesis??null,reviewConsensus:cfg.genLayerConsensus??"0xb7278a61aa25c888815afc32ad3cc52ff24fe575"};
 const raw=await account.signTransaction({...intent,...changes} as never),protocolHash="0x"+"ab".repeat(32);
 await store.create("transactions",{_id:"gl:job",raw,evmHash:hashChanged?"0x"+"cd".repeat(32):keccak256(raw),binding,protocolHash});
 const action=async(client:any)=>client.account.signTransaction(intent);
 return {gl,protocolHash,action,restore:()=>{if(previous===undefined)delete process.env.GENLAYER_OPERATOR_PRIVATE_KEY;else process.env.GENLAYER_OPERATOR_PRIVATE_KEY=previous;}};
}
test("recovered GenLayer journal must match current call intent even with a cached protocol hash",async()=>{
 for(const changes of [{chainId:1952},{to:account.address},{data:"0xabcdef"},{value:1n}]){const t=await fixture(changes);try{await assert.rejects(t.gl.send("job",t.action),/intent mismatch/);}finally{t.restore();}}
});
test("correct GenLayer raw intent returns the cached protocol result without broadcast",async()=>{const t=await fixture();try{assert.equal(await t.gl.send("job",t.action),t.protocolHash);}finally{t.restore();}});
test("saved GenLayer EVM hash must equal the signed transaction hash",async()=>{const t=await fixture({},true);try{await assert.rejects(t.gl.send("job",t.action),/hash mismatch/);}finally{t.restore();}});
