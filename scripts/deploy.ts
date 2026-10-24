import {readFile,writeFile,mkdir,rename} from "node:fs/promises";
import {createPublicClient,createWalletClient,defineChain,http,parseAbi,encodeFunctionData,decodeEventLog,keccak256,toHex,type Hex,type Address,type Abi} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {createHash} from "node:crypto";
import {configuration} from "../apps/web/lib/config";
import {database} from "../apps/web/lib/store";
import {GenLayer,assertFinalized,genLayerAddress,normalizedCalldata,PendingFinality} from "../apps/web/lib/genlayer";
import {canonical,TOKEN} from "../packages/shared";
import type {Hash as GLHash} from "genlayer-js/types";
const factory="0x1f09daefa827f02cbb40967cc91b259763760761" as Address;
const tapeAbi=parseAbi(["function createCPU(string name,string symbol,string story,uint256 transistorSupply,uint256 mintPrice) payable returns (address transistors,address circuits)","function deployFee() view returns (uint256)","function circuitBeacon() view returns (address)","event CPUCreated(address indexed circuits,address indexed transistors,address indexed creator,string name,uint256 supply,uint256 mintPrice)"]);
const processorAbi=parseAbi(["function transistors() view returns (address)","function TAPEOUT_FEE() view returns (uint256)","function tapeout(bytes nl,uint32 nIn,uint32 nOut) payable returns (uint256)","function netlist(uint256 id) view returns (bytes)","function circuitInfo(uint256 id) view returns (uint32 nIn,uint32 nOut,uint32 nState,uint32 gateCount)","event TapedOut(uint256 indexed circuitId,address indexed author,uint32 gateCount,uint32 nState)"]);
const transistorAbi=parseAbi(["function mintPrice() view returns (uint256)","function protocolFee() view returns (uint256)","function balanceOf(address account,uint256 id) view returns (uint256)","function mint(uint256 id,uint256 amount) payable"]);
const beaconAbi=parseAbi(["function implementation() view returns (address)"]);
const tokenAbi=parseAbi(["function decimals() view returns (uint8)"]);
const c=configuration(),chain=defineChain({id:196,name:"X Layer",nativeCurrency:{name:"OKB",symbol:"OKB",decimals:18},rpcUrls:{default:{http:[c.rpcUrl]}}});
const pub=createPublicClient({chain,transport:http(c.rpcUrl,{timeout:15000,retryCount:0})});
const statePath=new URL("../.local/deployment.json",import.meta.url);
type Journal={processor?:string;transistors?:string;circuitId?:string;factoryAddress?:string;interpreter?:string;interpreterTx?:string;beacon?:string;implementation?:string;netlistHash?:string;transactions:Record<string,{raw:Hex;hash:Hex}>};
let journal:Journal=JSON.parse(await readFile(statePath,"utf8").catch(()=>'{"transactions":{}}'));
async function save(){await mkdir(new URL("../.local/",import.meta.url),{recursive:true});const temp=new URL("../.local/deployment.tmp",import.meta.url);await writeFile(temp,JSON.stringify(journal,null,2),{mode:0o600});await rename(temp,statePath)}
export async function checkDeployment(){
 if(c.local||await pub.getChainId()!==196)throw Error("Deployments require X Layer chain 196");
 const metadata=JSON.parse(await readFile(new URL("../circuits/artifacts/policy.metadata.json",import.meta.url),"utf8"));
 const netlist=await readFile(new URL("../circuits/artifacts/policy.netlist.bin",import.meta.url));
 if(metadata.sha256!=="0x"+createHash("sha256").update(netlist).digest("hex")||metadata.bytes!==netlist.length||metadata.gateCount*7!==netlist.length||metadata.inputBits!==451||metadata.outputBits!==8)throw Error("Generated circuit integrity failed");
 const [fee,beacon,decimals]=await Promise.all([pub.readContract({address:factory,abi:tapeAbi,functionName:"deployFee"}),pub.readContract({address:factory,abi:tapeAbi,functionName:"circuitBeacon"}),pub.readContract({address:TOKEN,abi:tokenAbi,functionName:"decimals"})]);
 if(decimals!==6)throw Error("Unexpected USDT decimals");
 const implementation=await pub.readContract({address:beacon,abi:beaconAbi,functionName:"implementation"});
 if(!await pub.getCode({address:implementation}))throw Error("TapeOut implementation has no code");
 return {chainId:196,token:TOKEN,deployFeeWei:fee.toString(),beacon,implementation,circuit:metadata,netlist};
}
async function send(id:string,to:Address|undefined,data:Hex,value=0n){
 const key=process.env.DEPLOYER_PRIVATE_KEY;if(!key)throw Error("Set a dedicated DEPLOYER_PRIVATE_KEY");
 const account=privateKeyToAccount(key as Hex),wallet=createWalletClient({account,chain,transport:http(c.rpcUrl,{timeout:15000,retryCount:0})});
 let tx=journal.transactions[id];if(!tx){const prepared=await wallet.prepareTransactionRequest({to,data,value});prepared.gas=prepared.gas*125n/100n+50000n;const raw=await wallet.signTransaction(prepared);tx={raw,hash:keccak256(raw)};journal.transactions[id]=tx;await save()}
 let receipt=await pub.getTransactionReceipt({hash:tx.hash}).catch(()=>null);if(!receipt){await wallet.sendRawTransaction({serializedTransaction:tx.raw}).catch(async e=>{if(!await pub.getTransaction({hash:tx.hash}).catch(()=>null))throw e});receipt=await pub.waitForTransactionReceipt({hash:tx.hash,confirmations:2,timeout:120000})}
 if(receipt.status!=="success")throw Error("Deployment step reverted: "+id);return receipt;
}
async function main(){
 if(c.testnet){process.argv[2]=process.argv[2]==="check"?"check":"deploy";await import("./testnet");return;}
 const step=process.argv[2]??"check";if(!["check","tapeout","factory","genlayer"].includes(step))throw Error("Use check, tapeout, factory or genlayer");
 const checked=await checkDeployment();const {netlist,...summary}=checked;console.log(JSON.stringify({action:step,broadcast:process.argv.includes("--broadcast"),...summary},null,2));
 if(step==="check"||!process.argv.includes("--broadcast")){console.log("Read-only deployment plan. Add --broadcast to an explicitly requested deployment step.");return}
 if(step==="tapeout"){
 if(!journal.processor&&c.processor)journal.processor=c.processor;
 if(!journal.processor){const receipt=await send("cpu",factory,encodeFunctionData({abi:tapeAbi,functionName:"createCPU",args:["IntentGuard","IGUARD","Deterministic agent spending permissions",10000n,0n]}),BigInt(checked.deployFeeWei));
 for(const log of receipt.logs){if(log.address.toLowerCase()!==factory.toLowerCase())continue;try{const e=decodeEventLog({abi:tapeAbi,data:log.data,topics:log.topics});if(e.eventName==="CPUCreated"){journal.processor=e.args.circuits;journal.transistors=e.args.transistors}}catch{}}
 if(!journal.processor)throw Error("Missing CPUCreated event");await save();}
 const processor=journal.processor as Address;const transistors=await pub.readContract({address:processor,abi:processorAbi,functionName:"transistors"});journal.transistors=transistors;
 if(!journal.circuitId&&c.circuitId)journal.circuitId=c.circuitId;
 if(!journal.circuitId){
 const key=process.env.DEPLOYER_PRIVATE_KEY;if(!key)throw Error("Deployer key required");const account=privateKeyToAccount(key as Hex);
 const held=await pub.readContract({address:transistors,abi:transistorAbi,functionName:"balanceOf",args:[account.address,0n]});const missing=BigInt(checked.circuit.gateCount)-held;
 if(missing>0n){const [price,fee]=await Promise.all([pub.readContract({address:transistors,abi:transistorAbi,functionName:"mintPrice"}),pub.readContract({address:transistors,abi:transistorAbi,functionName:"protocolFee"})]);await send("mint",transistors,encodeFunctionData({abi:transistorAbi,functionName:"mint",args:[0n,missing]}),price*missing+fee);}
 const fee=await pub.readContract({address:processor,abi:processorAbi,functionName:"TAPEOUT_FEE"});
 const receipt=await send("tapeout",processor,encodeFunctionData({abi:processorAbi,functionName:"tapeout",args:[toHex(netlist),451,8]}),fee);
 for(const log of receipt.logs){if(log.address.toLowerCase()!==processor.toLowerCase())continue;try{const e=decodeEventLog({abi:processorAbi,data:log.data,topics:log.topics});if(e.eventName==="TapedOut")journal.circuitId=e.args.circuitId.toString()}catch{}}if(!journal.circuitId)throw Error("Missing circuit event");await save();}
 const [actual,info]=await Promise.all([pub.readContract({address:processor,abi:processorAbi,functionName:"netlist",args:[BigInt(journal.circuitId)]}),pub.readContract({address:processor,abi:processorAbi,functionName:"circuitInfo",args:[BigInt(journal.circuitId)]})]);
 if(actual.toLowerCase()!==toHex(netlist)||info[0]!==451||info[1]!==8||info[2]!==0||info[3]!==checked.circuit.gateCount)throw Error("Deployed circuit mismatch");
 journal.beacon=checked.beacon;journal.implementation=checked.implementation;journal.netlistHash=checked.circuit.sha256;
 }
 if(step==="factory"&&!journal.factoryAddress){const artifact=JSON.parse(await readFile(new URL("../contracts/evm/out/CardFactory.sol/CardFactory.json",import.meta.url),"utf8"));const receipt=await send("factory",undefined,artifact.bytecode.object as Hex);if(!receipt.contractAddress)throw Error("Factory address missing");journal.factoryAddress=receipt.contractAddress;}
 if(step==="genlayer"&&!journal.interpreter){
 const gl=new GenLayer(await database()),source=await readFile(new URL("../contracts/genlayer/permission_interpreter.py",import.meta.url));
 if(!journal.interpreterTx){journal.interpreterTx=await gl.send("deploy:interpreter",client=>client.deployContract({code:source,args:[genLayerAddress(gl.account().address)]}));await save();}
 const deadline=Date.now()+1200000;
 while(Date.now()<deadline){try{const tx=await gl.client.getTransaction({hash:journal.interpreterTx as GLHash});assertFinalized(tx);const d=tx.txDataDecoded;if(!d||d.type!=="deploy"||!("contractAddress" in d)||d.code!==source.toString("utf8"))throw Error("Interpreter deployment code mismatch");const args=normalizedCalldata(d.constructorArgs) as {args?:unknown[]};if(canonical(args.args)!==canonical([gl.account().address.toLowerCase()]))throw Error("Interpreter operator mismatch");journal.interpreter=d.contractAddress??tx.recipient??tx.to_address;if(!journal.interpreter)throw Error("Missing interpreter address");break;}catch(e){if(!(e instanceof PendingFinality))throw e;await new Promise(r=>setTimeout(r,5000))}}
 if(!journal.interpreter)throw Error("Deployment remains pending; rerun the same step to resume");
 }
 await save();console.log("Verified public deployment configuration",JSON.stringify({processor:journal.processor,circuitId:journal.circuitId,beacon:journal.beacon,implementation:journal.implementation,netlistHash:journal.netlistHash,factoryAddress:journal.factoryAddress,interpreter:journal.interpreter},null,2));
}
if(import.meta.url===new URL(process.argv[1],"file://").href)await main();
