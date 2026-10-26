import {privateKeyToAccount} from "viem/accounts";
import {CCTP_TESTNETS,TESTNET_ASSETS} from "../../../packages/shared/assets";
import {TOKEN} from "../../../packages/shared";

export type PaymentEnvironment="local"|"testnet"|"mainnet";
export const STUDIONET_CHAIN_ID=61999;
export const STUDIONET_CONSENSUS="0xb7278a61aa25c888815afc32ad3cc52ff24fe575";
const nonzeroAddress=(value:unknown):value is string=>typeof value==="string"&&/^0x[0-9a-fA-F]{40}$/.test(value)&&!/^0x0{40}$/.test(value);
function origin(value:string,hosted:boolean){const url=new URL(value);if(url.username||url.password||url.hash||url.search||!["","/"].includes(url.pathname)||(hosted&&url.protocol!=="https:")||!["https:","http:"].includes(url.protocol))throw Error("APP_URL must be a canonical origin");return url.origin;}
export function configuration(){
 // No implicit mainnet profile. An unconfigured build may render the public page.
 const explicit=process.env.INTENTGUARD_MODE;
 const mode=explicit??"local";
 if(!["local","testnet","mainnet"].includes(mode))throw Error("Use an explicit local, testnet or mainnet IntentGuard mode");
 const local=mode==="local",testnet=mode==="testnet",mainnet=mode==="mainnet";
 const paymentEnvironment=mode as PaymentEnvironment;
 if(process.env.INTENTGUARD_PAYMENT_ENV&&process.env.INTENTGUARD_PAYMENT_ENV!==paymentEnvironment)throw Error("Payment environment does not match runtime mode");
 const expectedChain=local?Number(process.env.XLAYER_CHAIN_ID??31337):testnet?1952:196;
 if(!Number.isSafeInteger(expectedChain)||expectedChain<1)throw Error("Invalid payment chain");
 if(!local&&process.env.XLAYER_CHAIN_ID&&Number(process.env.XLAYER_CHAIN_ID)!==expectedChain)throw Error("Payment chain does not match environment");
 if(mainnet&&(process.env.INTENTGUARD_PAYMENT_ENV!=="mainnet"||process.env.XLAYER_CHAIN_ID!=="196"))throw Error("Mainnet requires explicit payment environment and chain196");
 const databaseName=process.env.MONGODB_DB??(mainnet?"":local?"intentguard_local":"intentguard");
 if(mainnet&&databaseName!=="intentguard_mainnet")throw Error("Mainnet requires its isolated intentguard_mainnet database");
 if(testnet&&databaseName==="intentguard_mainnet")throw Error("Testnet cannot use the mainnet database");
 if(local&&databaseName==="intentguard_mainnet")throw Error("Local mode cannot use the mainnet database");
 const token=mainnet?TOKEN:process.env.PAYMENT_TOKEN??(local?TOKEN:"");
 if(mainnet&&process.env.PAYMENT_TOKEN&&process.env.PAYMENT_TOKEN.toLowerCase()!==TOKEN)throw Error("Mainnet legacy asset must be official USDT0");
 const gateway=process.env.GATEWAY_ADDRESS??(process.env.XLAYER_OPERATOR_PRIVATE_KEY?privateKeyToAccount(process.env.XLAYER_OPERATOR_PRIVATE_KEY as `0x${string}`).address:undefined);
 const attestor=process.env.ATTESTOR_ADDRESS??(process.env.REVIEW_ATTESTOR_PRIVATE_KEY?privateKeyToAccount(process.env.REVIEW_ATTESTOR_PRIVATE_KEY as `0x${string}`).address:undefined);
 if(mainnet&&gateway&&attestor&&gateway.toLowerCase()===attestor.toLowerCase())throw Error("Mainnet gateway and attestor must use separate keys");
 const genLayerNetwork=process.env.GENLAYER_NETWORK??"studionet";
 if(process.env.GENLAYER_CHAIN_ID&&Number(process.env.GENLAYER_CHAIN_ID)!==STUDIONET_CHAIN_ID)throw Error("GenLayer review chain must be Studionet61999");
 if(genLayerNetwork!=="studionet")throw Error("GenLayer review requires Studionet");
 if(mainnet&&genLayerNetwork!=="studionet")throw Error("Mainnet payment beta requires explicitly verified Studionet testnet review");
 const appOrigin=origin(process.env.APP_URL??"http://localhost:3000",mainnet);
 const cfg={mode:paymentEnvironment,local,testnet,mainnet,paymentEnvironment,reviewEnvironment:"testnet" as const,chainId:expectedChain,token,databaseName,rpcUrl:process.env.XLAYER_RPC_URL??(local?"http://127.0.0.1:8545":testnet?"https://testrpc.xlayer.tech":"https://rpc.xlayer.tech"),factoryAddress:process.env.CARD_FACTORY_ADDRESS,gateway,attestor,processor:process.env.TAPEOUT_PROCESSOR,circuitId:process.env.TAPEOUT_CIRCUIT_ID,beacon:process.env.TAPEOUT_BEACON,expectedImplementation:process.env.TAPEOUT_IMPLEMENTATION,expectedNetlistHash:process.env.TAPEOUT_NETLIST_HASH,genLayerNetwork:genLayerNetwork as "studionet",genLayerRpc:process.env.GENLAYER_RPC_URL??"https://studio.genlayer.com/api",genLayerGenesis:process.env.GENLAYER_GENESIS_HASH,genLayerConsensus:process.env.GENLAYER_CONSENSUS_ADDRESS,interpreter:process.env.GENLAYER_INTERPRETER_ADDRESS,origin:appOrigin,releaseId:process.env.INTENTGUARD_RELEASE_ID??null,sourceCommit:process.env.INTENTGUARD_SOURCE_COMMIT??null,verifiedManifest:process.env.INTENTGUARD_VERIFIED_MANIFEST,verifiedManifestSha256:process.env.INTENTGUARD_VERIFIED_MANIFEST_SHA256};
 const addresses=[cfg.token,cfg.factoryAddress,cfg.gateway,cfg.attestor,cfg.processor,cfg.beacon,cfg.expectedImplementation,cfg.interpreter];
 const mainnetReady=!mainnet||(!!cfg.releaseId&&/^[0-9a-f]{40}$/.test(cfg.sourceCommit??"")&&!!cfg.genLayerRpc&&/^0x[0-9a-f]{64}$/.test(cfg.genLayerGenesis??"")&&cfg.genLayerConsensus?.toLowerCase()===STUDIONET_CONSENSUS&&!!cfg.verifiedManifest&&/^[0-9a-f]{64}$/.test(cfg.verifiedManifestSha256??""));
 return {...cfg,configured:!!explicit&&mainnetReady&&addresses.every(nonzeroAddress)&&!!cfg.circuitId&&/^0x[0-9a-fA-F]{64}$/.test(cfg.expectedNetlistHash??"")&&!!process.env.MONGODB_URI};
}
export function publicConfiguration(){const c=configuration();return{mode:c.mode,paymentEnvironment:c.paymentEnvironment,reviewEnvironment:c.reviewEnvironment,reviewNetwork:c.genLayerNetwork,reviewChainId:STUDIONET_CHAIN_ID,reviewInfrastructure:"studionet-simulator",releaseId:c.releaseId,sourceCommit:c.sourceCommit,chainId:c.chainId,token:c.token,factoryAddress:c.factoryAddress??null,rpcUrl:c.rpcUrl,networkName:c.testnet?"X Layer Testnet":c.local?"Local test chain":"X Layer Mainnet",applicationUrl:c.origin,configured:c.configured&&!!process.env.SESSION_SECRET&&process.env.SESSION_SECRET.length>=32,explorerUrl:c.local?"":c.testnet?"https://www.oklink.com/xlayer-test":"https://www.oklink.com/xlayer",genLayerExplorerUrl:"https://explorer-studio.genlayer.com",paymentSymbol:c.testnet?"TEST-USDT":"USDT0",assets:c.testnet?TESTNET_ASSETS:[],spendingNetworks:c.testnet?Object.values(CCTP_TESTNETS).map(({chainId,name,domain,token,explorerUrl})=>({chainId,name,domain,token,explorerUrl})):[],cctpFactoryAddress:c.testnet||c.mainnet?(process.env.CCTP_CARD_FACTORY_ADDRESS??null):null,guard:{gateway:c.gateway,attestor:c.attestor,processor:c.processor,circuitId:c.circuitId,beacon:c.beacon,expectedImplementation:c.expectedImplementation,expectedNetlistHash:c.expectedNetlistHash}}}
