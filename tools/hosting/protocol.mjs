import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,lstat,realpath,open} from "node:fs/promises";
import {constants} from "node:fs";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {encodeFunctionData,decodeFunctionResult,parseAbi} from "viem";

export const ROOT=resolve(import.meta.dirname,"../..");
export const PINS=JSON.parse(await readFile(new URL("./pins.json",import.meta.url),"utf8"));
export const ZERO="0x"+"0".repeat(40);
export const IMPL_SLOT="0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const BEACON_SLOT="0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
export const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
export function canonical(value){
 if(value===null||typeof value!=="object")return JSON.stringify(value);
 if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
 return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
}
export const digest=value=>hash(canonical(value));
export function address(value){assert.match(value??"",/^0x[0-9a-fA-F]{40}$/,"Invalid address");return value.toLowerCase();}
export function uint(value,label="uint"){assert.match(String(value),/^(0|[1-9][0-9]*)$/,"Invalid "+label);return BigInt(value);}
export function quantity(value){assert.match(value??"",/^0x(?:0|[1-9a-f][0-9a-f]*)$/i,"Invalid RPC quantity");return BigInt(value);}
export function slotAddress(value){assert.match(value??"",/^0x0{24}[0-9a-fA-F]{40}$/,"Malformed address slot");return address("0x"+value.slice(-40));}
export function gitCommit(root=ROOT){
 const p=spawnSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8",timeout:10000});
 assert.equal(p.status,0,"Source checkout unavailable");const commit=p.stdout.trim();assert.match(commit,/^[a-f0-9]{40}$/);return commit;
}
export async function regularBytes(path){
 path=resolve(path);assert.equal(await realpath(path),path,"Source/file symlink is forbidden");
 const before=await lstat(path);
 assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1,"Expected a regular unlinked file");
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const st=await handle.stat();assert.equal(st.ino,before.ino,"File replaced before read");assert.equal(st.dev,before.dev);
  assert.ok(st.isFile()&&st.nlink===1,"Expected a regular unlinked file");
  const bytes=await handle.readFile();const after=await handle.stat();const named=await lstat(path);
  assert.equal(named.ino,st.ino,"File replaced during read");assert.equal(named.dev,st.dev);
  assert.equal(after.size,bytes.length,"File changed during read");assert.equal(after.mtimeMs,st.mtimeMs,"File modified during read");
  assert.equal(await realpath(path),path,"Source/file symlink is forbidden");return bytes;
 }finally{await handle.close();}
}
export async function verifySources({root=ROOT,tapeKit=resolve(root,".local/TapeKit")}={}){
 assert.equal(await realpath(tapeKit),resolve(tapeKit),"TapeKit checkout must not be a symlink");
 assert.equal(gitCommit(tapeKit),PINS.tapeKit.commit,"TapeKit commit drift");
 for(const [path,expected]of Object.entries(PINS.tapeKit.files))assert.equal(hash(await regularBytes(resolve(tapeKit,path))),expected,"TapeKit source hash mismatch: "+path);
 for(const [path,expected]of Object.entries(PINS.artifacts))assert.equal(hash(await regularBytes(resolve(root,path))),expected,"Circuit/vendor hash mismatch: "+path);
 const bytes=await regularBytes(resolve(root,"circuits/artifacts/policy.netlist.bin"));
 const metadata=JSON.parse(await readFile(resolve(root,"circuits/artifacts/policy.metadata.json"),"utf8"));
 assert.equal(bytes.length,metadata.bytes);assert.equal(hash(bytes),"280890411f873d9cf1e113c5edf783c18b14d4f9485c567a7d0ec2d45292a761");
 assert.equal(metadata.sha256,"0x"+hash(bytes));assert.equal(metadata.inputBits,451);assert.equal(metadata.outputBits,8);
 assert.equal(bytes.length%7,0);assert.equal(bytes.length/7,metadata.gateCount);
 for(let off=0;off<bytes.length;off+=7){assert.equal(bytes[off],0,"Non-NAND opcode");const signal=453+off/7;assert.ok(bytes.readUIntBE(off+1,3)<signal&&bytes.readUIntBE(off+4,3)<signal,"Forward netlist reference");}
 return {tapeKitCommit:PINS.tapeKit.commit,pinsSha256:digest(PINS),artifacts:PINS.artifacts,inputBits:451,outputBits:8,gateCount:metadata.gateCount,netlistSha256:hash(bytes)};
}

