import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {generatePolicy,packInputs,simulate,MAX_U64,fields} from "./policy.mjs";
const {netlist,metadata}=generatePolicy();
const base={amount:10n,perPaymentLimit:10n,remainingTotal:100n,remainingPeriod:20n,validFrom:100n,now:100n,validUntil:200n,recipientAllowed:true,assetAllowed:true,enabled:true};
// Independent business predicate: native bigint comparisons, no circuit builder.
function expected(p) {
  const failing=[p.amount>p.perPaymentLimit,p.amount>p.remainingTotal,p.amount>p.remainingPeriod,
    !(p.validFrom<=p.now && p.now<p.validUntil),!p.recipientAllowed,!p.assetAllowed,!p.enabled];
  return failing.some(Boolean)?failing.reduce((bits,x,i)=>bits|(x?1<<(i+1):0),0):1;
}
const check=p=>assert.equal(simulate(netlist,packInputs(p)),expected(p),JSON.stringify(p,(_,v)=>typeof v==="bigint"?v.toString():v));
test("binary netlist persisted, deterministic, topology and TapeOut final output pins",()=>{
  const persisted=readFileSync(new URL("./artifacts/policy.netlist.bin",import.meta.url));
  assert.deepEqual(persisted,netlist);
  assert.equal(metadata.sha256,"0x"+createHash("sha256").update(persisted).digest("hex"));
  assert.deepEqual(metadata.outputSignals,Array.from({length:8},(_,i)=>metadata.signalCount-8+i));
  for(let off=0,id=453;off<netlist.length;off+=7,id++) {
    assert.equal(netlist[off],0);assert.ok(netlist.readUIntBE(off+1,3)<id);assert.ok(netlist.readUIntBE(off+4,3)<id);
  }
});
test("all exact financial boundaries including uint64 max and zero",()=>{
  check(base);
  const values=[0n,1n,2n,9n,10n,11n,(1n<<32n)-1n,1n<<32n,(1n<<53n)-1n,1n<<53n,(1n<<63n)-1n,1n<<63n,MAX_U64-1n,MAX_U64];
  for(const limit of values)for(const delta of [-1n,0n,1n]) {
    const amount=limit+delta;if(amount<0n||amount>MAX_U64)continue;
    for(const name of ["perPaymentLimit","remainingTotal","remainingPeriod"]) {
      check({...base,amount,perPaymentLimit:MAX_U64,remainingTotal:MAX_U64,remainingPeriod:MAX_U64,[name]:limit});
    }
  }
  // Every individual bit can change the comparison; this catches reversed packing.
  for(let bit=0n;bit<64n;bit++){const n=1n<<bit;check({...base,amount:n,perPaymentLimit:n-1n,remainingTotal:MAX_U64,remainingPeriod:MAX_U64});}
});
test("time is inclusive validFrom and exclusive validUntil; reversed windows reject",()=>{
  for(const now of [0n,99n,100n,101n,199n,200n,201n,MAX_U64])check({...base,now});
  check({...base,validFrom:MAX_U64-1n,now:MAX_U64-1n,validUntil:MAX_U64});
  check({...base,validFrom:MAX_U64,now:MAX_U64,validUntil:MAX_U64});
  check({...base,validFrom:200n,now:150n,validUntil:100n});
});
test("flags and every failure bitmap",()=>{
  for(let mask=0;mask<128;mask++) {
    const p={...base,amount:10n,perPaymentLimit:mask&1?9n:10n,remainingTotal:mask&2?9n:10n,
      remainingPeriod:mask&4?9n:10n,now:mask&8?200n:100n,
      recipientAllowed:!(mask&16),assetAllowed:!(mask&32),enabled:!(mask&64)};
    check(p);assert.equal(simulate(netlist,packInputs(p)),mask?mask<<1:1);
  }
});
test("seeded random 64-bit independent comparisons (6000 vectors)",()=>{
  let seed=0xb458381244891887n;
  const rand=()=>{seed^=seed<<13n;seed^=seed>>7n;seed^=seed<<17n;seed&=MAX_U64;return seed;};
  for(let i=0;i<6000;i++) {
    const p=Object.fromEntries(fields.map(name=>[name,rand()]));
    p.recipientAllowed=!!(rand()&1n);p.assetAllowed=!!(rand()&1n);p.enabled=!!(rand()&1n);check(p);
  }
});
test("uint64 input guards and malformed topology reject",()=>{
  for(const value of [-1n,MAX_U64+1n,Number.MAX_SAFE_INTEGER,"10"])assert.throws(()=>packInputs({...base,amount:value}));
  assert.throws(()=>packInputs({...base,enabled:1}));
  assert.throws(()=>simulate(Buffer.from([0]),packInputs(base)));
  const bad=Buffer.from(netlist);bad.writeUIntBE(0xffffff,1,3);assert.throws(()=>simulate(bad,packInputs(base)),/future signal/);
  const opcode=Buffer.from(netlist);opcode[0]=1;assert.throws(()=>simulate(opcode,packInputs(base)),/NAND/);
});
