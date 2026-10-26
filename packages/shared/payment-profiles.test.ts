import {test} from "node:test";
import assert from "node:assert/strict";
import {padHex,parseAbi,decodeFunctionData,encodeFunctionResult,type Hex,type Abi} from "viem";
import {profileRoutes,paymentRoute,sourceToken,SOURCE_CHAIN_IDS,USDT0_MAINNET,type PaymentEnvironment} from "./payment-profiles";
import {validateIssuerDocuments,validateUsdt0Document,validateCodeProof,validateRouteObservation,inspectRoute,createRpcReader,type CodeProof,type RouteObservation,type RpcReader} from "../../scripts/verify-mainnet-assets";
const zero=("0x"+"00".repeat(32)) as Hex,address="0x"+"11".repeat(20);
const mainIds=[196,8453,42161,10,1,137,43114,130,59144,480,999],testIds=[1952,84532,421614,11155420,11155111,80002,43113,1301,59141,4801,998];
const independentDomains=[37,6,3,2,0,7,1,10,11,14,19];
function code():CodeProof{return {code:"0x60006000",slots:{eip1967:zero,legacy:zero,beacon:zero},implementations:[]};}
function observation(environment:PaymentEnvironment,id:number):RouteObservation{
 const route=paymentRoute(environment,id),peers=Object.values(profileRoutes(environment)).filter(p=>p.chainId!==id);
 return {chainId:id,blockNumber:"123",blockHash:("0x"+"ab".repeat(32)) as Hex,decimals:6,symbol:"USDC",localDomain:route.domain,paused:{token:false,transmitter:false,minter:false},localTransmitter:route.transmitter,localMinter:route.minter,localMessenger:route.messenger,minFee:"0",feeForOneUsdc:"0",burnLimitAtomic:"100000000000",minterAllowanceAtomic:"100000000000",code:{token:code(),messenger:code(),transmitter:code(),minter:code()},remotes:peers.map(peer=>({chainId:peer.chainId,domain:peer.domain,messenger:padHex(peer.messenger as Hex,{size:32}),localToken:route.token}))};
}
test("fixed candidate profiles include only source plus ten approved destinations",()=>{
 for(const[environment,ids]of [["mainnet",mainIds],["testnet",testIds]] as const){
  const routes=profileRoutes(environment);assert.deepEqual(Object.keys(routes).map(Number).sort((a,b)=>a-b),[...ids].sort((a,b)=>a-b));
  ids.forEach((id,index)=>{const route=paymentRoute(environment,id);assert.equal(route.domain,independentDomains[index]);assert.equal(route.chainId,id);assert.equal(route.testnet,environment==="testnet");assert.equal(route.availability,"candidate");assert.equal(route.verified,false);assert.ok(Object.isFrozen(route));for(const field of ["token","messenger","transmitter","minter"] as const)assert.match(route[field],/^0x[0-9a-f]{40}$/);});
  assert.ok(Object.isFrozen(routes));
 }
});
test("environment selection rejects foreign chains and USDT0 testnet or CCTP authority",()=>{
 assert.equal(sourceToken("mainnet","USDT0"),USDT0_MAINNET);assert.equal(sourceToken("mainnet","USDC"),"0xb6ceceab302e2e4948951ee7843fc24e92933061");assert.equal(sourceToken("testnet","USDC"),"0xdec90b78111ba2fc6fc6d84d8b9ec159a2d4b9b3");
 assert.throws(()=>sourceToken("testnet","USDT0"));assert.throws(()=>sourceToken("mainnet","DOLLAR" as never));
 for(const id of mainIds)assert.throws(()=>paymentRoute("testnet",id));for(const id of testIds)assert.throws(()=>paymentRoute("mainnet",id));assert.throws(()=>profileRoutes("live" as never));
});
test("current good state validates all22 independent domain pairs",()=>{
 for(const[environment,ids]of [["mainnet",mainIds],["testnet",testIds]] as const)for(const id of ids){const route=paymentRoute(environment,id),peers=Object.values(profileRoutes(environment)).filter(p=>p.chainId!==id);assert.equal(validateRouteObservation(route,peers,observation(environment,id)).chainId,id);}
});
test("wrong chain token metadata domain paused state and fee cannot become verified",()=>{
 const route=paymentRoute("mainnet",196),peers=Object.values(profileRoutes("mainnet")).filter(p=>p.chainId!==196),valid=observation("mainnet",196);
 for(const change of [{chainId:1952},{decimals:18},{symbol:"USDC.e"},{localDomain:6},{blockHash:"0x00"},{minFee:"1"},{feeForOneUsdc:"1"},{burnLimitAtomic:"0"},{minterAllowanceAtomic:"0"},{localTransmitter:address},{localMinter:address},{localMessenger:address},{paused:{token:true,transmitter:false,minter:false}}])assert.throws(()=>validateRouteObservation(route,peers,{...valid,...change} as RouteObservation));
 for(const role of ["token","transmitter","minter"] as const)assert.throws(()=>validateRouteObservation(route,peers,{...valid,paused:{...valid.paused,[role]:true}}));
});
test("remote domain token messenger omissions and duplicate rows are rejected",()=>{
 const route=paymentRoute("testnet",1952),peers=Object.values(profileRoutes("testnet")).filter(p=>p.chainId!==1952),valid=observation("testnet",1952);
 for(const change of [{domain:37},{messenger:padHex(address as Hex,{size:32})},{localToken:address},{chainId:8453}]){const altered=structuredClone(valid);Object.assign(altered.remotes[0],change);assert.throws(()=>validateRouteObservation(route,peers,altered));}
 assert.throws(()=>validateRouteObservation(route,peers,{...valid,remotes:valid.remotes.slice(1)}));
 assert.throws(()=>validateRouteObservation(route,peers,{...valid,remotes:[valid.remotes[0],...valid.remotes.slice(0,-1)]}));
});
test("missing and unresolved delegatecall proxy code fails closed",()=>{
 const valid=code();validateCodeProof(valid);validateCodeProof({...valid,code:"0x60f400"});
 assert.throws(()=>validateCodeProof({...valid,code:"0x"}));assert.throws(()=>validateCodeProof({...valid,code:"0xf400"}));
 const proxy:CodeProof={code:"0xf400",slots:{eip1967:padHex(address as Hex,{size:32}),legacy:zero,beacon:zero},implementations:[{via:"eip1967",address,code:"0x6000",slots:code().slots}]};
 validateCodeProof(proxy);assert.throws(()=>validateCodeProof({...proxy,implementations:[]}));assert.throws(()=>validateCodeProof({...proxy,implementations:[{via:"eip1967",address,code:"0x",slots:code().slots}]}));
 assert.throws(()=>validateCodeProof({...proxy,slots:{...proxy.slots,legacy:padHex(("0x"+"22".repeat(20)) as Hex,{size:32})},implementations:[...proxy.implementations,{via:"legacy",address:"0x"+"22".repeat(20),code:"0x6000",slots:code().slots}]}));
});
test("issuer evidence checks the exact network table row rather than loose address presence",()=>{
 const route=paymentRoute("mainnet",8453);
 const docs={usdc:"## Mainnet\n| Blockchain | Address |\n| Base | "+route.token+" |\n| Ethereum | "+address+" |\n## Testnet\n",cctp:"## Mainnet contract addresses\n### TokenMessengerV2\n| Base | 6 | "+route.messenger+" |\n### MessageTransmitterV2\n| Base | 6 | "+route.transmitter+" |\n### TokenMinterV2\n| Base | 6 | "+route.minter+" |\n## Testnet contract addresses\n"};
 validateIssuerDocuments("mainnet",route,docs);
 assert.throws(()=>validateIssuerDocuments("testnet",route,docs));
 assert.throws(()=>validateIssuerDocuments("mainnet",route,{...docs,usdc:docs.usdc.replace("| Base | "+route.token,"| Base | "+address)+"\n"+route.token}));
 assert.throws(()=>validateIssuerDocuments("mainnet",route,{...docs,cctp:docs.cctp.replace("| Base | 6 |","| Base | 3 |")}));
 assert.throws(()=>validateIssuerDocuments("mainnet",route,{...docs,cctp:docs.cctp.replace(route.messenger,address)}));
});
test("USDT0 issuer evidence binds native mainnet token and refuses synthetic or testnet rows",()=>{
 const value={usdt0:{native:[{chainId:196,contracts:[{name:"Token",address:USDT0_MAINNET}]}]}};
 assert.equal(validateUsdt0Document(JSON.stringify(value)).chainId,196);
 assert.throws(()=>validateUsdt0Document("{}"));assert.throws(()=>validateUsdt0Document(JSON.stringify({usdt0:{native:[{chainId:1952,contracts:[{name:"Token",address:USDT0_MAINNET}]}]}})));
 assert.throws(()=>validateUsdt0Document(JSON.stringify({usdt0:{native:[{chainId:196,contracts:[{name:"Token",address}]}]}})));
});
const fixtureAbi:Abi=parseAbi(["function decimals() view returns(uint8)","function symbol() view returns(string)","function paused() view returns(bool)","function localDomain() view returns(uint32)","function localMessageTransmitter() view returns(address)","function localMinter() view returns(address)","function localTokenMessenger() view returns(address)","function remoteTokenMessengers(uint32) view returns(bytes32)","function getLocalToken(uint32,bytes32) view returns(address)","function burnLimitsPerMessage(address) view returns(uint256)","function minterAllowance(address) view returns(uint256)","function minFee() view returns(uint256)","function getMinFeeAmount(uint256) view returns(uint256)"]);
test("read-only probe uses pinned blocks and reorgs or mismatched RPC identity fail",async()=>{
 const route=paymentRoute("mainnet",196),peers=[paymentRoute("mainnet",8453)],seen:string[]=[];
 let reorg=false,blockReads=0,wrongChain=false;
 const read:RpcReader=async(method,params)=>{
  seen.push(method);if(method==="eth_chainId")return wrongChain?"0x7a0":"0xc4";
  if(method==="eth_blockNumber")return "0x7b";
  if(method==="eth_getBlockByNumber"){blockReads++;return {number:"0x7b",hash:"0x"+(reorg&&blockReads%2===0?"cd":"ab").repeat(32)};}
  if(method==="eth_getCode"){assert.equal(params[1],"0x7b");return "0x6000";}
  if(method==="eth_getStorageAt"){assert.equal(params[2],"0x7b");return zero;}
  assert.equal(method,"eth_call");assert.equal(params[1],"0x7b");
  const call=decodeFunctionData({abi:fixtureAbi,data:(params[0] as {data:Hex}).data});
  const results:Record<string,unknown>={decimals:6,symbol:"USDC",paused:false,localDomain:37,localMessageTransmitter:route.transmitter,localMinter:route.minter,localTokenMessenger:route.messenger,remoteTokenMessengers:padHex(peers[0].messenger as Hex,{size:32}),getLocalToken:route.token,burnLimitsPerMessage:100000000n,minterAllowance:100000000n,minFee:0n,getMinFeeAmount:0n};
  return encodeFunctionResult({abi:fixtureAbi,functionName:call.functionName,result:results[call.functionName]});
 };
 assert.equal((await inspectRoute(route,peers,read)).chainId,196);assert.ok(!seen.some(method=>method.startsWith("eth_send")));
 reorg=true;blockReads=0;await assert.rejects(inspectRoute(route,peers,read),/RPC_BLOCK_REORG/);
 wrongChain=true;seen.length=0;await assert.rejects(inspectRoute(route,peers,read),/RPC_CHAIN_MISMATCH/);assert.deepEqual(seen,["eth_chainId"]);
});

