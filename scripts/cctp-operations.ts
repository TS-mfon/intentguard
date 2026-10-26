import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {MongoClient} from "mongodb";
import {createPublicClient,createWalletClient,defineChain,http,parseAbi,encodeFunctionData,encodeDeployData,decodeEventLog,keccak256,padHex,parseTransaction,recoverTransactionAddress,getContractAddress,type Hex,type Address,type Abi,type TransactionReceipt,type TransactionSerialized} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {CCTP_TESTNETS,CCTP_IRIS_TESTNET,type TestnetChainId} from "../packages/shared/assets";
import {canonical,digest} from "../packages/shared";
import {MongoStore,type Store,type Doc} from "../apps/web/lib/store";
import {parseCctpMessage} from "../apps/web/lib/cctp";

const OPERATOR="0xed9edd8586b20524cafa4f568413c504c9b03172" as Address;
const AMOUNT=5_000_000n,SOURCE=84532 as const,DESTINATION=1952 as const;
const FACTORY_OP="cctp-factory:v1",FUND_OP="cctp-fund-base-to-xlayer-5usdc:v1";
const FACTORY_CREATION_HASH="0x893e0d05dc4425e392b07990e2bee862e4398969843e598ac7ae0c3320fbca4c";
const FACTORY_RUNTIME_HASH="0x556a67d6594c335ec8ac3e75ad014bd7b3be68bc0b85b15237a88461761daf27";
const FACTORY_SOURCE_HASHES:Record<string,string>={
 "src/AgentSpendingCard.sol":"0x3cfd7cc2cf4b6d769e8a43abe9e0f39069bdb6c212bdf91d6ec15bb2eec2b90f",
 "src/CctpCardFactory.sol":"0xa5ede391e6e21ac65494aeb73aff2d04a3bd3104a10b67f831e4afc2ebeb5fec",
 "src/CctpSpendingCard.sol":"0xa9de2912c5c416ed08394544e8de6f7d58511e2e6cdb5e2ed29dc7df81b75528",
 "src/vendor/interfaces/ICPU.sol":"0xf73218404762ef30cf728976b5c513cfeacddebb4997c4acb5fe02d9790ab911"
};

