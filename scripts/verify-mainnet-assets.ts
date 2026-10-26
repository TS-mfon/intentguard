import {createHash} from "node:crypto";
import {spawn,execFileSync} from "node:child_process";
import {mkdir,writeFile} from "node:fs/promises";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {encodeFunctionData,decodeFunctionResult,parseAbi,padHex,keccak256,toBytes,type Hex,type Abi} from "viem";
import {profileRoutes,paymentRoute,USDT0_MAINNET,ISSUER_SOURCES,type Route,type PaymentEnvironment} from "../packages/shared/payment-profiles";
import {parseStrictJson} from "../packages/shared/strict-json";
const sourceFiles=["scripts/verify-mainnet-assets.ts","packages/shared/payment-profiles.ts","packages/shared/strict-json.ts"];
const sourceSnapshotHashes=Object.fromEntries(sourceFiles.map(path=>[path,createHash("sha256").update(readFileSync(new URL("../"+path,import.meta.url))).digest("hex")]));
type Role="token"|"messenger"|"transmitter"|"minter";
const roles:Role[]=["token","messenger","transmitter","minter"];
const EIP1967_IMPLEMENTATION="0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const EIP1967_BEACON="0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
const LEGACY_IMPLEMENTATION=keccak256(toBytes("org.zeppelinos.proxy.implementation"));
const emptyWord="0x"+"00".repeat(32);
const rpcMethods=new Set(["eth_chainId","eth_blockNumber","eth_getBlockByNumber","eth_getCode","eth_getStorageAt","eth_call"]);
const abi:Abi=parseAbi([
 "function decimals() view returns (uint8)","function symbol() view returns (string)",
 "function paused() view returns (bool)","function localDomain() view returns (uint32)",
 "function localMessageTransmitter() view returns (address)","function localMinter() view returns (address)",
 "function localTokenMessenger() view returns (address)","function remoteTokenMessengers(uint32) view returns (bytes32)",
 "function getLocalToken(uint32,bytes32) view returns (address)","function burnLimitsPerMessage(address) view returns (uint256)",
 "function minterAllowance(address) view returns (uint256)","function minFee() view returns (uint256)",
 "function getMinFeeAmount(uint256) view returns (uint256)","function implementation() view returns (address)"
]);
export class IssuerVerificationError extends Error{constructor(readonly code:string){super(code);}}
function requireValue(condition:unknown,code:string):asserts condition{if(!condition)throw new IssuerVerificationError(code);}
function addressEqual(a:string,b:string){return a.toLowerCase()===b.toLowerCase();}
function documentSection(text:string,heading:string){
 const line=heading+"\n",start=text.indexOf(line);requireValue(start>=0,"ISSUER_SECTION_MISSING");
 const level=heading.match(/^#+/)![0].length,tail=text.slice(start+line.length);
 const next=tail.search(new RegExp("^#{1,"+level+"} ","m"));return next<0?tail:tail.slice(0,next);
}
function tableRow(text:string,name:string){
 const rows=text.split("\n").filter(line=>line.startsWith("|")).map(line=>line.split("|").slice(1,-1).map(cell=>cell.trim()));
 const clean=(cell:string)=>cell.replace(/\*\*/g,"").split(String.fromCharCode(96)).join("").toLowerCase();
 const matches=rows.filter(cells=>clean(cells[0])===name.toLowerCase());requireValue(matches.length===1,"ISSUER_NETWORK_ROW_MISSING_OR_AMBIGUOUS");return matches[0];
}
const tokenNames:Record<number,string>={196:"X Layer",42161:"Arbitrum",43114:"Avalanche C-Chain"};
const cctpNames:Record<number,string>={196:"X Layer",42161:"Arbitrum"};
export type IssuerDocuments={usdc:string;cctp:string};
export function validateIssuerDocuments(environment:PaymentEnvironment,route:Route,documents:IssuerDocuments){
 requireValue(route.testnet===(environment==="testnet"),"ISSUER_PROFILE_MISMATCH");
 const tokenSection=documentSection(documents.usdc,environment==="mainnet"?"## Mainnet":"## Testnet");
 const tokenRow=tableRow(tokenSection,tokenNames[route.chainId]??route.name);
 requireValue(tokenRow[1]?.match(/0x[0-9a-fA-F]{40}/)?.[0]?.toLowerCase()===route.token,"ISSUER_TOKEN_MISMATCH");
 const contractsSection=documentSection(documents.cctp,environment==="mainnet"?"## Mainnet contract addresses":"## Testnet contract addresses");
 for(const[heading,role]of [["TokenMessengerV2","messenger"],["MessageTransmitterV2","transmitter"],["TokenMinterV2","minter"]] as const){
  const row=tableRow(documentSection(contractsSection,"### "+heading),cctpNames[route.chainId]??route.name);
  requireValue(Number(row[1])===route.domain,"ISSUER_DOMAIN_MISMATCH");
  requireValue(row[2]?.match(/0x[0-9a-fA-F]{40}/)?.[0]?.toLowerCase()===route[role],"ISSUER_CONTRACT_MISMATCH");
 }
}
export function validateUsdt0Document(text:string){
 const parsed=parseStrictJson(text) as {usdt0?:{native?:{chainId:number;contracts:{name:string;address:string}[]}[]}};
 const chains=parsed.usdt0?.native;
 requireValue(Array.isArray(chains),"USDT0_ISSUER_TOKEN_MISMATCH");
 const matches=chains.filter(entry=>entry?.chainId===196);
 requireValue(matches.length===1&&Array.isArray(matches[0].contracts),"USDT0_ISSUER_TOKEN_MISMATCH");
 const tokens=matches[0].contracts.filter(contract=>contract?.name==="Token");
 requireValue(tokens.length===1&&typeof tokens[0].address==="string"&&addressEqual(tokens[0].address,USDT0_MAINNET),"USDT0_ISSUER_TOKEN_MISMATCH");
 return matches[0];
}
export type ProxySlots={eip1967:Hex;legacy:Hex;beacon:Hex};
export type CodeProof={code:Hex;slots:ProxySlots;implementations:{address:string;code:Hex;slots:ProxySlots;via:"eip1967"|"legacy"|"beacon"}[];beacon?:{address:string;code:Hex;slots:ProxySlots;implementation:string}};
export type RouteObservation={
 chainId:number;blockNumber:string;blockHash:Hex;decimals:number;symbol:string;localDomain:number;
 paused:{token:boolean;transmitter:boolean;minter:boolean};
 localTransmitter:string;localMinter:string;localMessenger:string;
 minFee:string|null;feeForOneUsdc:string|null;burnLimitAtomic:string;minterAllowanceAtomic:string;
 code:Record<Role,CodeProof>;remotes:{chainId:number;domain:number;messenger:string;localToken:string}[];
};
function wordAddress(word:Hex){requireValue(/^0x[0-9a-fA-F]{64}$/.test(word),"PROXY_SLOT_MALFORMED");if(word.toLowerCase()===emptyWord)return null;requireValue(/^0x0{24}/.test(word),"PROXY_SLOT_ADDRESS_MALFORMED");return "0x"+word.slice(-40);}
function containsDelegatecall(code:Hex){
 const bytes=Buffer.from(code.slice(2),"hex");
 const metadataLength=bytes.length>2?bytes.readUInt16BE(bytes.length-2):0;
 const metadataStart=bytes.length-metadataLength-2;
 // Only known complete Solidity metadata maps behind INVALID are data.
 // Arbitrary map-looking tails must not hide a live DELEGATECALL opcode.
 const metadata=metadataStart>0?bytes.subarray(metadataStart,bytes.length-2).toString("hex"):"";
 const knownMetadata=/^(?:a164736f6c6343[0-9a-f]{6}|a2646970667358221220[0-9a-f]{64}64736f6c6343[0-9a-f]{6}|a265627a7a723[01]5820[0-9a-f]{64}64736f6c6343[0-9a-f]{6})$/.test(metadata);
 const end=metadataStart>0&&bytes[metadataStart-1]===0xfe&&knownMetadata?metadataStart:bytes.length;
 for(let at=0;at<end;at++){const opcode=bytes[at];if(opcode===0xf4)return true;if(opcode>=0x60&&opcode<=0x7f)at+=opcode-0x5f;}
 return false;
}
export function validateCodeProof(proof:CodeProof){
 const binary=(value:string)=>/^0x(?:[0-9a-fA-F]{2})+$/.test(value);
 requireValue(binary(proof.code),"ISSUER_CODE_MISSING");
 requireValue(new Set(proof.implementations.map(item=>item.via)).size===proof.implementations.length,"ISSUER_PROXY_IMPLEMENTATION_DUPLICATE");
 for(const item of proof.implementations){
  requireValue(/^0x[0-9a-fA-F]{40}$/.test(item.address)&&!/^0x0{40}$/.test(item.address)&&binary(item.code),"ISSUER_IMPLEMENTATION_MISSING");
  requireValue(["eip1967","legacy","beacon"].includes(item.via),"ISSUER_PROXY_IMPLEMENTATION_UNBOUND");
  requireValue(item.via==="beacon"?
   !!proof.beacon&&wordAddress(proof.slots.beacon)!==null&&addressEqual(proof.beacon.implementation,item.address):
   addressEqual(wordAddress(proof.slots[item.via])??"",item.address),"ISSUER_PROXY_IMPLEMENTATION_UNBOUND");
  requireValue(Object.keys(item.slots).sort().join(",")==="beacon,eip1967,legacy"&&Object.values(item.slots).every(word=>wordAddress(word)===null),"ISSUER_NESTED_IMPLEMENTATION_UNSUPPORTED");
  requireValue(!/^0x363d3d373d3d3d363d73[0-9a-fA-F]{40}5af43d82803e903d91602b57fd5bf3$/.test(item.code),"ISSUER_NESTED_IMPLEMENTATION_UNSUPPORTED");
 }
 for(const[name,word]of Object.entries(proof.slots)){
  const address=wordAddress(word);if(!address)continue;
  if(name==="beacon"){
   requireValue(proof.beacon&&addressEqual(proof.beacon.address,address)&&binary(proof.beacon.code),"ISSUER_BEACON_CODE_MISSING");
   requireValue(proof.implementations.some(item=>item.via==="beacon"),"ISSUER_IMPLEMENTATION_MISSING");
  }else requireValue(proof.implementations.some(item=>item.via===name&&addressEqual(item.address,address)),"ISSUER_IMPLEMENTATION_MISSING");
 }
 requireValue(Object.keys(proof.slots).sort().join(",")==="beacon,eip1967,legacy","ISSUER_PROXY_SLOT_SET_MALFORMED");
 requireValue(new Set(proof.implementations.map(item=>item.address.toLowerCase())).size<=1,"ISSUER_PROXY_SLOTS_DISAGREE");
 requireValue(!proof.beacon||wordAddress(proof.slots.beacon)!==null,"ISSUER_BEACON_UNBOUND");
 requireValue(!proof.beacon||(Object.keys(proof.beacon.slots).sort().join(",")==="beacon,eip1967,legacy"&&Object.values(proof.beacon.slots).every(word=>wordAddress(word)===null)),"ISSUER_NESTED_BEACON_UNSUPPORTED");
 requireValue(!containsDelegatecall(proof.code)||proof.implementations.length>0,"ISSUER_PROXY_IMPLEMENTATION_UNRESOLVED");
}
export function validateRouteObservation(route:Route,peers:readonly Route[],observation:RouteObservation){
 requireValue(observation.chainId===route.chainId,"RPC_CHAIN_MISMATCH");
 requireValue(/^0x[0-9a-fA-F]{64}$/.test(observation.blockHash)&&!/^0x0{64}$/.test(observation.blockHash)&&/^(?:0|[1-9][0-9]*)$/.test(observation.blockNumber),"RPC_BLOCK_IDENTITY_MISSING");
 requireValue(observation.decimals===6&&observation.symbol==="USDC","USDC_METADATA_MISMATCH");
 requireValue(observation.localDomain===route.domain,"CCTP_DOMAIN_MISMATCH");
 requireValue(Object.keys(observation.paused).sort().join(",")==="minter,token,transmitter"&&(["token","transmitter","minter"] as const).every(role=>observation.paused[role]===false),"ISSUER_PAUSED");
 requireValue(addressEqual(observation.localTransmitter,route.transmitter)&&addressEqual(observation.localMinter,route.minter)&&addressEqual(observation.localMessenger,route.messenger),"CCTP_LOCAL_RELATIONSHIP_MISMATCH");
 const uint=(value:unknown):value is string=>typeof value==="string"&&/^(?:0|[1-9][0-9]*)$/.test(value)&&BigInt(value)<2n**256n;
 requireValue(uint(observation.burnLimitAtomic)&&uint(observation.minterAllowanceAtomic)&&BigInt(observation.burnLimitAtomic)>0n&&BigInt(observation.minterAllowanceAtomic)>0n,"CCTP_BURN_OR_MINT_DISABLED");
 requireValue((observation.minFee===null||uint(observation.minFee))&&(observation.feeForOneUsdc===null||uint(observation.feeForOneUsdc)),"CCTP_FEE_MALFORMED");
 if(route.domain===37)requireValue(observation.minFee==="0"&&observation.feeForOneUsdc==="0","CCTP_FEE_NOT_ZERO");
 for(const role of roles)validateCodeProof(observation.code[role]);
 requireValue(observation.remotes.length===peers.length&&new Set(observation.remotes.map(remote=>remote.chainId)).size===peers.length,"CCTP_REMOTE_SET_MISMATCH");
 for(const peer of peers){
  const remote=observation.remotes.find(item=>item.chainId===peer.chainId);
  requireValue(remote&&remote.domain===peer.domain&&addressEqual(remote.messenger,padHex(peer.messenger as Hex,{size:32}))&&addressEqual(remote.localToken,route.token),"CCTP_REMOTE_MAPPING_MISMATCH");
 }
 return observation;
}
async function request(url:string,body?:unknown){
 const endpoint=new URL(url);requireValue(endpoint.protocol==="https:"&&!endpoint.username&&!endpoint.password&&!endpoint.hash,"PROBE_ENDPOINT_INVALID");
 return new Promise<string>((resolve,reject)=>{
  // URLs stay on stdin; private RPC keys never appear in argv or error logs.
  const curl=spawn("curl",["--silent","--show-error","--fail","--compressed","--max-time","20","--config","-"],{stdio:["pipe","pipe","pipe"]});
  const buffers:Buffer[]=[];let bytes=0,exceeded=false;
  const timer=setTimeout(()=>curl.kill("SIGTERM"),25000);
  curl.stdout.on("data",(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>1048576){exceeded=true;curl.kill("SIGTERM");}else buffers.push(chunk)});
  curl.stderr.resume();curl.once("error",()=>{clearTimeout(timer);reject(new IssuerVerificationError("PROBE_TRANSPORT_UNAVAILABLE"));});
  curl.once("close",code=>{clearTimeout(timer);if(code!==0||exceeded)reject(new IssuerVerificationError(exceeded?"PROBE_RESPONSE_TOO_LARGE":"PROBE_TRANSPORT_UNAVAILABLE"));else resolve(Buffer.concat(buffers).toString("utf8"));});
  const config="url = "+JSON.stringify(url)+"\n"+(body===undefined?"":"header = \"Content-Type: application/json\"\ndata = "+JSON.stringify(JSON.stringify(body))+"\n");
  curl.stdin.on("error",()=>{});curl.stdin.end(config);
 });
}
export type RpcReader=(method:string,params:unknown[])=>Promise<unknown>;
export function createRpcReader(url:string,transport:typeof request=request):RpcReader{return async(method,params)=>{
 requireValue(rpcMethods.has(method),"PROBE_WRITE_METHOD_DENIED");
 const envelope=parseStrictJson(await transport(url,{jsonrpc:"2.0",id:1,method,params})) as {id?:number;result?:unknown;error?:unknown};
 requireValue(envelope.id===1&&!envelope.error&&envelope.result!==undefined,"PROBE_RPC_UNAVAILABLE");return envelope.result;
};}
async function hexRead(read:RpcReader,method:string,params:unknown[]=[]){const value=await read(method,params);requireValue(typeof value==="string"&&/^0x[0-9a-fA-F]*$/.test(value),"RPC_HEX_MALFORMED");return value as Hex;}
async function call(read:RpcReader,address:string,name:string,args:unknown[],block:Hex){
 const data=encodeFunctionData({abi,functionName:name,args});
 return decodeFunctionResult({abi,functionName:name,data:await hexRead(read,"eth_call",[{to:address,data},block])});
}
async function storageSlots(read:RpcReader,address:string,block:Hex):Promise<ProxySlots>{
 const[eip1967,legacy,beacon]=await Promise.all([hexRead(read,"eth_getStorageAt",[address,EIP1967_IMPLEMENTATION,block]),hexRead(read,"eth_getStorageAt",[address,LEGACY_IMPLEMENTATION,block]),hexRead(read,"eth_getStorageAt",[address,EIP1967_BEACON,block])]);
 return {eip1967,legacy,beacon};
}
async function codeProof(read:RpcReader,address:string,block:Hex):Promise<CodeProof>{
 const[code,slots]=await Promise.all([hexRead(read,"eth_getCode",[address,block]),storageSlots(read,address,block)]);
 const proof:CodeProof={code,slots,implementations:[]};
 async function implementationProof(via:"eip1967"|"legacy"|"beacon",implementation:string){
  const[implementationCode,implementationSlots]=await Promise.all([hexRead(read,"eth_getCode",[implementation,block]),storageSlots(read,implementation,block)]);
  proof.implementations.push({via,address:implementation,code:implementationCode,slots:implementationSlots});
 }
 for(const[via,word]of [["eip1967",slots.eip1967],["legacy",slots.legacy]] as const){const implementation=wordAddress(word);if(implementation)await implementationProof(via,implementation);}
 const beaconAddress=wordAddress(slots.beacon);
 if(beaconAddress){
  const[implementation,beaconCode,beaconSlots]=await Promise.all([call(read,beaconAddress,"implementation",[],block),hexRead(read,"eth_getCode",[beaconAddress,block]),storageSlots(read,beaconAddress,block)]);
  proof.beacon={address:beaconAddress,code:beaconCode,slots:beaconSlots,implementation:String(implementation)};
  await implementationProof("beacon",String(implementation));
 }
 return proof;
}
export async function inspectRoute(route:Route,peers:readonly Route[],read:RpcReader):Promise<RouteObservation>{
 const chainId=Number(BigInt(await hexRead(read,"eth_chainId")));requireValue(chainId===route.chainId,"RPC_CHAIN_MISMATCH");
 const block=await hexRead(read,"eth_blockNumber"),blockData=await read("eth_getBlockByNumber",[block,false]) as {hash?:Hex;number?:Hex};
 requireValue(blockData.hash&&blockData.number===block,"RPC_BLOCK_IDENTITY_MISSING");
 const contractCall=(address:string,name:string,args:unknown[]=[])=>call(read,address,name,args,block);
 const[decimals,symbol,localDomain,localTransmitter,localMinter,localMessenger,minFee,fee,burnLimit,allowance,pauses,codes,remotes]=await Promise.all([
  contractCall(route.token,"decimals"),contractCall(route.token,"symbol"),contractCall(route.transmitter,"localDomain"),
  contractCall(route.messenger,"localMessageTransmitter"),contractCall(route.messenger,"localMinter"),contractCall(route.minter,"localTokenMessenger"),
  contractCall(route.messenger,"minFee").catch(error=>{if(route.domain===37)throw error;return null}),contractCall(route.messenger,"getMinFeeAmount",[1000000n]).catch(error=>{if(route.domain===37)throw error;return null}),
  contractCall(route.minter,"burnLimitsPerMessage",[route.token]),contractCall(route.token,"minterAllowance",[route.minter]),
  Promise.all((["token","transmitter","minter"] as const).map(role=>contractCall(route[role],"paused"))),Promise.all(roles.map(role=>codeProof(read,route[role],block))),
  Promise.all(peers.map(async peer=>({chainId:peer.chainId,domain:peer.domain,messenger:String(await contractCall(route.messenger,"remoteTokenMessengers",[peer.domain])),localToken:String(await contractCall(route.minter,"getLocalToken",[peer.domain,padHex(peer.token as Hex,{size:32})]))})))
 ]);
 const repeated=await read("eth_getBlockByNumber",[block,false]) as {hash?:Hex};requireValue(repeated.hash===blockData.hash,"RPC_BLOCK_REORG");
 const observation:RouteObservation={chainId,blockNumber:BigInt(block).toString(),blockHash:blockData.hash,decimals:Number(decimals),symbol:String(symbol),localDomain:Number(localDomain),localTransmitter:String(localTransmitter),localMinter:String(localMinter),localMessenger:String(localMessenger),minFee:minFee===null?null:String(minFee),feeForOneUsdc:fee===null?null:String(fee),burnLimitAtomic:String(burnLimit),minterAllowanceAtomic:String(allowance),paused:Object.fromEntries((["token","transmitter","minter"] as const).map((role,index)=>[role,pauses[index]])) as RouteObservation["paused"],code:Object.fromEntries(roles.map((role,index)=>[role,codes[index]])) as RouteObservation["code"],remotes};
 return validateRouteObservation(route,peers,observation);
}
function publicCodeProof(proof:CodeProof){return {codeHash:keccak256(proof.code),codeBytes:(proof.code.length-2)/2,slots:proof.slots,implementations:proof.implementations.map(item=>({address:item.address,via:item.via,slots:item.slots,codeHash:keccak256(item.code),codeBytes:(item.code.length-2)/2})),...(proof.beacon?{beacon:{address:proof.beacon.address,codeHash:keccak256(proof.beacon.code),slots:proof.beacon.slots,implementation:proof.beacon.implementation}}:{})};}
function publicObservation(observation:RouteObservation){return {...observation,code:Object.fromEntries(roles.map(role=>[role,publicCodeProof(observation.code[role])]))};}
async function concurrent<T,U>(values:T[],jobs:number,task:(value:T)=>Promise<U>){let at=0;const output:U[]=new Array(values.length);await Promise.all(Array.from({length:Math.min(jobs,values.length)},async()=>{while(at<values.length){const index=at++;output[index]=await task(values[index]);}}));return output;}
export async function verifyProfiles(environments:PaymentEnvironment[]){
 requireValue(environments.length>0&&new Set(environments).size===environments.length&&environments.every(value=>["mainnet","testnet"].includes(value)),"PROBE_ENVIRONMENT_INVALID");
 const documents:Record<string,{url:string;sha256:string;body:string;status:string}>={};
 for(const[name,url]of Object.entries(ISSUER_SOURCES)){
  try{const body=await request(url);documents[name]={url,sha256:createHash("sha256").update(body).digest("hex"),body,status:"FETCHED"};}
  catch{documents[name]={url,sha256:"",body:"",status:"UNAVAILABLE"};}
 }
 const routes=environments.flatMap(environment=>Object.values(profileRoutes(environment)).map(route=>({environment,route})));
 const observations=await concurrent(routes,3,async({environment,route})=>{
  try{
   requireValue(documents.usdc.status==="FETCHED"&&documents.cctp.status==="FETCHED","ISSUER_DOCUMENT_UNAVAILABLE");
   validateIssuerDocuments(environment,route,{usdc:documents.usdc.body,cctp:documents.cctp.body});
   const override=route.rpcEnvironmentKey==="XLAYER_RPC_URL"&&process.env.INTENTGUARD_PAYMENT_ENV!==environment?undefined:process.env[route.rpcEnvironmentKey];
   const endpoint=override?.trim()||route.rpcUrl,peers=Object.values(profileRoutes(environment)).filter(peer=>peer.chainId!==route.chainId);
   const observed=await inspectRoute(route,peers,createRpcReader(endpoint));
   return {paymentEnvironment:environment,chainId:route.chainId,domain:route.domain,token:route.token,status:"VERIFIED_SNAPSHOT",available:false,endpointOverridden:!!override,observation:publicObservation(observed)};
  }catch(error){return {paymentEnvironment:environment,chainId:route.chainId,domain:route.domain,token:route.token,status:"UNVERIFIED",available:false,errorCode:error instanceof IssuerVerificationError?error.code:"PROBE_UNAVAILABLE_OR_UNSUPPORTED"};}
 });
 const usdt0:Record<string,Record<string,unknown>>={mainnet:{status:"UNVERIFIED",available:false},testnet:{status:"UNVERIFIED",available:false}};
 try{
  requireValue(documents.usdt0Mainnet.status==="FETCHED","USDT0_ISSUER_DOCUMENT_UNAVAILABLE");
  const deployment=validateUsdt0Document(documents.usdt0Mainnet.body),route=paymentRoute("mainnet",196);
  const endpoint=process.env.INTENTGUARD_PAYMENT_ENV==="mainnet"?process.env.XLAYER_RPC_URL?.trim()||route.rpcUrl:route.rpcUrl,read=createRpcReader(endpoint);
  requireValue(Number(BigInt(await hexRead(read,"eth_chainId")))===196,"RPC_CHAIN_MISMATCH");
  const block=await hexRead(read,"eth_blockNumber"),blockData=await read("eth_getBlockByNumber",[block,false]) as {hash?:Hex;number?:Hex};
  requireValue(blockData.number===block&&blockData.hash&&/^0x[0-9a-fA-F]{64}$/.test(blockData.hash)&&!/^0x0{64}$/.test(blockData.hash),"RPC_BLOCK_IDENTITY_MISSING");
  const[proof,decimals,symbol]=await Promise.all([codeProof(read,USDT0_MAINNET,block),call(read,USDT0_MAINNET,"decimals",[],block),call(read,USDT0_MAINNET,"symbol",[],block)]);
  const repeated=await read("eth_getBlockByNumber",[block,false]) as {hash?:Hex};requireValue(repeated.hash===blockData.hash,"RPC_BLOCK_REORG");
  validateCodeProof(proof);requireValue(Number(decimals)===6,"USDT0_DECIMALS_MISMATCH");
  requireValue(String(symbol)==="USD₮0","USDT0_SYMBOL_MISMATCH");
  usdt0.mainnet={status:"VERIFIED_SNAPSHOT",available:false,chainId:196,token:USDT0_MAINNET,settlement:"XLAYER_ONLY",blockNumber:BigInt(block).toString(),blockHash:blockData.hash,decimals:Number(decimals),symbol:String(symbol),issuerDeployment:deployment,code:publicCodeProof(proof)};
 }catch(error){usdt0.mainnet={status:"UNVERIFIED",available:false,errorCode:error instanceof IssuerVerificationError?error.code:"PROBE_UNAVAILABLE_OR_UNSUPPORTED"};}
 if(documents.usdt0Testnet.status==="FETCHED"){
  const entries=parseStrictJson(documents.usdt0Testnet.body) as {usdt0?:{native?:unknown[]}};
  usdt0.testnet={status:!entries.usdt0?.native?.length?"NO_ISSUER_DEPLOYMENT":"REQUIRES_SEPARATE_REVIEW",available:false,chainId:1952,token:null};
 }
 return {version:1,generatedAt:new Date().toISOString(),sourceCommit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),operation:"READ_ONLY_ISSUER_VERIFICATION",sourceSnapshotHashes,sourceDirty:execFileSync("git",["status","--porcelain","--",...sourceFiles],{encoding:"utf8"}).trim().length>0,environments,enabledRoutes:0,documents:Object.fromEntries(Object.entries(documents).map(([name,{url,sha256,status}])=>[name,{url,sha256:sha256||null,status}])),routes:observations,usdt0,limitations:["Snapshot verification never enables a route or substitutes for release acceptance.",
   "sourceCommit is the repository baseline; sourceSnapshotHashes identify the executed source when sourceDirty is true.","Issuer-controlled proxy implementations can change after this probe; nested standard-slot or minimal proxies remain unsupported.",
   "Implementation bytecode is pinned; arbitrary external or delegate-call targets are outside this observation.",
   "Contract ownership, upgrade controls, USDT0 pause/role state and payment canaries remain release acceptance requirements.","Unreachable, unsupported or inconsistent RPCs remain unverified; no financial state is fabricated.","No transaction, token approval, paid provisioning or wallet signing is performed."]};
}
async function main(){
 const requested=process.argv[2]??"both";
 requireValue(["both","mainnet","testnet"].includes(requested),"PROBE_ENVIRONMENT_INVALID");
 const report=await verifyProfiles(requested==="both"?["mainnet","testnet"]:[requested as PaymentEnvironment]);
 await mkdir(".local/mainnet-issuer",{recursive:true});await writeFile(".local/mainnet-issuer/report.json",JSON.stringify(report,null,2)+"\n");
 for(const row of report.routes)console.log(JSON.stringify({environment:row.paymentEnvironment,chainId:row.chainId,status:row.status,...("errorCode" in row?{errorCode:row.errorCode}:{})}));
 const count=report.routes.filter(row=>row.status==="VERIFIED_SNAPSHOT").length;
 console.log("ISSUER_READ_ONLY_REPORT",JSON.stringify({verifiedSnapshots:count,totalCandidates:report.routes.length,enabledRoutes:0,path:".local/mainnet-issuer/report.json"}));
 if(count!==report.routes.length||(report.environments.includes("mainnet")&&report.usdt0.mainnet.status!=="VERIFIED_SNAPSHOT"))process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error("ISSUER_VERIFICATION_FAILED");process.exitCode=1;});