test("infrastructure registry matches independent issuer deployment literals",()=>{
 const expected={mainnet:{messenger:"0x28b5a0e9c621a5badaa536219b3a228c8168cf5d",transmitter:"0x81d40f21f12a8f0e3252bccb954d722d4c464b64",minter:"0xfd78ee919681417d192449715b2594ab58f5d002"},testnet:{messenger:"0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",transmitter:"0xe737e5cebeeba77efe34d4aa090756590b1ce275",minter:"0xb43db544e2c27092c107639ad201b3defabcf192"}};
 for(const environment of ["mainnet","testnet"] as const)for(const route of Object.values(profileRoutes(environment)))for(const field of ["messenger","transmitter","minter"] as const)assert.equal(route[field],expected[environment][field]);
});
test("legacy destination fee interfaces do not imply source fee exemption",()=>{
 const route=paymentRoute("mainnet",8453),peers=Object.values(profileRoutes("mainnet")).filter(p=>p.chainId!==8453),valid=observation("mainnet",8453);
 assert.equal(validateRouteObservation(route,peers,{...valid,minFee:null,feeForOneUsdc:null}).chainId,8453);
 const source=paymentRoute("mainnet",196),sourcePeers=Object.values(profileRoutes("mainnet")).filter(p=>p.chainId!==196);
 assert.throws(()=>validateRouteObservation(source,sourcePeers,{...observation("mainnet",196),minFee:null,feeForOneUsdc:null}));
});
test("unbound or malformed implementation proof cannot disguise a delegatecall proxy",()=>{
 const proof={...code(),code:"0xf400" as Hex,implementations:[{via:"eip1967" as const,address,code:"0x6000" as Hex,slots:code().slots}]};
 assert.throws(()=>validateCodeProof(proof));
 assert.throws(()=>validateCodeProof({...proof,slots:{...proof.slots,eip1967:padHex(address as Hex,{size:32})},implementations:[{via:"eip1967",address,code:"0xabc",slots:code().slots}]}));
});

