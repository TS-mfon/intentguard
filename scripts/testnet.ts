import {spawn} from "node:child_process";
import {loadEnvFile} from "node:process";
import {readFile,writeFile,mkdir,rename,chmod} from "node:fs/promises";
import {createHash,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {createPublicClient,createWalletClient,defineChain,http,encodeDeployData,keccak256,parseAbi,parseTransaction,type Address,type Hex} from "viem";
import {privateKeyToAccount,generatePrivateKey} from "viem/accounts";
import {studionet} from "genlayer-js/chains";
import {GenLayer,assertFinalized,genLayerAddress,normalizedCalldata,PendingFinality} from "../apps/web/lib/genlayer";
import {MemoryStore,type Doc} from "../apps/web/lib/store";
import {canonical} from "../packages/shared";
import type {Hash as GLHash} from "genlayer-js/types";

// Deployment-only transport fallback: curl uses the host's configured proxy reliably.
// Signed payloads flow through stdin and are never arguments or diagnostic output.
const nativeFetch=globalThis.fetch;
if(process.env.INTENTGUARD_DEPLOY_CURL!=="0"){
 globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url);
  if(!["testrpc.xlayer.tech","xlayertestrpc.okx.com","studio.genlayer.com"].includes(url.hostname))return nativeFetch(input,init);
  const body=Buffer.from(await request.arrayBuffer());
  return await new Promise<Response>((resolve,reject)=>{
   const child=spawn("curl",["--silent","--show-error","--compressed","--max-time","35","--request",request.method,"--header","Content-Type: application/json","--data-binary","@-","--write-out","\\n%{http_code}",request.url],{stdio:["pipe","pipe","pipe"]});
   const chunks:Buffer[]=[];let size=0;
   const abort=()=>child.kill("SIGTERM");request.signal.addEventListener("abort",abort,{once:true});
   child.stdout.on("data",chunk=>{size+=chunk.length;if(size>2097152)child.kill("SIGTERM");else chunks.push(chunk)});
   // Consume stderr without forwarding endpoint data or signed payloads.
   child.stderr.resume();child.once("error",reject);
   child.once("close",code=>{request.signal.removeEventListener("abort",abort);if(code!==0)return reject(Error("Deployment RPC curl transport failed, exit "+code));const output=Buffer.concat(chunks).toString("utf8"),marker=output.lastIndexOf(String.fromCharCode(10)),status=Number(output.slice(marker+1));if(!Number.isInteger(status)||status<100||status>599)return reject(Error("Invalid deployment RPC HTTP response"));resolve(new Response(output.slice(0,marker),{status,headers:{"Content-Type":"application/json"}}));});
   child.stdin.end(body);
  });
 };
}
const root=new URL("../",import.meta.url);
const manifestPath=new URL(".local/testnet-deployment.json",root);
const journalPath=new URL(".local/testnet-journal.json",root);
const envPath=new URL(".local/testnet-secrets.env",root);
const action=process.argv[2]??"check";
if(!["check","deploy","verify"].includes(action))throw Error("Use check, deploy or verify");
if(action==="deploy"&&!process.argv.includes("--broadcast"))throw Error("Testnet deployment requires --broadcast");
if(action==="deploy")loadEnvFile(process.env.INTENTGUARD_BUILD_ENV??"/home/sudodave/.env.build");
const existingEnv=await readFile(envPath,"utf8").catch(()=>"");
for(const line of existingEnv.split("\n")){const match=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(match)process.env[match[1]]=match[2];}
const rpc=process.env.XLAYER_RPC_URL??"https://xlayertestrpc.okx.com";
const chain=defineChain({id:1952,name:"X Layer Testnet",nativeCurrency:{name:"Test OKB",symbol:"OKB",decimals:18},rpcUrls:{default:{http:[rpc]}},testnet:true});
const pub=createPublicClient({chain,transport:http(rpc,{timeout:25000,retryCount:2,retryDelay:1000}),pollingInterval:1500,cacheTime:0});
type Manifest={version:number;mode:"testnet";chainId:number;rpcUrl:string;genLayerChainId:number;genLayerRpc:string;token?:string;processor?:string;beacon?:string;implementation?:string;factoryAddress?:string;interpreter?:string;interpreterTx?:string;gateway?:string;attestor?:string;operator?:string;circuitId:string;netlistHash:string;circuitGates:number;transactions:Record<string,string>;processorKind:string;verifiedAt?:string;codeHashes?:Record<string,string>};
type Journal={transactions:Record<string,{raw:Hex;hash:Hex}>;genlayerTransactions:Doc[];attestorKey?:Hex};
const meta=JSON.parse(await readFile(new URL("circuits/artifacts/policy.metadata.json",root),"utf8"));
const netlist=await readFile(new URL("circuits/artifacts/policy.netlist.bin",root));
assert.equal("0x"+createHash("sha256").update(netlist).digest("hex"),meta.sha256);
assert.equal(meta.bytes,netlist.length);assert.equal(meta.gateCount*7,netlist.length);assert.equal(meta.inputBits,451);assert.equal(meta.outputBits,8);
let manifest:Manifest=JSON.parse(await readFile(manifestPath,"utf8").catch(()=>JSON.stringify({version:1,mode:"testnet",chainId:1952,rpcUrl:rpc,genLayerChainId:61999,genLayerRpc:process.env.GENLAYER_RPC_URL??"https://studio.genlayer.com/api",circuitId:"1",netlistHash:meta.sha256,circuitGates:meta.gateCount,transactions:{},processorKind:"TESTNET_ADAPTER_UNMODIFIED_TAPEOUT_NETLIST_VM"})));
let journal:Journal=JSON.parse(await readFile(journalPath,"utf8").catch(()=>'{ "transactions":{}, "genlayerTransactions":[] }'));
async function atomic(path:URL,value:string,privateFile=false){await mkdir(new URL(".local/",root),{recursive:true});const tmp=new URL(path.href+".tmp");await writeFile(tmp,value,{mode:privateFile?0o600:0o644});if(privateFile)await chmod(tmp,0o600);await rename(tmp,path);}
async function save(){await atomic(journalPath,JSON.stringify(journal,null,2),true);await atomic(manifestPath,JSON.stringify(manifest,null,2)+"\n");}
function key(){const raw=process.env.DEPLOYER_PRIVATE_KEY??process.env.PRIVATE_KEY;if(!raw||! /^(0x)?[0-9a-fA-F]{64}$/.test(raw))throw Error("Valid deployment key is required in the authorized build environment");return (raw.startsWith("0x")?raw:"0x"+raw) as Hex;}
async function identity(){assert.equal(await pub.getChainId(),1952,"Refusing non-testnet X Layer");assert.equal(manifest.chainId,1952);assert.equal(manifest.mode,"testnet");assert.equal(manifest.genLayerChainId,61999);if(manifest.netlistHash!==meta.sha256)throw Error("Manifest circuit differs from generated circuit");}
async function artifact(source:string,name=source){return JSON.parse(await readFile(new URL("contracts/evm/out/"+source+".sol/"+name+".json",root),"utf8"));}
async function deployEvm(id:string,source:string,args:unknown[]=[],name=source){
 const old=manifest[id as keyof Manifest];if(typeof old==="string"&&/^0x[0-9a-fA-F]{40}$/.test(old)){assert.ok((await pub.getCode({address:old as Address}))?.length!>2,"Saved contract has no code");return old;}
 const account=privateKeyToAccount(key()),wallet=createWalletClient({chain,transport:http(rpc,{timeout:25000,retryCount:0}),account});
 const a=await artifact(source,name),data=encodeDeployData({abi:a.abi,bytecode:a.bytecode.object,args});
 let tx:Journal["transactions"][string]|undefined=journal.transactions[id];
 if(tx&&!await pub.getTransactionReceipt({hash:tx.hash}).catch(()=>null)){
  const nonce=parseTransaction(tx.raw).nonce;
  const pendingNonce=await pub.getTransactionCount({address:account.address,blockTag:"latest"});
  if(nonce!==undefined&&nonce<pendingNonce){
   let consumedBy:string|undefined;
   for(const [operation,known] of Object.entries(journal.transactions)){
    if(operation===id||parseTransaction(known.raw).nonce!==nonce)continue;
    const receipt=await pub.getTransactionReceipt({hash:known.hash}).catch(()=>null);
    if(receipt?.status==="success"){consumedBy=operation;break;}
   }
   if(!consumedBy)throw Error("Deployment nonce was consumed outside this journal; investigate before rebuilding");
   journal.transactions[id+":superseded:"+nonce]=tx;delete journal.transactions[id];tx=undefined;await save();
   console.log(JSON.stringify({step:id,recovery:"unsent cached nonce superseded by confirmed deployment",consumedBy,nonce}));
  }
 }
 if(!tx){const [latestNonce,pendingNonce]=await Promise.all([pub.getTransactionCount({address:account.address,blockTag:"latest"}),pub.getTransactionCount({address:account.address,blockTag:"pending"})]);const prepared=await wallet.prepareTransactionRequest({data,nonce:Math.max(latestNonce,pendingNonce)});prepared.gas=prepared.gas*125n/100n+50000n;const raw=await wallet.signTransaction(prepared);tx={raw,hash:keccak256(raw)};journal.transactions[id]=tx;await save();}
 let receipt=await pub.getTransactionReceipt({hash:tx.hash}).catch(()=>null);
 if(!receipt){await wallet.sendRawTransaction({serializedTransaction:tx.raw}).catch(async e=>{if(!await pub.getTransaction({hash:tx!.hash}).catch(()=>null))throw e});receipt=await pub.waitForTransactionReceipt({hash:tx.hash,confirmations:2,timeout:180000});}
 assert.equal(receipt.status,"success","Testnet deployment transaction reverted");
 assert.ok(receipt.contractAddress,"Missing testnet deployment address");manifest[id as keyof Manifest]=receipt.contractAddress as never;manifest.transactions[id]=tx.hash;await save();console.log(JSON.stringify({step:id,address:receipt.contractAddress,transactionHash:tx.hash,chainId:1952}));return receipt.contractAddress;
}
class DeploymentStore extends MemoryStore{
 async create<T extends Doc>(table:string,doc:T){const result=await super.create(table,doc);if(result&&table==="transactions"){journal.genlayerTransactions.push(doc);await save()}return result;}
 async patch(table:string,id:string,values:Record<string,unknown>){await super.patch(table,id,values);if(table==="transactions"){const row=journal.genlayerTransactions.find(r=>r._id===id);if(row)Object.assign(row,values);await save();}}
}
async function glClient(){process.env.GENLAYER_RPC_URL=manifest.genLayerRpc;const store=new DeploymentStore();for(const doc of journal.genlayerTransactions)await store.put("transactions",doc);return new GenLayer(store);}
async function emitEnv(){
 const values:Record<string,string>={INTENTGUARD_MODE:"testnet",XLAYER_CHAIN_ID:"1952",XLAYER_RPC_URL:manifest.rpcUrl,PAYMENT_TOKEN:manifest.token!,CARD_FACTORY_ADDRESS:manifest.factoryAddress!,GATEWAY_ADDRESS:manifest.gateway!,ATTESTOR_ADDRESS:manifest.attestor!,TAPEOUT_PROCESSOR:manifest.processor!,TAPEOUT_CIRCUIT_ID:manifest.circuitId,TAPEOUT_BEACON:manifest.beacon!,TAPEOUT_IMPLEMENTATION:manifest.implementation!,TAPEOUT_NETLIST_HASH:manifest.netlistHash,GENLAYER_RPC_URL:manifest.genLayerRpc,GENLAYER_INTERPRETER_ADDRESS:manifest.interpreter??"",DEPLOYER_PRIVATE_KEY:key(),XLAYER_OPERATOR_PRIVATE_KEY:key(),REVIEW_ATTESTOR_PRIVATE_KEY:journal.attestorKey!,GENLAYER_OPERATOR_PRIVATE_KEY:key()};
 await atomic(envPath,Object.entries(values).map(([name,value])=>name+"="+value).join("\n")+"\n",true);Object.assign(process.env,values);
}
async function deploy(){
 await identity();const account=privateKeyToAccount(key());const balance=await pub.getBalance({address:account.address});assert.ok(balance>0n,"Supplied deployer has no X Layer test gas");
 manifest.gateway=account.address;manifest.operator=account.address;journal.attestorKey??=generatePrivateKey();manifest.attestor=privateKeyToAccount(journal.attestorKey).address;await save();
 console.log(JSON.stringify({network:"X Layer testnet",chainId:1952,deployer:account.address,balanceWei:balance.toString(),processorKind:manifest.processorKind}));
 manifest.processor=await deployEvm("processor","TestnetNandProcessor",["0x"+netlist.toString("hex")]);manifest.implementation=manifest.processor;
 manifest.beacon=await deployEvm("beacon","TestnetNandProcessor",[manifest.processor],"TestnetProcessorBeacon");
 manifest.token=await deployEvm("token","TestnetUSDT");
 manifest.factoryAddress=await deployEvm("factoryAddress","CardFactory");
 await emitEnv();
 const gl=await glClient();const actualChain=await gl.client.getChainId();assert.equal(actualChain,61999,"Refusing non-Studionet deployment");
 const source=await readFile(new URL("contracts/genlayer/permission_interpreter.py",root));
 if(!manifest.interpreterTx){
 const saved=journal.genlayerTransactions.find(row=>row._id==="gl:deploy:testnet-interpreter");
 if(saved?.evmHash){const existing=await gl.client.getTransaction({hash:saved.evmHash as GLHash}).catch(()=>null);if(existing){assert.equal((existing.sender??existing.from_address)?.toLowerCase(),gl.account().address.toLowerCase());manifest.interpreterTx=String(saved.evmHash);saved.protocolHash=manifest.interpreterTx;manifest.transactions.interpreter=manifest.interpreterTx;await save();console.log(JSON.stringify({step:"interpreter",recovery:"existing Studionet protocol hash",transactionHash:manifest.interpreterTx}));}}
 }
 if(!manifest.interpreterTx){manifest.interpreterTx=await gl.send("deploy:testnet-interpreter",client=>client.deployContract({code:source,args:[genLayerAddress(gl.account().address)]}));manifest.transactions.interpreter=manifest.interpreterTx;await save();console.log(JSON.stringify({step:"interpreter",transactionHash:manifest.interpreterTx,chainId:61999}));}
 const until=Date.now()+Number(process.env.GENLAYER_FINALITY_TIMEOUT_MS??1200000);let previousStatus="";
 while(Date.now()<until){
  try{const tx=await gl.client.getTransaction({hash:manifest.interpreterTx as GLHash});const status=String(tx.statusName??tx.status);if(status!==previousStatus){console.log("Studionet interpreter consensus status",status);previousStatus=status;}assertFinalized(tx);const decoded=tx.txDataDecoded;assert.ok(decoded&&decoded.type==="deploy"&&"contractAddress"in decoded);assert.equal(decoded.code,source.toString("utf8"));const args=normalizedCalldata(decoded.constructorArgs) as {args?:unknown[]};assert.equal(canonical(args.args),canonical([gl.account().address.toLowerCase()]));manifest.interpreter=decoded.contractAddress??tx.recipient??tx.to_address;assert.ok(manifest.interpreter);assert.equal(String(await gl.read(manifest.interpreter,"get_operator")).toLowerCase(),gl.account().address.toLowerCase());await save();await emitEnv();break;}
  catch(e){if(!(e instanceof PendingFinality))throw e;await new Promise(r=>setTimeout(r,5000));}
 }
 assert.ok(manifest.interpreter,"Interpreter still awaiting successful finality; rerun deploy to resume");
 await verify();
}
async function verify(){
 await identity();for(const name of ["processor","beacon","token","factoryAddress"] as const){const address=manifest[name];assert.ok(address&&/^0x[0-9a-fA-F]{40}$/.test(address),"Missing testnet "+name);assert.ok((await pub.getCode({address:address as Address}))?.length!>2,name+" has no bytecode");const tx=manifest.transactions[name];assert.ok(tx,"Missing deployment receipt "+name);const receipt=await pub.getTransactionReceipt({hash:tx as Hex});assert.equal(receipt.status,"success");assert.equal(receipt.contractAddress?.toLowerCase(),address.toLowerCase());
 const builds={processor:["TestnetNandProcessor","TestnetNandProcessor",["0x"+netlist.toString("hex")]],beacon:["TestnetNandProcessor","TestnetProcessorBeacon",[manifest.processor]],token:["TestnetUSDT","TestnetUSDT",[]],factoryAddress:["CardFactory","CardFactory",[]]} as const;
 const [source,contract,args]=builds[name],compiled=await artifact(source,contract),expected=encodeDeployData({abi:compiled.abi,bytecode:compiled.bytecode.object,args});
 const submitted=await pub.getTransaction({hash:tx as Hex});assert.equal(submitted.input.toLowerCase(),expected.toLowerCase(),"Deployed creation bytecode/constructor differs from source");
 const code=await pub.getCode({address:address as Address});manifest.codeHashes??={};const actualHash=keccak256(code!);if(manifest.codeHashes[name])assert.equal(actualHash,manifest.codeHashes[name]);manifest.codeHashes[name]=actualHash;
}
 const cpu=parseAbi(["function netlist(uint256) view returns (bytes)","function circuitInfo(uint256) view returns (uint32,uint32,uint32,uint32)","function eval(uint256,bytes) view returns (bytes)"]);
 const [raw,info,decimals,implementation]=await Promise.all([
 pub.readContract({address:manifest.processor as Address,abi:cpu,functionName:"netlist",args:[1n]}),
 pub.readContract({address:manifest.processor as Address,abi:cpu,functionName:"circuitInfo",args:[1n]}),
 pub.readContract({address:manifest.token as Address,abi:parseAbi(["function decimals() view returns (uint8)"]),functionName:"decimals"}),
 pub.readContract({address:manifest.beacon as Address,abi:parseAbi(["function implementation() view returns (address)"]),functionName:"implementation"})]);
 assert.equal(raw.toLowerCase(),"0x"+netlist.toString("hex"));assert.deepEqual(info,[451,8,0,meta.gateCount]);assert.equal(decimals,6);assert.equal(implementation.toLowerCase(),manifest.processor!.toLowerCase());
 const input=Buffer.alloc(57);[1n,2n,2n,2n,0n,1n,2n].forEach((v,i)=>input.writeBigUInt64LE(v,i*8));input[56]=7;
 assert.equal(await pub.readContract({address:manifest.processor as Address,abi:cpu,functionName:"eval",args:[1n,("0x"+input.toString("hex")) as Hex]}),"0x01");
 input.writeBigUInt64LE(3n,0);assert.notEqual(await pub.readContract({address:manifest.processor as Address,abi:cpu,functionName:"eval",args:[1n,("0x"+input.toString("hex")) as Hex]}),"0x01");
 assert.ok(manifest.interpreter&&manifest.interpreterTx,"Missing finalized Studionet interpreter");const gl=await glClient();assert.equal(await gl.client.getChainId(),61999);const tx=await gl.client.getTransaction({hash:manifest.interpreterTx as GLHash});assertFinalized(tx);
 const source=await readFile(new URL("contracts/genlayer/permission_interpreter.py",root),"utf8"),decoded=tx.txDataDecoded;
 assert.ok(decoded&&decoded.type==="deploy"&&"contractAddress"in decoded);assert.equal(decoded.code,source);
 const args=normalizedCalldata(decoded.constructorArgs) as {args?:unknown[]};assert.equal(canonical(args.args),canonical([manifest.operator!.toLowerCase()]));
 assert.equal((tx.sender??tx.from_address)?.toLowerCase(),manifest.operator!.toLowerCase());
 assert.equal(String(await gl.read(manifest.interpreter,"get_operator")).toLowerCase(),manifest.operator!.toLowerCase());manifest.verifiedAt=new Date().toISOString();await save();console.log("TESTNET_DEPLOYMENT_CHECK_PASSED");console.log(JSON.stringify(manifest,null,2));
}
try{if(action==="deploy")await deploy();else if(action==="verify")await verify();else{await identity();console.log(JSON.stringify({chainId:1952,rpcUrl:rpc,genLayerChainId:61999,genLayerRpc:manifest.genLayerRpc,circuitGates:meta.gateCount,processorKind:manifest.processorKind,knownMainnetTapeoutFactoryCode:await pub.getCode({address:"0x1f09daefa827f02cbb40967cc91b259763760761"})},null,2));}}
catch(e){const message=e instanceof Error?e.message:String(e);console.error("Testnet deployment/check failed: "+message.replace(/0x[0-9a-fA-F]{64,}/g,"[transaction-data-redacted]").slice(0,4000));process.exitCode=1;}