export const ABI=parseAbi([
 "function circuitBeacon() view returns(address)","function implementation() view returns(address)","function owner() view returns(address)",
 "function isSealed() view returns(bool)","function monthlyFee() view returns(uint256)","function deployFee() view returns(uint256)","function FEE() view returns(uint256)",
 "function isCPU(address) view returns(bool)","function cpuCount() view returns(uint256)","function cpuAt(uint256) view returns(address)",
 "function ownerOf(uint256) view returns(address)","function accountOf(address,uint256) view returns(address)","function isOpened(address,uint256) view returns(bool)",
 "function token() view returns(uint256,address,uint256)","function isOpenedContainer(address) view returns(bool)",
 "function fileInfo(address,string) view returns(uint32 size,string contentType,bytes32 sha256Hash,uint40 updatedAt,uint256 chunkCount)",
 "function readRange(address,string,uint256,uint256) view returns(bytes)","function fallbackPath(address) view returns(string)",
 "function CHUNK_MAX() view returns(uint256)","function containerPaidUntil(address) view returns(uint40)",
 "function transistors() view returns(address)","function TAPEOUT_FEE() view returns(uint256)",
 "function mintPrice() view returns(uint256)","function protocolFee() view returns(uint256)","function balanceOf(address,uint256) view returns(uint256)",
 "function netlist(uint256) view returns(bytes)","function circuitInfo(uint256) view returns(uint32,uint32,uint32,uint32)",
 "function createCPU(string,string,string,uint256,uint256) payable returns(address,address)",
 "function tapeout(bytes,uint32,uint32) payable returns(uint256)","function mint(uint256,uint256) payable",
 "function putFile(address,string,string,bytes32,bytes)","function appendChunk(address,string,uint256,bytes)",
 "function setFallback(address,string)","function bind(string,address,uint256) payable"
]);
const METHODS=new Set(["eth_chainId","eth_getBlockByNumber","eth_getCode","eth_getStorageAt","eth_call","eth_gasPrice","eth_estimateGas"]);
export class ReadOnlyRpc{
 constructor({urls=["https://rpc.xlayer.tech","https://xlayer.drpc.org"],fetchImpl=fetch,timeoutMs=15000}={}){
  // The two default operators are OKX and dRPC. User endpoints are unsupported
  // until an operator-independent identity registry is reviewed.
  assert.deepEqual(urls,["https://rpc.xlayer.tech","https://xlayer.drpc.org"],"Use the two independently operated official X Layer endpoints");
  this.urls=urls;this.fetchImpl=fetchImpl;this.timeoutMs=timeoutMs;this.id=0;
 }
 async request(method,params){
  assert.ok(METHODS.has(method),"RPC writes and signing are forbidden");
  if(method==="eth_call"||method==="eth_estimateGas"){
   assert.equal(params[0].data?.slice(0,10)===undefined,false,"Missing call data");
   // Estimation cannot sign, send or persist a transaction.
  }
  const replies=await Promise.all(this.urls.map(url=>this.single(url,method,params)));
  assert.equal(canonical(replies[0]),canonical(replies[1]),"Independent RPC disagreement");return replies[0];
 }
 async single(url,method,params){
   assert.ok(METHODS.has(method),"RPC writes and signing are forbidden");
   assert.ok(this.urls.includes(url),"Unreviewed RPC endpoint");
   const id=++this.id;
   try{
    const response=await this.fetchImpl(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id,method,params}),signal:AbortSignal.timeout(this.timeoutMs)});
    assert.ok(response.ok,"RPC HTTP failure");const raw=await response.text();assert.ok(raw.length<=32*1024*1024,"RPC response too large");const j=JSON.parse(raw);
    assert.equal(j.jsonrpc,"2.0");assert.equal(j.id,id);assert.ok(Object.hasOwn(j,"result")!==Object.hasOwn(j,"error"),"Malformed RPC envelope");
    if(j.error){const e=Error("RPC call reverted or unavailable");e.rpcCode=j.error.code;throw e;}return j.result;
   }catch(e){const failure=Error("Read-only RPC failed at "+new URL(url).hostname+" for "+method);failure.rpcCode=e.rpcCode;throw failure;}
 }
 async pin(now=Date.now()){
  assert.equal(quantity(await this.request("eth_chainId",[])),196n,"Wrong payment chain");
  // Heads may differ; safe heights are obtained individually, then both
  // operators must agree on the full block at the lower safe height.
  const heads=await Promise.all(this.urls.map(url=>this.single(url,"eth_getBlockByNumber",["safe",false])));
  for(const h of heads){assert.ok(h&&h.hash,"Safe block unavailable");assert.ok(now/1000-Number(quantity(h.timestamp))<=300,"Safe block is stale");}
  const n=heads.map(h=>quantity(h.number)).reduce((a,b)=>a<b?a:b);
  const block=await this.request("eth_getBlockByNumber",["0x"+n.toString(16),false]);
  assert.match(block.hash??"",/^0x[0-9a-f]{64}$/i);assert.notEqual(block.hash,"0x"+"0".repeat(64),"Zero block identity");
  assert.ok(Math.abs(now/1000-Number(quantity(block.timestamp)))<=300,"Pinned block is stale");
  return {number:block.number,hash:block.hash.toLowerCase(),timestamp:Number(quantity(block.timestamp))};
 }
 async call(to,functionName,args=[],block="latest"){
  const data=encodeFunctionData({abi:ABI,functionName,args});
  return decodeFunctionResult({abi:ABI,functionName,data:await this.request("eth_call",[{to:address(to),data},block])});
 }
}