test("issuer rows and native token entries cannot contain ambiguous duplicates",()=>{
 const route=paymentRoute("mainnet",8453);
 const docs={usdc:"## Mainnet\n| Base | "+route.token+" |\n| Base | "+route.token+" |\n",cctp:""};
 assert.throws(()=>validateIssuerDocuments("mainnet",route,docs),/AMBIGUOUS/);
 const row={chainId:196,contracts:[{name:"Token",address:USDT0_MAINNET}]};
 assert.throws(()=>validateUsdt0Document(JSON.stringify({usdt0:{native:[row,row]}})));
 assert.throws(()=>validateUsdt0Document(JSON.stringify({usdt0:{native:[{...row,contracts:[...row.contracts,...row.contracts]}]}})));
});
test("empty pause fields malformed quotas and zero block identities fail closed",()=>{
 const route=paymentRoute("mainnet",196),peers=[paymentRoute("mainnet",8453)],valid=observation("mainnet",196);
 valid.remotes=valid.remotes.filter(remote=>remote.chainId===8453);
 for(const fields of [{paused:{}},{paused:{token:false,minter:false}},{blockHash:zero},{blockNumber:"0x7b"},{burnLimitAtomic:"-1"},{minterAllowanceAtomic:String(2n**256n)},{minFee:"0x0"}])
  assert.throws(()=>validateRouteObservation(route,peers,{...valid,...fields} as RouteObservation));
});
test("beacon proofs must bind the actual returned implementation and agree with other slots",()=>{
 const implementation="0x"+"22".repeat(20),beacon="0x"+"33".repeat(20);
 const proof:CodeProof={...code(),code:"0xf400",slots:{...code().slots,beacon:padHex(beacon as Hex,{size:32})},beacon:{address:beacon,code:"0x6000",slots:code().slots,implementation},implementations:[{via:"beacon",address:implementation,code:"0x6000",slots:code().slots}]};
 validateCodeProof(proof);
 assert.throws(()=>validateCodeProof({...proof,implementations:[{...proof.implementations[0],address}]}));
 assert.throws(()=>validateCodeProof({...proof,slots:{...proof.slots,eip1967:padHex(address as Hex,{size:32})},implementations:[...proof.implementations,{via:"eip1967",address,code:"0x6000",slots:code().slots}]}));
 assert.throws(()=>validateCodeProof({...proof,slots:{...proof.slots,beacon:zero}}));
});
test("arbitrary map-shaped bytecode tails and unresolved nested proxies remain unsupported",()=>{
 assert.throws(()=>validateCodeProof({...code(),code:"0x00a1f40002"}));
 assert.throws(()=>validateCodeProof({...code(),code:"0xf400",slots:{...code().slots,eip1967:padHex(address as Hex,{size:32})},implementations:[{via:"eip1967",address,code:"0x6000",slots:{...code().slots,eip1967:padHex(address as Hex,{size:32})}}]}));
 // PUSH data containing f4 is a valid non-proxy positive control.
 validateCodeProof({...code(),code:"0x60f400"});
});

test("RPC transport denies writes before dispatch and malformed response envelopes never become state",async()=>{
 let requests=0,response='{"jsonrpc":"2.0","id":1,"result":"0xc4"}';
 const read=createRpcReader("https://rpc.example",async(_url,body)=>{requests++;assert.deepEqual(body,{jsonrpc:"2.0",id:1,method:"eth_chainId",params:[]});return response;});
 assert.equal(await read("eth_chainId",[]),"0xc4");assert.equal(requests,1);
 for(const method of ["eth_sendRawTransaction","eth_sendTransaction","personal_sign","wallet_sendCalls","eth_sign"]){
  await assert.rejects(read(method,[]),/PROBE_WRITE_METHOD_DENIED/);
 }assert.equal(requests,1);
 for(const invalid of ['{"id":2,"result":"0xc4"}','{"id":1,"error":{"message":"secret URL"}}','{"id":1}','{"id":1,"id":1,"result":"0xc4"}']){
  response=invalid;await assert.rejects(read("eth_chainId",[]));
 }
});
