import {createHash} from "node:crypto";
import {mkdirSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";

export const INPUT_BITS=451, OUTPUT_BITS=8, MAX_U64=(1n<<64n)-1n;
export const fields=["amount","perPaymentLimit","remainingTotal","remainingPeriod","validFrom","now","validUntil"];
export const failures=["perPayment","total","period","time","recipient","asset","enabled"];

/** The wire format is TapeOut opcode 0 followed by two big-endian u24 indices.
 * Signals 0 and 1 are constants; pin 0 is signal 2. Pin packing is little endian. */
export function generatePolicy() {
  const gates=[],cache=new Map(),depth=Array(2+INPUT_BITS).fill(0);
  const nand=(a,b,force=false)=>{
    if(!force) {
      if(a===0||b===0)return 1;
      if(a===1&&b===1)return 0;
      const key=a<=b?a+":"+b:b+":"+a;
      if(cache.has(key))return cache.get(key);
      const id=2+INPUT_BITS+gates.length;
      gates.push([a,b]);depth.push(1+Math.max(depth[a],depth[b]));cache.set(key,id);return id;
    }
    const id=2+INPUT_BITS+gates.length;
    gates.push([a,b]);depth.push(1+Math.max(depth[a],depth[b]));return id;
  };
  const not=a=>nand(a,a), and=(a,b)=>not(nand(a,b)), or=(a,b)=>nand(not(a),not(b));
  const pins=f=>Array.from({length:64},(_,i)=>2+f*64+i);
  // Unsigned exact comparator. Low bits accumulate first, then each higher bit
  // overrides their result if it differs. Equal operands preserve initial true.
  const le=(a,b)=>{
    let result=1;
    for(let i=0;i<64;i++) {
      const greater=nand(not(a[i]),b[i]);
      const notLess=nand(a[i],not(b[i]));
      result=nand(greater,nand(notLess,result));
    }
    return result;
  };
  const p=fields.map((_,i)=>pins(i));
  const passes=[le(p[0],p[1]),le(p[0],p[2]),le(p[0],p[3]),
    and(le(p[4],p[5]),not(le(p[6],p[5]))),450,451,452];
  let allow=passes[0];for(const pass of passes.slice(1))allow=and(allow,pass);
  const logical=[allow,...passes.map(not)];
  // TapeOut exports the final 8 signals. Compute all inversions first; append
  // one forced NAND per output, preserving output order exactly.
  const inversions=logical.map(not);
  const outputs=inversions.map(signal=>nand(signal,signal,true));
  const netlist=Buffer.alloc(gates.length*7);
  gates.forEach(([a,b],i)=>{netlist[i*7]=0;netlist.writeUIntBE(a,i*7+1,3);netlist.writeUIntBE(b,i*7+4,3);});
  const metadata={format:"TapeOut NAND v1",inputBits:INPUT_BITS,outputBits:OUTPUT_BITS,
    gateCount:gates.length,signalCount:2+INPUT_BITS+gates.length,depth:Math.max(...outputs.map(x=>depth[x])),
    bytes:netlist.length,sha256:"0x"+createHash("sha256").update(netlist).digest("hex"),
    inputs:[...fields.map((name,index)=>({name,offset:index*64,width:64,packing:"least-significant bit first"})),
      {name:"recipientAllowed",offset:448,width:1},{name:"assetAllowed",offset:449,width:1},{name:"enabled",offset:450,width:1}],
    outputs:[{name:"allow",offset:0},...failures.map((name,index)=>({name:"fail_"+name,offset:index+1}))],
    outputSignals:outputs,opcodes:{NAND:0},constants:{zero:0,one:1},firstInputSignal:2,
    netlistHashAlgorithm:"SHA-256",deployment:{status:"NOT_DEPLOYED",chainId:196}};
  return {netlist,metadata,gates};
}

export function packInputs(input) {
  const bytes=Buffer.alloc(57);
  fields.forEach((name,index)=>{
    if(typeof input[name] !== "bigint" || input[name]<0n || input[name]>MAX_U64)throw new RangeError(name+" must be uint64 bigint");
    bytes.writeBigUInt64LE(input[name],index*8);
  });
  for(const [index,name] of ["recipientAllowed","assetAllowed","enabled"].entries()) {
    if(typeof input[name]!=="boolean")throw new TypeError(name+" must be boolean");
    if(input[name])bytes[56]|=1<<index;
  }
  return bytes;
}

/** A netlist interpreter, with no financial comparisons in its execution path. */
export function simulate(netlist,inputs) {
  if(netlist.length%7!==0 || inputs.length!==57 || (inputs[56]&0xf8)!==0)throw new Error("invalid encoding");
  const sig=new Uint8Array(2+INPUT_BITS+netlist.length/7);sig[1]=1;
  for(let i=0;i<INPUT_BITS;i++)sig[2+i]=(inputs[i>>>3]>>>(i&7))&1;
  for(let off=0,id=2+INPUT_BITS;off<netlist.length;off+=7,id++) {
    if(netlist[off]!==0)throw new Error("NAND required");
    const a=netlist.readUIntBE(off+1,3),b=netlist.readUIntBE(off+4,3);
    if(a>=id||b>=id)throw new Error("future signal");
    sig[id]=1-(sig[a]&sig[b]);
  }
  let output=0;
  for(let i=0;i<OUTPUT_BITS;i++)output|=sig[sig.length-OUTPUT_BITS+i]<<i;
  return output;
}

export function writeArtifacts(directory=resolve(dirname(fileURLToPath(import.meta.url)),"artifacts")) {
  const {netlist,metadata,gates}=generatePolicy();mkdirSync(directory,{recursive:true});
  writeFileSync(resolve(directory,"policy.netlist.bin"),netlist);
  writeFileSync(resolve(directory,"policy.netlist.hex"),"0x"+netlist.toString("hex")+"\n");
  writeFileSync(resolve(directory,"policy.metadata.json"),JSON.stringify(metadata,null,2)+"\n");
  writeFileSync(resolve(directory,"policy.gates.json"),JSON.stringify(gates)+"\n");
  return metadata;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log(JSON.stringify(writeArtifacts(),null,2));