export async function observeProtocol(rpc,{processor,tokenId,owner,cpuIndex}={}){
 const block=await rpc.pin();const at=block.number;const c=PINS.contracts;const implementations={};
 for(const [name,key]of [["factory","factoryImplementation"],["registry","registryImplementation"],["binding","bindingImplementation"]]){
  implementations[name]=slotAddress(await rpc.request("eth_getStorageAt",[c[name],IMPL_SLOT,at]));
  assert.equal(implementations[name],c[key],"Unreviewed "+name+" implementation");
 }
 const codeSha256={};
 for(const [addr,expected]of Object.entries(PINS.codeSha256)){
  const code=await rpc.request("eth_getCode",[addr,at]);assert.match(code,/^0x(?:[a-f0-9]{2})+$/i,"Missing protocol code");
  codeSha256[addr]=hash(Buffer.from(code.slice(2),"hex"));assert.equal(codeSha256[addr],expected,"Protocol code hash mismatch");
 }
 const beacon=address(await rpc.call(c.factory,"circuitBeacon",[],at));
 const beaconOwner=address(await rpc.call(beacon,"owner",[],at));
 const circuitImplementation=address(await rpc.call(beacon,"implementation",[],at));
 assert.equal(beacon,c.beacon,"Factory beacon drift");assert.equal(beaconOwner,ZERO,"Circuit beacon is mutable");
 assert.equal(circuitImplementation,c.circuitImplementation,"Circuit implementation drift");
 const admins={factory:address(await rpc.call(c.factory,"owner",[],at)),registry:address(await rpc.call(c.registry,"owner",[],at)),binding:address(await rpc.call(c.binding,"owner",[],at))};
 const factorySealed=await rpc.call(c.factory,"isSealed",[],at);
 const fees={deployFeeWei:(await rpc.call(c.factory,"deployFee",[],at)).toString(),monthlyFeeWei:(await rpc.call(c.binding,"monthlyFee",[],at)).toString(),openerFeeWei:null};
 try{fees.openerFeeWei=(await rpc.call(c.opener,"FEE",[],at)).toString();}catch{ /* Report unknown; no price fallback. */ }
 const snapshot={chainId:196,block,implementations,codeSha256,beacon,beaconOwner,circuitImplementation,admins,factorySealed,fees};
 if(processor){
  processor=address(processor);owner=address(owner);tokenId=uint(tokenId,"circuit ID");cpuIndex=uint(cpuIndex,"processor number");
  assert.equal(address(await rpc.call(c.factory,"cpuAt",[cpuIndex],at)),processor,"Processor number mismatch");
  assert.equal(await rpc.call(c.factory,"isCPU",[processor],at),true,"Foreign processor");
  assert.equal(slotAddress(await rpc.request("eth_getStorageAt",[processor,BEACON_SLOT,at])),beacon,"Processor does not use frozen official beacon");
  const code=await rpc.request("eth_getCode",[processor,at]);assert.match(code,/^0x(?:[a-f0-9]{2})+$/i,"Missing processor");
  const holder=address(await rpc.call(processor,"ownerOf",[tokenId],at));assert.equal(holder,owner,"Circuit ownership mismatch");
  const container=address(await rpc.call(c.opener,"accountOf",[processor,tokenId],at));
  const opened=await rpc.call(c.opener,"isOpened",[processor,tokenId],at);
  if(opened){
   const tuple=await rpc.call(container,"token",[],at);assert.equal(tuple[0],196n);assert.equal(address(tuple[1]),processor);assert.equal(tuple[2],tokenId);
   assert.equal(await rpc.call(c.registry,"isOpenedContainer",[container],at),true,"Registry rejects container");
  }
  const netlist=await rpc.call(processor,"netlist",[tokenId],at);
  const info=await rpc.call(processor,"circuitInfo",[tokenId],at);
  assert.equal(hash(Buffer.from(netlist.slice(2),"hex")),PINS.artifacts["circuits/artifacts/policy.netlist.bin"],"Deployed circuit hash mismatch");
  assert.deepEqual(info,[451,8,0,1766],"Deployed circuit dimensions mismatch");
  snapshot.site={processor,processorCodeSha256:hash(Buffer.from(code.slice(2),"hex")),cpuIndex:cpuIndex.toString(),tokenId:tokenId.toString(),holder,container,opened,name:tokenId+".2."+cpuIndex+".tape",netlistSha256:hash(Buffer.from(netlist.slice(2),"hex"))};
 }
 const finalBlock=await rpc.request("eth_getBlockByNumber",[at,false]);assert.equal(finalBlock.hash.toLowerCase(),block.hash,"Pinned block reorged");
 return snapshot;
}