const zero=padHex("0x0",{size:32}),root=new URL("../",import.meta.url);
const manifestPath=new URL("docs/deployments/cctp.json",root),publicPath=new URL(".local/cctp-operations/public.json",root);
const mode=process.argv[2]??"check";
if(!["check","deploy","fund","verify"].includes(mode)||process.argv.length>3)throw Error("Use exactly one operation: check, deploy, fund or verify");
const tokenAbi=parseAbi(["function decimals() view returns (uint8)","function symbol() view returns (string)","function paused() view returns (bool)","function balanceOf(address) view returns (uint256)","function approve(address,uint256) returns (bool)","event Transfer(address indexed from,address indexed to,uint256 value)"]);
const messengerAbi=parseAbi(["function localMessageTransmitter() view returns (address)","function localMinter() view returns (address)","function remoteTokenMessengers(uint32) view returns (bytes32)","function depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)"]);
const transmitterAbi=parseAbi(["function localDomain() view returns (uint32)","function paused() view returns (bool)","function usedNonces(bytes32) view returns (uint256)","function receiveMessage(bytes,bytes) returns (bool)","event MessageSent(bytes message)","event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)"]);
const minterAbi=parseAbi(["function getLocalToken(uint32,bytes32) view returns (address)","function paused() view returns (bool)"]);
class OperationError extends Error {constructor(readonly code:string,message:string){super(message)}}
class OperationPending extends OperationError {}
function requireValue(value:unknown,message:string):asserts value{if(!value)throw new OperationError("CCTP_OPERATIONS_COMMITMENT_MISMATCH",message)}
const shutdown=new AbortController();
process.once("SIGTERM",()=>shutdown.abort());process.once("SIGINT",()=>shutdown.abort());
function signingEnvironment(env:Record<string,string|undefined>){
 requireValue(env.GITHUB_ACTIONS==="true","Live signing is restricted to GitHub Actions.");
 requireValue(env.INTENTGUARD_MODE==="testnet"&&env.XLAYER_CHAIN_ID==="1952","Provisioning only accepts X Layer testnet configuration.");
}
function signer(){
 signingEnvironment(process.env);
 const key=process.env.XLAYER_OPERATOR_PRIVATE_KEY;
 requireValue(key&&/^0x[0-9a-fA-F]{64}$/.test(key),"The Actions operator signing secret is missing.");
 const account=privateKeyToAccount(key as Hex);
 requireValue(account.address.toLowerCase()===OPERATOR.toLowerCase(),"Signing secret does not match the fixed testnet operator.");
 return account;
}
// The local preflight transport accepts read-only RPC methods only. Signed payloads never enter curl.
const readMethods=new Set(["eth_chainId","eth_blockNumber","eth_getCode","eth_call","eth_getBalance","eth_getTransactionReceipt","eth_getLogs"]);
async function readOnlyFetch(input:string|URL|Request,init?:RequestInit):Promise<Response>{
 const request=new Request(input,init),url=new URL(request.url);
 requireValue(Object.values(CCTP_TESTNETS).some(c=>c.rpcUrl===url.href||c.rpcUrl.replace(/\/$/,"")===url.href.replace(/\/$/,"")),"Preflight RPC endpoint is not in the verified testnet registry.");
 const text=await request.text(),body=JSON.parse(text),calls=Array.isArray(body)?body:[body];
 requireValue(calls.every(x=>readMethods.has(x.method)),"Preflight attempted a non-read-only RPC call.");
 return new Promise((resolve,reject)=>{
  const child=spawn("curl",["--fail","--silent","--show-error","--compressed","--max-time","25","--header","Content-Type: application/json","--data-binary","@-",url.href],{stdio:["pipe","pipe","pipe"]});
  const chunks:Buffer[]=[];let size=0;const timer=setTimeout(()=>child.kill("SIGTERM"),30000);
  const abort=()=>child.kill("SIGTERM");request.signal.addEventListener("abort",abort,{once:true});
  child.stdout.on("data",chunk=>{size+=chunk.length;if(size>2097152)child.kill("SIGTERM");else chunks.push(chunk)});
  child.stderr.resume();child.once("error",()=>{clearTimeout(timer);reject(new OperationPending("CCTP_OPERATIONS_RPC_UNAVAILABLE","The verified testnet RPC is temporarily unavailable."))});
  child.once("close",code=>{clearTimeout(timer);request.signal.removeEventListener("abort",abort);if(code!==0)reject(new OperationPending("CCTP_OPERATIONS_RPC_UNAVAILABLE","The verified testnet RPC is temporarily unavailable."));else resolve(new Response(Buffer.concat(chunks),{status:200,headers:{"Content-Type":"application/json"}}))});
  child.stdin.end(text);
 });
}
function network(chainId:TestnetChainId){
 const config=CCTP_TESTNETS[chainId];
 requireValue(config&&[1952,84532,421614].includes(chainId)&&config.testnet,"Unsupported provisioning testnet.");
 const chain=defineChain({id:chainId,name:config.name,testnet:true,nativeCurrency:{name:chainId===1952?"Test OKB":"Test Ether",symbol:chainId===1952?"OKB":"ETH",decimals:18},rpcUrls:{default:{http:[config.rpcUrl]}}});
 const transport=()=>http(config.rpcUrl,{timeout:15000,retryCount:0,...(process.env.GITHUB_ACTIONS!=="true"?{fetchFn:readOnlyFetch}:{})});
 return {config,chain,transport,public:createPublicClient({chain,transport:transport(),cacheTime:0,pollingInterval:1500})};
}
async function identity(chainId:TestnetChainId){
 const n=network(chainId);requireValue(await n.public.getChainId()===chainId,"RPC EVM chain ID differs from the fixed testnet.");
 requireValue(await n.public.readContract({address:n.config.transmitter,abi:transmitterAbi,functionName:"localDomain"})===n.config.domain,"RPC CCTP domain differs from the issuer deployment.");
 return n;
}
async function compiledFactory(){
 const artifact=JSON.parse(await readFile(new URL("contracts/evm/out/CctpCardFactory.sol/CctpCardFactory.json",root),"utf8"));
 const metadata=typeof artifact.metadata==="string"?JSON.parse(artifact.metadata):artifact.metadata;
 requireValue(metadata.compiler.version==="0.8.28+commit.7893614a"&&metadata.settings.viaIR===true&&metadata.settings.optimizer.enabled===true&&metadata.settings.optimizer.runs===200,"Factory compiler settings differ from the reviewed artifact.");
 requireValue(metadata.settings.compilationTarget["src/CctpCardFactory.sol"]==="CctpCardFactory","Artifact compilation target differs.");
 const sources:Record<string,string>={};
 for(const[path,entry]of Object.entries(metadata.sources as Record<string,{keccak256:string}>)){
  requireValue(!path.includes("..")&&path.startsWith("src/"),"Invalid compiled source path.");
  const actual=keccak256(await readFile(new URL("contracts/evm/"+path,root)));
  requireValue(actual===entry.keccak256,"Compiled factory artifact is stale relative to its Solidity sources.");
  sources[path]=actual;
 }
 requireValue(canonical(sources)===canonical(FACTORY_SOURCE_HASHES),"Factory Solidity sources differ from the exact reviewed provisioning release.");
 requireValue(artifact.abi.find((x:any)=>x.type==="constructor")?.inputs.length===0,"Factory constructor unexpectedly takes arguments.");
 const creation=artifact.bytecode.object as Hex,runtime=artifact.deployedBytecode.object as Hex;
 requireValue(/^0x[0-9a-fA-F]+$/.test(creation)&&/^0x[0-9a-fA-F]+$/.test(runtime),"Factory bytecode is not linked.");
 requireValue(keccak256(creation)===FACTORY_CREATION_HASH&&keccak256(runtime)===FACTORY_RUNTIME_HASH,"Factory bytecode differs from the exact reviewed provisioning release.");
 requireValue((runtime.length-2)/2<=24576,"Factory runtime exceeds the EVM deployment limit.");
 return {artifact,creation,runtime,public:{compiler:metadata.compiler.version,creationCodeHash:keccak256(creation),runtimeCodeHash:keccak256(runtime),runtimeBytes:(runtime.length-2)/2,sourceHashes:sources}};
}
function protocolControls(){
 // Pure adversarial fixtures test the reverse funding route. They never enter the database or product UI.
 const bytes=new Uint8Array(376),write=(at:number,size:number,value:bigint|string)=>{
  const hex=typeof value==="bigint"?value.toString(16):value.replace(/^0x/,"");
  const padded=hex.padStart(size*2,"0");requireValue(padded.length===size*2,"Invalid protocol-control field.");
  for(let i=0;i<size;i++)bytes[at+i]=parseInt(padded.slice(i*2,i*2+2),16);
 };
 write(0,4,1n);write(4,4,6n);write(8,4,37n);write(44,32,CCTP_TESTNETS[SOURCE].messenger);
 write(76,32,CCTP_TESTNETS[DESTINATION].messenger);write(140,4,2000n);write(148,4,1n);
 write(152,32,CCTP_TESTNETS[SOURCE].token);write(184,32,OPERATOR);write(216,32,AMOUNT);write(248,32,OPERATOR);
 const encoded=()=>"0x"+Buffer.from(bytes).toString("hex");
 const source=encoded();fundingMessage(source,false);
 write(12,32,1n);write(144,4,2000n);const attested=encoded();
 fundingMessage(attested,true,source);
 for(const[at,size,value]of [[4,4,37n],[8,4,6n],[184,32,1n],[216,32,AMOUNT-1n],[248,32,1n],[280,32,1n],[312,32,1n],[344,32,1n],[12,32,0n],[144,4,1999n]] as const){
  const previous=bytes.slice(at,at+size);write(at,size,value);assert.throws(()=>fundingMessage(encoded(),true,source));bytes.set(previous,at);
 }
 assert.throws(()=>fundingMessage(attested+"00",true,source));
 return true;
}

