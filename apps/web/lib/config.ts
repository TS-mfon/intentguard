import {privateKeyToAccount} from "viem/accounts";
import {CCTP_TESTNETS,TESTNET_ASSETS} from "../../../packages/shared/assets";
import {CHAIN_ID,TOKEN} from "../../../packages/shared";

export function configuration(){
 const mode=process.env.INTENTGUARD_MODE??"live";
 if(!["live","local","testnet"].includes(mode))throw Error("Unsupported IntentGuard mode");
 const local=mode==="local",testnet=mode==="testnet";
 if(testnet&&process.env.XLAYER_CHAIN_ID&&Number(process.env.XLAYER_CHAIN_ID)!==1952)throw Error("Testnet mode requires X Layer chain 1952");
 const chainId=local?Number(process.env.XLAYER_CHAIN_ID??31337):testnet?1952:CHAIN_ID;
 const token=local?(process.env.PAYMENT_TOKEN??TOKEN):testnet?(process.env.PAYMENT_TOKEN??""):TOKEN;
 const gateway=process.env.GATEWAY_ADDRESS??(process.env.XLAYER_OPERATOR_PRIVATE_KEY?privateKeyToAccount(process.env.XLAYER_OPERATOR_PRIVATE_KEY as `0x${string}`).address:undefined);
 const attestor=process.env.ATTESTOR_ADDRESS??(process.env.REVIEW_ATTESTOR_PRIVATE_KEY?privateKeyToAccount(process.env.REVIEW_ATTESTOR_PRIVATE_KEY as `0x${string}`).address:undefined);
 const cfg={mode,local,testnet,chainId,token,rpcUrl:process.env.XLAYER_RPC_URL??(testnet?"https://testrpc.xlayer.tech":"https://rpc.xlayer.tech"),factoryAddress:process.env.CARD_FACTORY_ADDRESS,gateway,attestor,processor:process.env.TAPEOUT_PROCESSOR,circuitId:process.env.TAPEOUT_CIRCUIT_ID,beacon:process.env.TAPEOUT_BEACON,expectedImplementation:process.env.TAPEOUT_IMPLEMENTATION,expectedNetlistHash:process.env.TAPEOUT_NETLIST_HASH,genLayerRpc:process.env.GENLAYER_RPC_URL??"https://studio.genlayer.com/api",interpreter:process.env.GENLAYER_INTERPRETER_ADDRESS,origin:process.env.APP_URL??"http://localhost:3000"};
 const addresses=[cfg.token,cfg.factoryAddress,cfg.gateway,cfg.attestor,cfg.processor,cfg.beacon,cfg.expectedImplementation,cfg.interpreter];
 return {...cfg,configured:addresses.every(a=>typeof a==="string"&&/^0x[0-9a-fA-F]{40}$/.test(a)&&!/^0x0{40}$/.test(a))&&!!cfg.circuitId&&/^0x[0-9a-fA-F]{64}$/.test(cfg.expectedNetlistHash??"")&&!!process.env.MONGODB_URI};
}
export function publicConfiguration(){const c=configuration();return{mode:c.mode as "live"|"local"|"testnet",chainId:c.chainId,token:c.token,factoryAddress:c.factoryAddress??null,rpcUrl:c.rpcUrl,networkName:c.testnet?"X Layer Testnet":c.local?"Local test chain":"X Layer",applicationUrl:c.origin,configured:c.configured&&!!process.env.SESSION_SECRET&&process.env.SESSION_SECRET.length>=32,explorerUrl:c.local?"":c.testnet?"https://www.oklink.com/xlayer-test":"https://www.oklink.com/xlayer",genLayerExplorerUrl:"https://explorer-studio.genlayer.com",paymentSymbol:c.testnet?"TEST-USDT":"USDT",assets:c.testnet?TESTNET_ASSETS:[],spendingNetworks:c.testnet?Object.values(CCTP_TESTNETS).map(({chainId,name,domain,token,explorerUrl})=>({chainId,name,domain,token,explorerUrl})):[],cctpFactoryAddress:c.testnet?(process.env.CCTP_CARD_FACTORY_ADDRESS??null):null,guard:{gateway:c.gateway,attestor:c.attestor,processor:c.processor,circuitId:c.circuitId,beacon:c.beacon,expectedImplementation:c.expectedImplementation,expectedNetlistHash:c.expectedNetlistHash}}}
