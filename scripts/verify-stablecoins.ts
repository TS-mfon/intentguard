import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {encodeFunctionData,decodeFunctionResult,parseAbi,padHex,keccak256,type Address,type Hex,type Abi} from "viem";
import {CCTP_TESTNETS,TESTNET_CHAIN_IDS,TESTNET_ASSETS,testnetRoute} from "../packages/shared/assets";

// Read-only probes. No keys, wallet client, eth_send*, or simulated success.
const allowedHosts=new Set(["testrpc.xlayer.tech","sepolia.base.org","sepolia-rollup.arbitrum.io","developers.circle.com","docs.usdt0.to"]);
const allowedMethods=new Set(["eth_chainId","eth_blockNumber","eth_getCode","eth_call","eth_getBalance"]);
async function request(url:string,body?:unknown):Promise<string>{
 if(!allowedHosts.has(new URL(url).hostname))throw Error("Unapproved read-only probe endpoint");
 return new Promise((resolve,reject)=>{
  const args=["--fail","--silent","--show-error","--compressed","--max-time","25","--retry","1","--retry-delay","1"];
  if(body!==undefined)args.push("--header","Content-Type: application/json","--data-binary","@-");
  args.push(url);const child=spawn("curl",args,{stdio:["pipe","pipe","pipe"]}),chunks:Buffer[]=[];let size=0;
  const timer=setTimeout(()=>child.kill("SIGTERM"),60000);
  child.stdout.on("data",chunk=>{size+=chunk.length;if(size>2*1024*1024)child.kill("SIGTERM");else chunks.push(chunk)});
  child.stderr.resume();child.once("error",error=>{clearTimeout(timer);reject(error)});
  child.once("close",code=>{clearTimeout(timer);if(code!==0)reject(Error("Read-only probe failed: "+new URL(url).hostname+" exit "+code));else resolve(Buffer.concat(chunks).toString("utf8"))});
  child.stdin.end(body===undefined?undefined:JSON.stringify(body));
 });
}
async function rpc(url:string,method:string,params:unknown[]=[]):Promise<Hex>{
 assert.ok(allowedMethods.has(method));const result=JSON.parse(await request(url,{jsonrpc:"2.0",id:1,method,params}));
 assert.ok(!result.error,"RPC returned an error for "+method);assert.equal(result.id,1);assert.match(result.result,/^0x[0-9a-f]*$/i);return result.result;
}
const abi:Abi=parseAbi([
 "function decimals() view returns (uint8)","function symbol() view returns (string)",
 "function paused() view returns (bool)","function localDomain() view returns (uint32)",
 "function localMessageTransmitter() view returns (address)","function localMinter() view returns (address)",
 "function localTokenMessenger() view returns (address)","function remoteTokenMessengers(uint32) view returns (bytes32)",
 "function getLocalToken(uint32,bytes32) view returns (address)","function burnLimitsPerMessage(address) view returns (uint256)",
 "function minFee() view returns (uint256)","function minterAllowance(address) view returns (uint256)",
 "function balanceOf(address) view returns (uint256)"
]);
async function read(url:string,address:string,functionName:string,args:unknown[],block:Hex){
 const data=encodeFunctionData({abi,functionName,args});const raw=await rpc(url,"eth_call",[{to:address,data},block]);
 return decodeFunctionResult({abi,functionName,data:raw});
}
assert.equal(testnetRoute(1952).domain,37);
assert.throws(()=>testnetRoute(196));
assert.throws(()=>testnetRoute(8453));
assert.throws(()=>testnetRoute(42161));
assert.equal(TESTNET_ASSETS.find(asset=>asset.asset==="USDT0")?.available,false);
assert.equal(TESTNET_ASSETS.find(asset=>asset.asset==="USDT0")?.token,null);
const operator="0xed9edd8586b20524cafa4f568413c504c9b03172" as Address;
const addressesDoc=await request("https://developers.circle.com/stablecoins/usdc-contract-addresses.md");
const contractsDoc=await request("https://developers.circle.com/cctp/references/contract-addresses.md");
const testnetTokens=addressesDoc.slice(addressesDoc.indexOf("## Testnet"));
const testnetContracts=contractsDoc.slice(contractsDoc.indexOf("## Testnet"));
assert.ok(testnetTokens.length>100);assert.ok(testnetContracts.length>100);
const chains=[];
for(const chainId of TESTNET_CHAIN_IDS){
 const chain=CCTP_TESTNETS[chainId],url=chain.rpcUrl;
 assert.equal(Number(BigInt(await rpc(url,"eth_chainId"))),chainId,"Refusing a mismatched chain");
 const block=await rpc(url,"eth_blockNumber");
 assert.ok(testnetTokens.toLowerCase().includes(chain.token.toLowerCase()),"Issuer testnet token address absent");
 const codeHashes:Record<string,string>={};
 for(const role of ["token","messenger","transmitter","minter"] as const){
  assert.ok(role==="token"||testnetContracts.toLowerCase().includes(chain[role].toLowerCase()),"Official testnet contract absent");
  const code=await rpc(url,"eth_getCode",[chain[role],block]);assert.ok(code.length>2,"Missing "+role+" bytecode");codeHashes[role]=keccak256(code);
 }
 const call=(address:string,name:string,args:unknown[]=[])=>read(url,address,name,args,block);
 const [decimals,symbol,tokenPaused,transmitterPaused,minterPaused,domain,localTransmitter,localMinter,localMessenger,minFee,burnLimit,minterAllowance,operatorUsdc,operatorGas]=await Promise.all([
  call(chain.token,"decimals"),call(chain.token,"symbol"),call(chain.token,"paused"),
  call(chain.transmitter,"paused"),call(chain.minter,"paused"),call(chain.transmitter,"localDomain"),
  call(chain.messenger,"localMessageTransmitter"),call(chain.messenger,"localMinter"),call(chain.minter,"localTokenMessenger"),
  call(chain.messenger,"minFee").catch(error=>{if(chainId===1952)throw error;return null}),call(chain.minter,"burnLimitsPerMessage",[chain.token]),call(chain.token,"minterAllowance",[chain.minter]),
  call(chain.token,"balanceOf",[operator]),rpc(url,"eth_getBalance",[operator,block])
 ]);
 assert.equal(Number(decimals),6);assert.equal(symbol,"USDC");assert.equal(domain,chain.domain);
 assert.equal(tokenPaused,false);assert.equal(transmitterPaused,false);assert.equal(minterPaused,false);
 assert.equal(String(localTransmitter).toLowerCase(),chain.transmitter.toLowerCase());
 assert.equal(String(localMinter).toLowerCase(),chain.minter.toLowerCase());
 assert.equal(String(localMessenger).toLowerCase(),chain.messenger.toLowerCase());
 assert.ok(BigInt(String(burnLimit))>0n,"USDC burns disabled");
 assert.ok(BigInt(String(minterAllowance))>0n,"USDC mint allowance empty");
 // The current route promises exact delivery with zero stablecoin fee. A fee change must block new burns.
 if(chainId===1952)assert.equal(BigInt(String(minFee)),0n,"Zero-fee source route is no longer available");
 const remotes=[];
 for(const remoteId of TESTNET_CHAIN_IDS.filter(id=>id!==chainId)){
  const remote=CCTP_TESTNETS[remoteId];
  const messenger=await call(chain.messenger,"remoteTokenMessengers",[remote.domain]);
  const localToken=await call(chain.minter,"getLocalToken",[remote.domain,padHex(remote.token as Hex,{size:32})]);
  assert.equal(String(messenger).toLowerCase(),padHex(remote.messenger as Hex,{size:32}).toLowerCase(),"Remote messenger mismatch");
  assert.equal(String(localToken).toLowerCase(),chain.token.toLowerCase(),"Remote token mapping mismatch");
  remotes.push({chainId:remoteId,domain:remote.domain,messenger,localToken});
 }
 const result={...chain,blockNumber:BigInt(block).toString(),decimals:Number(decimals),symbol,localDomain:domain,paused:{token:tokenPaused,transmitter:transmitterPaused,minter:minterPaused},minFee:minFee===null?null:String(minFee),burnLimitAtomic:String(burnLimit),minterAllowanceAtomic:String(minterAllowance),codeHashes,remotes,operator:{address:operator,usdcAtomic:String(operatorUsdc),gasWei:BigInt(operatorGas as Hex).toString()}};
 chains.push(result);console.log(JSON.stringify({chainId,domain:chain.domain,blockNumber:result.blockNumber,USDC:chain.token,operatorUsdcAtomic:result.operator.usdcAtomic,operatorGasWei:result.operator.gasWei}));
}
const usdt0Response=await request("https://docs.usdt0.to/api/deployments?chainId=1952");
const usdt0Deployments=JSON.parse(usdt0Response);
const suggestedUsdt0="0x779Ded0c9e1022225f8E0630b35a9b54bE713736";
const suggestedCode=await rpc(CCTP_TESTNETS[1952].rpcUrl,"eth_getCode",[suggestedUsdt0,"latest"]);
const proof={version:1,verifiedAt:new Date().toISOString(),network:"testnet",sourceChainId:1952,sourceDomain:37,protocol:"CCTP V2",minFinalityThreshold:2000,maxFeeAtomic:"0",sources:{usdc:"https://developers.circle.com/stablecoins/usdc-contract-addresses.md",cctp:"https://developers.circle.com/cctp/references/contract-addresses.md",usdt0:"https://docs.usdt0.to/api/deployments?chainId=1952"},documentHashes:{usdc:createHash("sha256").update(addressesDoc).digest("hex"),cctp:createHash("sha256").update(contractsDoc).digest("hex"),usdt0:createHash("sha256").update(usdt0Response).digest("hex")},assets:TESTNET_ASSETS,chains,usdt0:{deploymentApiResult:usdt0Deployments,suggestedAddress:suggestedUsdt0,suggestedTestnetCodeBytes:(suggestedCode.length-2)/2,verified:false}};
if(process.argv.includes("--write-proof")){await mkdir("docs/deployments",{recursive:true});await writeFile("docs/deployments/stablecoins.json",JSON.stringify(proof,null,2)+"\n")}
console.log(JSON.stringify({usdt0:proof.usdt0}));
console.log("STABLECOIN_VERIFICATION_PASSED");