async function preflight(){
 assert.throws(()=>signingEnvironment({GITHUB_ACTIONS:"false",INTENTGUARD_MODE:"testnet",XLAYER_CHAIN_ID:"1952"}));
 assert.throws(()=>signingEnvironment({GITHUB_ACTIONS:"true",INTENTGUARD_MODE:"live",XLAYER_CHAIN_ID:"196"}));
 assert.throws(()=>network(196 as TestnetChainId));
 protocolControls();
 requireValue(SOURCE===84532&&DESTINATION===1952&&AMOUNT===5000000n,"Funding plan differs from its fixed authorization.");
 const artifact=await compiledFactory(),chains=[];
 for(const id of [1952,84532] as const){
  const n=await identity(id),c=n.config,remote=CCTP_TESTNETS[id===1952?84532:1952],block=await n.public.getBlockNumber();
  const hashes:Record<string,string>={};
  for(const role of ["token","messenger","transmitter","minter"] as const){
   const code=await n.public.getCode({address:c[role],blockNumber:block});requireValue(code&&code!=="0x","An issuer testnet contract has no deployed code.");hashes[role]=keccak256(code);
  }
  const [decimals,symbol,tokenPaused,transmitterPaused,minterPaused,localTransmitter,localMinter,remoteMessenger,localToken,usdc,gas]=await Promise.all([
   n.public.readContract({address:c.token,abi:tokenAbi,functionName:"decimals",blockNumber:block}),
   n.public.readContract({address:c.token,abi:tokenAbi,functionName:"symbol",blockNumber:block}),
   n.public.readContract({address:c.token,abi:tokenAbi,functionName:"paused",blockNumber:block}),
   n.public.readContract({address:c.transmitter,abi:transmitterAbi,functionName:"paused",blockNumber:block}),
   n.public.readContract({address:c.minter,abi:minterAbi,functionName:"paused",blockNumber:block}),
   n.public.readContract({address:c.messenger,abi:messengerAbi,functionName:"localMessageTransmitter",blockNumber:block}),
   n.public.readContract({address:c.messenger,abi:messengerAbi,functionName:"localMinter",blockNumber:block}),
   n.public.readContract({address:c.messenger,abi:messengerAbi,functionName:"remoteTokenMessengers",args:[remote.domain],blockNumber:block}),
   n.public.readContract({address:c.minter,abi:minterAbi,functionName:"getLocalToken",args:[remote.domain,padHex(remote.token,{size:32})],blockNumber:block}),
   n.public.readContract({address:c.token,abi:tokenAbi,functionName:"balanceOf",args:[OPERATOR],blockNumber:block}),
   n.public.getBalance({address:OPERATOR,blockNumber:block})
  ]);
  requireValue(decimals===6&&symbol==="USDC"&&!tokenPaused&&!transmitterPaused&&!minterPaused,"Issuer USDC/CCTP is not ready.");
  requireValue(localTransmitter.toLowerCase()===c.transmitter.toLowerCase()&&localMinter.toLowerCase()===c.minter.toLowerCase(),"Local CCTP contracts differ.");
  requireValue(remoteMessenger.toLowerCase()===padHex(remote.messenger,{size:32}).toLowerCase()&&localToken.toLowerCase()===c.token.toLowerCase(),"Native USDC remote routing differs.");
  chains.push({chainId:id,domain:c.domain,blockNumber:block.toString(),token:c.token,codeHashes:hashes,operatorUsdcAtomic:usdc.toString(),operatorGasWei:gas.toString()});
 }
 return {verifiedAt:new Date().toISOString(),factoryArtifact:artifact.public,chains};
}
type Tx=Doc&{chainId:TestnetChainId;raw:Hex;hash:Hex;dataHash:Hex;to:string|null;nonce:number;state:string;blockStart:string};
type Funding=Doc&{binding:string;phase:string;sourceMessage?:Hex;message?:Hex;attestation?:Hex;sourceTxHash?:Hex;destinationTxHash?:Hex;messageHash?:Hex;nonce?:Hex;destinationStartBlock?:string;destinationScanTo?:string};
let leaseLost=false;
async function guardSigning(chainId:TestnetChainId){
 if(shutdown.signal.aborted||leaseLost)throw new OperationPending("CCTP_OPERATIONS_INTERRUPTED","Provisioning stopped safely; journaled transactions remain resumable.");
 signingEnvironment(process.env);return identity(chainId);
}
async function transact(store:Store,id:string,chainId:TestnetChainId,to:Address|null,data:Hex):Promise<TransactionReceipt>{
 const n=await guardSigning(chainId);
 let saved=await store.get<Tx>("transactions",id);
 if(saved)requireValue(saved.chainId===chainId&&saved.to===(to?.toLowerCase()??null)&&saved.dataHash===keccak256(data)&&saved.hash===keccak256(saved.raw),"Journaled transaction differs from the fixed operation.");
 let receipt=saved?await n.public.getTransactionReceipt({hash:saved.hash}).catch(()=>null):null;
 if(receipt){
  requireValue(receipt.transactionHash.toLowerCase()===saved!.hash.toLowerCase()&&receipt.from.toLowerCase()===OPERATOR.toLowerCase(),"RPC receipt differs from the persisted operator-signed transaction.");
  await store.patch("transactions",id,{state:receipt.status==="success"?"MINED":"REVERTED",blockNumber:receipt.blockNumber.toString()});
  if(receipt.status!=="success")throw new OperationError("CCTP_OPERATIONS_TRANSACTION_REVERTED","A journaled operation reverted. Its hash is preserved; automatic replacement is refused.");
  if(await n.public.getBlockNumber()<receipt.blockNumber+1n)throw new OperationPending("CCTP_OPERATIONS_CONFIRMATIONS_PENDING","The existing transaction is awaiting confirmation.");
  return receipt;
 }
 const account=signer(),wallet=createWalletClient({chain:n.chain,account,transport:n.transport()});
 if(!saved){
  requireValue(await n.public.getBalance({address:OPERATOR})>0n,"The fixed operator needs native testnet gas.");
  const nonce=Math.max(...await Promise.all(["latest","pending"].map(blockTag=>n.public.getTransactionCount({address:OPERATOR,blockTag:blockTag as "latest"|"pending"}))));
  const prepared=await wallet.prepareTransactionRequest({to:to??undefined,data,value:0n,nonce});
  prepared.gas=prepared.gas*125n/100n+50000n;
  requireValue(prepared.gas<=12_000_000n,"Provisioning gas exceeds its bounded transaction cap.");
  await guardSigning(chainId);
  const raw=await wallet.signTransaction(prepared);
  const candidate:Tx={_id:id,chainId,raw,hash:keccak256(raw),dataHash:keccak256(data),to:to?.toLowerCase()??null,nonce,state:"PREPARED",createdAt:Date.now(),blockStart:(await n.public.getBlockNumber()).toString()};
  saved=await store.create("transactions",candidate)?candidate:await store.get<Tx>("transactions",id);
 }
 requireValue(saved,"Signed transaction journal persistence failed.");
 const decoded=parseTransaction(saved.raw);
 requireValue(Number(decoded.chainId)===chainId&&decoded.nonce===saved.nonce&&(decoded.to?.toLowerCase()??null)===(to?.toLowerCase()??null)&&keccak256(decoded.data??"0x")===keccak256(data)&&(decoded.value??0n)===0n,"Signed transaction bytes differ from the fixed operation.");
 requireValue((await recoverTransactionAddress({serializedTransaction:saved.raw as TransactionSerialized})).toLowerCase()===OPERATOR.toLowerCase(),"Journaled transaction was not signed by the fixed operator.");
 const known=await n.public.getTransaction({hash:saved.hash}).catch(()=>null);
 if(!known&&await n.public.getTransactionCount({address:OPERATOR,blockTag:"latest"})>saved.nonce)
  throw new OperationError("CCTP_OPERATIONS_NONCE_CONFLICT","A journaled nonce was consumed by a different transaction. Preserve the existing hash and investigate before recovery.");
 await guardSigning(chainId);
 try{await wallet.sendRawTransaction({serializedTransaction:saved.raw});await store.patch("transactions",id,{state:"BROADCAST",broadcastAt:Date.now()})}
 catch{if(!await n.public.getTransaction({hash:saved.hash}).catch(()=>null))throw new OperationPending("CCTP_OPERATIONS_SUBMISSION_PENDING","The same journaled transaction will be retried after RPC recovery.")}
 try{receipt=await n.public.waitForTransactionReceipt({hash:saved.hash,confirmations:2,timeout:25000,pollingInterval:1500})}
 catch{throw new OperationPending("CCTP_OPERATIONS_RECEIPT_PENDING","The same journaled transaction is awaiting its receipt.")}
 requireValue(receipt.transactionHash.toLowerCase()===saved.hash.toLowerCase()&&receipt.from.toLowerCase()===OPERATOR.toLowerCase(),"Confirmed receipt differs from the persisted operator-signed transaction.");
 await store.patch("transactions",id,{state:receipt.status==="success"?"MINED":"REVERTED",blockNumber:receipt.blockNumber.toString()});
 if(receipt.status!=="success")throw new OperationError("CCTP_OPERATIONS_TRANSACTION_REVERTED","A journaled operation reverted. Its hash is preserved; automatic replacement is refused.");
 return receipt;
}
async function operation(store:Store,id:string,binding:unknown){
 const bindingHash=digest(binding),existing=await store.get<Doc>("operations",id);
 if(existing)requireValue(existing.binding===bindingHash,"Existing provisioning operation has a different immutable binding.");
 else await store.create("operations",{_id:id,binding:bindingHash,createdAt:Date.now(),phase:"NEW",...binding as object});
 return (await store.get<Doc>("operations",id))!;
}
async function deploy(store:Store){
 const a=await compiledFactory(),op=await operation(store,FACTORY_OP,{operator:OPERATOR,chainId:1952,creationCodeHash:a.public.creationCodeHash,runtimeCodeHash:a.public.runtimeCodeHash});
 if(op.factoryAddress){const n=await identity(1952);requireValue(await n.public.getCode({address:op.factoryAddress as Address})===a.runtime,"Saved factory runtime differs from the compiled artifact.");return;}
 await store.patch("operations",FACTORY_OP,{phase:"DEPLOYMENT_PENDING"});
 const receipt=await transact(store,FACTORY_OP+":deploy",1952,null,encodeDeployData({abi:a.artifact.abi,bytecode:a.creation,args:[]}));
 requireValue(receipt.contractAddress,"Successful factory deployment returned no address.");
 const journal=await store.get<Tx>("transactions",FACTORY_OP+":deploy");
 requireValue(journal&&receipt.contractAddress.toLowerCase()===getContractAddress({from:OPERATOR,nonce:BigInt(journal.nonce)}).toLowerCase(),"Factory deployment address differs from the signed operator nonce.");
 const n=await identity(1952);requireValue(await n.public.getCode({address:receipt.contractAddress})===a.runtime,"Deployed factory runtime differs from the reviewed artifact.");
 await store.patch("operations",FACTORY_OP,{phase:"DEPLOYED",factoryAddress:receipt.contractAddress,factoryTxHash:receipt.transactionHash,blockNumber:receipt.blockNumber.toString(),verifiedAt:new Date().toISOString()});
}
function fundingMessage(message:string,attested:boolean,sourceMessage?:string):ReturnType<typeof parseCctpMessage>{
 let v:ReturnType<typeof parseCctpMessage>;
 try{v=parseCctpMessage(message)}catch{throw new OperationError("CCTP_OPERATIONS_MESSAGE_INVALID","Funding message is not the exact reviewed CCTP V2 standard-USDC payload.");}
 const source=CCTP_TESTNETS[SOURCE],destination=CCTP_TESTNETS[DESTINATION];
 requireValue(v.sourceDomain===6&&v.destinationDomain===37&&v.sender===padHex(source.messenger,{size:32}).toLowerCase()&&v.recipient===padHex(destination.messenger,{size:32}).toLowerCase(),"Funding CCTP source/destination/messenger changed.");
 requireValue(v.burnToken===padHex(source.token,{size:32}).toLowerCase()&&v.mintRecipient===padHex(OPERATOR,{size:32}).toLowerCase()&&v.messageSender===padHex(OPERATOR,{size:32}).toLowerCase()&&v.amount===AMOUNT,"Funding CCTP token/recipient/amount changed.");
 requireValue(v.destinationCaller===zero&&v.minFinality===2000&&v.maxFee===0n&&v.feeExecuted===0n&&v.expirationBlock===0n,"Funding did not use its fixed fee-free standard route.");
 requireValue(attested?v.nonce!==zero&&v.finalityExecuted>=2000:v.nonce===zero&&v.finalityExecuted===0,"Funding nonce/finality state is invalid.");
 if(sourceMessage){
  const original=fundingMessage(sourceMessage,false),{nonce:_,finalityExecuted:__,message:___,body:____,...stable}=v;
  const{nonce:a,finalityExecuted:b,message:d,body:e,...sourceStable}=original;
  requireValue(Object.entries(stable).every(([key,value])=>String(value)===String(sourceStable[key as keyof typeof sourceStable])),"Iris modified immutable funding message fields.");
 }
 return v;
}
async function iris(sourceTxHash:Hex){
 let response:Response;
 try{response=await fetch(CCTP_IRIS_TESTNET+"/v2/messages/6?transactionHash="+encodeURIComponent(sourceTxHash),{signal:AbortSignal.timeout(12000),redirect:"error",headers:{Accept:"application/json"}})}
 catch{throw new OperationPending("CCTP_ATTESTATION_UNAVAILABLE","Circle attestation service is temporarily unavailable; the existing burn is retained.")}
 if(response.status===404)return null;
 if(!response.ok)throw new OperationPending(response.status===429?"CCTP_RATE_LIMIT":"CCTP_ATTESTATION_UNAVAILABLE","Circle attestation service is temporarily unavailable; the existing burn is retained.");
 const reader=response.body?.getReader();requireValue(reader,"Circle returned no attestation body.");
 let size=0;const parts:Uint8Array[]=[];
 while(true){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>131072){await reader.cancel();throw new OperationError("CCTP_INVALID_RESPONSE","Circle attestation response exceeded its bounded size.")}parts.push(x.value)}
 let body:any;try{body=JSON.parse(Buffer.concat(parts).toString())}catch{throw new OperationError("CCTP_INVALID_RESPONSE","Circle returned invalid attestation JSON.")}
 requireValue(body.sourceTxHash?.toLowerCase()===sourceTxHash.toLowerCase()&&Array.isArray(body.messages),"Circle response is not bound to the existing funding burn.");
 const complete=body.messages.filter((x:any)=>x.cctpVersion===2&&x.status==="complete"&&typeof x.message==="string"&&typeof x.attestation==="string"&&/^0x(?:[0-9a-fA-F]{130})+$/.test(x.attestation));
 if(!complete.length)return null;
 requireValue(complete.length===1,"Circle returned ambiguous completed funding messages.");
 return complete[0] as {message:Hex;attestation:Hex};
}
function sourceBurnMessage(receipt:TransactionReceipt){
 requireValue(receipt.status==="success"&&receipt.from.toLowerCase()===OPERATOR.toLowerCase()&&receipt.to?.toLowerCase()===CCTP_TESTNETS[SOURCE].messenger.toLowerCase(),"Funding source receipt is not the fixed operator messenger burn.");
 const messages:Hex[]=[];
 for(const log of receipt.logs){if(log.address.toLowerCase()!==CCTP_TESTNETS[SOURCE].transmitter.toLowerCase())continue;
  try{const event=decodeEventLog({abi:transmitterAbi,data:log.data,topics:log.topics});if(event.eventName==="MessageSent")messages.push(event.args.message)}catch{}
 }
 requireValue(messages.length===1,"Funding burn has no unique CCTP message.");fundingMessage(messages[0],false);return messages[0];
}
function destinationReceipt(receipt:TransactionReceipt,message:Hex){
 const v=fundingMessage(message,true),destination=CCTP_TESTNETS[DESTINATION];
 requireValue(receipt.status==="success"&&receipt.to?.toLowerCase()===destination.transmitter.toLowerCase(),"Funding destination receipt is not a successful CCTP receive.");
 let received=0,minted=0;
 for(const log of receipt.logs){
  if(log.address.toLowerCase()===destination.transmitter.toLowerCase()){try{
   const e=decodeEventLog({abi:transmitterAbi,data:log.data,topics:log.topics});
   if(e.eventName==="MessageReceived"&&e.args.sourceDomain===6&&e.args.nonce.toLowerCase()===v.nonce&&e.args.sender.toLowerCase()===v.sender&&e.args.finalityThresholdExecuted===v.finalityExecuted&&e.args.messageBody.toLowerCase()===v.body.toLowerCase())received++;
  }catch{}}
  if(log.address.toLowerCase()===destination.token.toLowerCase()){try{
   const e=decodeEventLog({abi:tokenAbi,data:log.data,topics:log.topics});
   if(e.eventName==="Transfer"&&e.args.from.toLowerCase()==="0x"+"0".repeat(40)&&e.args.to.toLowerCase()===OPERATOR.toLowerCase()&&e.args.value===AMOUNT)minted++;
  }catch{}}
 }
 requireValue(received===1&&minted===1,"Destination receipt does not prove the exact five-USDC native mint to the fixed operator.");
 return {transactionHash:receipt.transactionHash,blockNumber:receipt.blockNumber.toString(),sourceDomain:v.sourceDomain,destinationDomain:v.destinationDomain,nonce:v.nonce,messageHash:keccak256(message),mintRecipient:OPERATOR,amountAtomic:AMOUNT.toString()};
}
async function fundStep(store:Store):Promise<boolean>{
 const op=await operation(store,FUND_OP,{operator:OPERATOR,amountAtomic:AMOUNT.toString(),sourceChainId:SOURCE,destinationChainId:DESTINATION,sourceToken:CCTP_TESTNETS[SOURCE].token,destinationToken:CCTP_TESTNETS[DESTINATION].token}) as Funding;
 if(op.phase==="VERIFIED"){requireValue(op.message&&op.destinationTxHash,"Verified funding proof is incomplete.");const n=await identity(1952);destinationReceipt(await n.public.getTransactionReceipt({hash:op.destinationTxHash}),op.message);return true;}
 const source=await identity(SOURCE),destination=await identity(DESTINATION);
 if(!op.sourceMessage){
  const burnJournal=await store.get<Tx>("transactions",FUND_OP+":burn");
  if(!burnJournal){
   requireValue(await source.public.readContract({address:source.config.token,abi:tokenAbi,functionName:"balanceOf",args:[OPERATOR]})>=AMOUNT,"The fixed Base Sepolia operator lacks five issuer USDC for funding.");
   if(!op.destinationStartBlock)await store.patch("operations",FUND_OP,{destinationStartBlock:(await destination.public.getBlockNumber()).toString()});
  }
  await store.patch("operations",FUND_OP,{phase:"APPROVING"});
  await transact(store,FUND_OP+":approve-zero",SOURCE,source.config.token,encodeFunctionData({abi:tokenAbi,functionName:"approve",args:[source.config.messenger,0n]}));
  await transact(store,FUND_OP+":approve",SOURCE,source.config.token,encodeFunctionData({abi:tokenAbi,functionName:"approve",args:[source.config.messenger,AMOUNT]}));
  await store.patch("operations",FUND_OP,{phase:"BURN_PENDING"});
  const receipt=await transact(store,FUND_OP+":burn",SOURCE,source.config.messenger,encodeFunctionData({abi:messengerAbi,functionName:"depositForBurn",args:[AMOUNT,37,padHex(OPERATOR,{size:32}),source.config.token,zero,0n,2000]}));
  const message=sourceBurnMessage(receipt);
  await store.patch("operations",FUND_OP,{phase:"BURNED",sourceMessage:message,sourceTxHash:receipt.transactionHash,sourceBlockNumber:receipt.blockNumber.toString(),updatedAt:Date.now()});
  return false;
 }
 requireValue(op.sourceTxHash,"Funding source transaction is missing.");
 const sourceReceipt=await source.public.getTransactionReceipt({hash:op.sourceTxHash});
 requireValue(sourceReceipt.transactionHash.toLowerCase()===op.sourceTxHash.toLowerCase(),"Stored funding source hash differs from its receipt.");
 sourceBurnMessage(sourceReceipt);
 await transact(store,FUND_OP+":approve-cleanup",SOURCE,source.config.token,encodeFunctionData({abi:tokenAbi,functionName:"approve",args:[source.config.messenger,0n]}));
 if(!op.message||!op.attestation){
  const proof=await iris(op.sourceTxHash);
  if(!proof){await store.patch("operations",FUND_OP,{phase:"ATTESTATION_PENDING",lastCheckedAt:Date.now()});return false;}
  const parsed=fundingMessage(proof.message,true,op.sourceMessage);
  await store.patch("operations",FUND_OP,{phase:"ATTESTED",message:proof.message,attestation:proof.attestation,nonce:parsed.nonce,messageHash:keccak256(proof.message),updatedAt:Date.now()});
  return false;
 }
 const parsed=fundingMessage(op.message,true,op.sourceMessage);let receipt:TransactionReceipt|null=null;
 if(op.destinationTxHash)receipt=await destination.public.getTransactionReceipt({hash:op.destinationTxHash});
 const journal=await store.get<Tx>("transactions",FUND_OP+":mint");
 if(!receipt&&journal)receipt=await destination.public.getTransactionReceipt({hash:journal.hash}).catch(()=>null);
 if(receipt?.status==="reverted"){
  const used=await destination.public.readContract({address:destination.config.transmitter,abi:transmitterAbi,functionName:"usedNonces",args:[parsed.nonce]});
  if(used===0n)throw new OperationError("CCTP_OPERATIONS_TRANSACTION_REVERTED","The destination mint transaction reverted. Its hash is retained for manual review; the source burn will not be repeated.");
  receipt=null; // A different relayer may have consumed the nonce first; locate that successful receipt.
 }
 if(!receipt){
  const used=await destination.public.readContract({address:destination.config.transmitter,abi:transmitterAbi,functionName:"usedNonces",args:[parsed.nonce]});
  if(used===0n){
   await store.patch("operations",FUND_OP,{phase:"MINT_PENDING"});
   try{receipt=await transact(store,FUND_OP+":mint",DESTINATION,destination.config.transmitter,encodeFunctionData({abi:transmitterAbi,functionName:"receiveMessage",args:[op.message,op.attestation]}))}
   catch(error){if(error instanceof OperationError&&error.code==="CCTP_OPERATIONS_TRANSACTION_REVERTED"&&await destination.public.readContract({address:destination.config.transmitter,abi:transmitterAbi,functionName:"usedNonces",args:[parsed.nonce]})===1n){await store.patch("operations",FUND_OP,{phase:"MINT_RECEIPT_DISCOVERY"});return false;}throw error;}
  }else{
   const latest=await destination.public.getBlockNumber(),to=BigInt(op.destinationScanTo??latest.toString()),start=BigInt(op.destinationStartBlock??"0"),from=to>start+99n?to-99n:start;
   requireValue(to>=start,"Funding mint receipt discovery crossed its initial block.");
   const event=transmitterAbi.find(e=>e.type==="event"&&e.name==="MessageReceived");
   const logs=await destination.public.getLogs({address:destination.config.transmitter,event:event as any,args:{nonce:parsed.nonce},fromBlock:from,toBlock:to});
   if(!logs.length){if(from===start)throw new OperationPending("CCTP_FUNDING_RECEIPT_UNAVAILABLE","CCTP nonce was consumed but its exact destination receipt was not found. Preserve the original burn for reconciliation.");await store.patch("operations",FUND_OP,{phase:"MINT_RECEIPT_DISCOVERY",destinationScanTo:(from-1n).toString()});return false;}
   requireValue(logs.length===1&&logs[0].transactionHash,"Funding nonce has ambiguous destination receipt events.");
   receipt=await destination.public.getTransactionReceipt({hash:logs[0].transactionHash});
  }
 }
 const proof=destinationReceipt(receipt,op.message);
 requireValue(await destination.public.getBlockNumber()>=receipt.blockNumber+1n,"Funding mint is awaiting confirmation.");
 requireValue(await destination.public.readContract({address:destination.config.transmitter,abi:transmitterAbi,functionName:"usedNonces",args:[parsed.nonce]})===1n,"Funding message was not consumed on its destination.");
 await store.patch("operations",FUND_OP,{phase:"VERIFIED",destinationTxHash:proof.transactionHash,destinationBlockNumber:proof.blockNumber,receiptProof:proof,verifiedAt:new Date().toISOString(),updatedAt:Date.now()});
 return true;
}
async function wait(ms:number){if(shutdown.signal.aborted)return;await new Promise<void>(resolve=>{const timer=setTimeout(done,ms);function done(){clearTimeout(timer);shutdown.signal.removeEventListener("abort",done);resolve()}shutdown.signal.addEventListener("abort",done,{once:true})})}
async function withSigningLease(task:(store:Store)=>Promise<void>){
 signingEnvironment(process.env);signer();
 requireValue(process.env.MONGODB_URI,"Actions durable storage configuration is missing.");
 const client=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000,maxPoolSize:5,minPoolSize:0,maxIdleTimeMS:30000});
 await client.connect();const db=process.env.MONGODB_DB??"intentguard",store=new MongoStore(client,db),locks=client.db(db).collection<Doc>("locks");
 await store.create("locks",{_id:"worker",createdAt:Date.now(),updatedAt:Date.now()});
 const lease=await store.claim<Doc>("locks",{_id:"worker"},Date.now(),120000);
 if(!lease){await client.close();throw new OperationPending("CCTP_OPERATIONS_WORKER_BUSY","The shared signing worker lease is busy. Retry this operation after the active worker completes.");}
 let inFlight=Promise.resolve();
 const heartbeat=setInterval(()=>{inFlight=inFlight.then(async()=>{
  const result=await locks.updateOne({_id:"worker",leaseToken:lease.leaseToken},{$set:{leaseUntil:Date.now()+120000}});
  if(result.matchedCount!==1){leaseLost=true;shutdown.abort();}
 }).catch(()=>{leaseLost=true;shutdown.abort()})},30000);
 try{await task(store)}
 finally{clearInterval(heartbeat);await inFlight;await store.complete("locks","worker",String(lease.leaseToken),{nextAt:0});await client.close();}
}
async function publicState(store?:Store,preflightState?:Awaited<ReturnType<typeof preflight>>,error?:OperationError){
 const previous=JSON.parse(await readFile(manifestPath,"utf8").catch(()=>"{}"));
 const factory=store?await store.get<Doc>("operations",FACTORY_OP):null,funding=store?await store.get<Funding>("operations",FUND_OP):null;
 const factoryTx=store?await store.get<Tx>("transactions",FACTORY_OP+":deploy"):null,burnTx=store?await store.get<Tx>("transactions",FUND_OP+":burn"):null,mintTx=store?await store.get<Tx>("transactions",FUND_OP+":mint"):null;
 const result={version:1,network:"testnet",chainId:1952,operator:OPERATOR,protocol:"CCTP_V2",sourceDomain:37,
  factoryAddress:factory?.factoryAddress??process.env.CCTP_CARD_FACTORY_ADDRESS??previous.factoryAddress??null,
  factoryTxHash:factory?.factoryTxHash??factoryTx?.hash??previous.factoryTxHash??null,
  factoryPhase:factory?.phase??previous.factoryPhase??"NOT_DEPLOYED",
  factoryArtifact:preflightState?.factoryArtifact??previous.factoryArtifact??null,
  sourceFunding:funding?{amountAtomic:AMOUNT.toString(),sourceChainId:SOURCE,destinationChainId:DESTINATION,sourceDomain:6,destinationDomain:37,sourceToken:CCTP_TESTNETS[SOURCE].token,destinationToken:CCTP_TESTNETS[DESTINATION].token,recipient:OPERATOR,phase:funding.phase,sourceTxHash:funding.sourceTxHash??burnTx?.hash??null,destinationTxHash:funding.destinationTxHash??mintTx?.hash??null,messageHash:funding.messageHash??null,nonce:funding.nonce??null,sourceBlockNumber:funding.sourceBlockNumber??null,destinationBlockNumber:funding.destinationBlockNumber??null,receiptProof:funding.receiptProof??null,verifiedAt:funding.verifiedAt??null}:previous.sourceFunding??null,
  preflight:preflightState??previous.preflight??null,updatedAt:new Date().toISOString(),githubRunId:process.env.GITHUB_RUN_ID??null,
  ...(error?{error:{code:error.code,message:error.message}}:{})};
 await mkdir(new URL(".local/cctp-operations/",root),{recursive:true});
 await writeFile(publicPath,JSON.stringify(result,null,2)+"\n");
 await mkdir(new URL("docs/deployments/",root),{recursive:true});await writeFile(manifestPath,JSON.stringify(result,null,2)+"\n");
 console.log(JSON.stringify(result));return result;
}
async function verify(store?:Store){
 const state=await publicState(store),a=await compiledFactory();
 requireValue(typeof state.factoryAddress==="string"&&/^0x[0-9a-fA-F]{40}$/.test(state.factoryAddress),"No deployed CCTP factory is available for verification.");
 const n=await identity(1952);
 requireValue(await n.public.getCode({address:state.factoryAddress as Address})===a.runtime,"Factory runtime does not match the current reviewed artifact.");
 if(state.sourceFunding?.phase==="VERIFIED"){
  requireValue(store,"Funding verification requires the durable operation record.");
  const funding=await store.get<Funding>("operations",FUND_OP);requireValue(funding?.message&&funding.destinationTxHash&&funding.sourceTxHash,"Durable funding receipt data is missing.");
  const source=await identity(SOURCE),sourceMessage=sourceBurnMessage(await source.public.getTransactionReceipt({hash:funding.sourceTxHash}));
  fundingMessage(funding.message,true,sourceMessage);destinationReceipt(await n.public.getTransactionReceipt({hash:funding.destinationTxHash}),funding.message);
 }
 console.log("CCTP_OPERATIONS_VERIFICATION_PASSED");
}
async function main(){
 const checked=await preflight();
 if(mode==="check"){console.log(JSON.stringify(checked));console.log("CCTP_OPERATIONS_CHECK_PASSED");return;}
 if(mode==="verify"&&process.env.GITHUB_ACTIONS!=="true"){await verify();await publicState(undefined,checked);return;}
 let pending=false;
 await withSigningLease(async store=>{
  let failure:OperationError|undefined;
  try{
   if(mode==="verify")await verify(store);
   else{
    const deadline=Date.now()+12*60*1000;let reported="";
    while(!shutdown.signal.aborted&&Date.now()<deadline){
     try{if(mode==="deploy"){await deploy(store);break;}if(await fundStep(store))break;}
     catch(error){
      if(error instanceof OperationError&&!(error instanceof OperationPending))throw error;
      const delayed=error instanceof OperationPending?error:new OperationPending("CCTP_OPERATIONS_RPC_RETRY","Testnet RPC or contract execution is temporarily unavailable. The existing operation will resume safely.");
      if(reported!==delayed.code){console.log(delayed.code+": "+delayed.message);reported=delayed.code;}
     }
     if(mode==="fund"&&(await store.get<Funding>("operations",FUND_OP))?.phase==="VERIFIED")break;
     await wait(15000);
    }
    const completed=mode==="deploy"?(await store.get<Doc>("operations",FACTORY_OP))?.phase==="DEPLOYED":(await store.get<Funding>("operations",FUND_OP))?.phase==="VERIFIED";
    if(!completed){pending=true;failure=new OperationPending("CCTP_OPERATIONS_PENDING","The bounded worker stopped with durable pending state. Dispatch the same operation to resume; do not create another burn.");}
   }
  }catch(error){
   failure=error instanceof OperationError?error:new OperationError("CCTP_OPERATIONS_FAILED","Provisioning could not complete. Inspect the preserved public state and retry the same operation after resolving connectivity or configuration.");
   throw failure;
  }finally{await publicState(store,checked,failure);}
 });
 console.log(pending?"CCTP_OPERATIONS_PENDING":"CCTP_OPERATIONS_COMPLETED");
}
main().then(()=>process.exit(0)).catch(async error=>{
 const safe=error instanceof OperationError?error:new OperationError("CCTP_OPERATIONS_FAILED","Provisioning failed before completion. Signed journals remain private and resumable.");
 console.error(safe.code+": "+safe.message);
 await publicState(undefined,undefined,safe).catch(()=>{});
 process.exit(1);
});
