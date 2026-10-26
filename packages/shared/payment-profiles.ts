/** Candidate issuer registry. Entries are NOT enabled deployment capabilities.
 * Release verification must check current issuer state before an API advertises
 * availability. Earlier three-route TESTNET_ASSETS remains unchanged.
 */
export type PaymentEnvironment="testnet"|"mainnet";
export type PaymentAsset="USDC"|"USDT0";
export type PaymentAddress=`0x${string}`;
export type Route=Readonly<{
 chainId:number;name:string;domain:number;rpcUrl:string;explorerUrl:string;
 token:PaymentAddress;testnet:boolean;messenger:PaymentAddress;transmitter:PaymentAddress;minter:PaymentAddress;
 rpcEnvironmentKey:string;availability:"candidate";verified:false;
}>;
export const ISSUER_SOURCES=Object.freeze({
 usdc:"https://developers.circle.com/stablecoins/usdc-contract-addresses.md",
 cctp:"https://developers.circle.com/cctp/references/contract-addresses.md",
 usdt0Mainnet:"https://docs.usdt0.to/api/deployments?chainId=196",
 usdt0Testnet:"https://docs.usdt0.to/api/deployments?chainId=1952"
});
export const USDT0_MAINNET="0x779ded0c9e1022225f8e0630b35a9b54be713736";
export const SOURCE_CHAIN_IDS=Object.freeze({mainnet:196,testnet:1952});
export const CCTP_SOURCE_DOMAIN=37,CCTP_STANDARD_FINALITY=2000,CCTP_MAX_FEE_ATOMIC="0";
export const CCTP_IRIS=Object.freeze({mainnet:"https://iris-api.circle.com",testnet:"https://iris-api-sandbox.circle.com"});
const contracts=Object.freeze({
 mainnet:Object.freeze({messenger:"0x28b5a0e9c621a5badaa536219b3a228c8168cf5d",transmitter:"0x81d40f21f12a8f0e3252bccb954d722d4c464b64",minter:"0xfd78ee919681417d192449715b2594ab58f5d002"}),
 testnet:Object.freeze({messenger:"0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",transmitter:"0xe737e5cebeeba77efe34d4aa090756590b1ce275",minter:"0xb43db544e2c27092c107639ad201b3defabcf192"})
});
type Definition=readonly[number,string,number,string,string,string,string];
const mainnet:readonly Definition[]=[
 [196,"X Layer Mainnet",37,"0xb6ceceab302e2e4948951ee7843fc24e92933061","https://rpc.xlayer.tech","https://www.okx.com/web3/explorer/xlayer","XLAYER_RPC_URL"],
 [8453,"Base",6,"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","https://mainnet.base.org","https://basescan.org","BASE_RPC_URL"],
 [42161,"Arbitrum One",3,"0xaf88d065e77c8cc2239327c5edb3a432268e5831","https://arb1.arbitrum.io/rpc","https://arbiscan.io","ARBITRUM_RPC_URL"],
 [10,"OP Mainnet",2,"0x0b2c639c533813f4aa9d7837caf62653d097ff85","https://mainnet.optimism.io","https://optimistic.etherscan.io","OPTIMISM_RPC_URL"],
 [1,"Ethereum",0,"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","https://ethereum.reth.rs/rpc","https://etherscan.io","ETHEREUM_RPC_URL"],
 [137,"Polygon PoS",7,"0x3c499c542cef5e3811e1192ce70d8cc03d5c3359","https://polygon.drpc.org","https://polygonscan.com","POLYGON_RPC_URL"],
 [43114,"Avalanche",1,"0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e","https://api.avax.network/ext/bc/C/rpc","https://snowtrace.io","AVALANCHE_RPC_URL"],
 [130,"Unichain",10,"0x078d782b760474a361dda0af3839290b0ef57ad6","https://mainnet.unichain.org","https://uniscan.xyz","UNICHAIN_RPC_URL"],
 [59144,"Linea",11,"0x176211869ca2b568f2a7d4ee941e073a821ee1ff","https://rpc.linea.build","https://lineascan.build","LINEA_RPC_URL"],
 [480,"World Chain",14,"0x79a02482a880bce3f13e09da970dc34db4cd24d1","https://worldchain-mainnet.g.alchemy.com/public","https://worldscan.org","WORLD_CHAIN_RPC_URL"],
 [999,"HyperEVM",19,"0xb88339cb7199b77e23db6e890353e22632ba630f","https://rpc.hyperliquid.xyz/evm","https://hyperevmscan.io","HYPEREVM_RPC_URL"]
];
const testnet:readonly Definition[]=[
 [1952,"X Layer Testnet",37,"0xdec90b78111ba2fc6fc6d84d8b9ec159a2d4b9b3","https://testrpc.xlayer.tech","https://www.okx.com/web3/explorer/xlayer-test","XLAYER_RPC_URL"],
 [84532,"Base Sepolia",6,"0x036cbd53842c5426634e7929541ec2318f3dcf7e","https://sepolia.base.org","https://sepolia.basescan.org","BASE_SEPOLIA_RPC_URL"],
 [421614,"Arbitrum Sepolia",3,"0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d","https://sepolia-rollup.arbitrum.io/rpc","https://sepolia.arbiscan.io","ARBITRUM_SEPOLIA_RPC_URL"],
 [11155420,"OP Sepolia",2,"0x5fd84259d66cd46123540766be93dfe6d43130d7","https://sepolia.optimism.io","https://optimism-sepolia.blockscout.com","OPTIMISM_SEPOLIA_RPC_URL"],
 [11155111,"Ethereum Sepolia",0,"0x1c7d4b196cb0c7b01d743fbc6116a902379c7238","https://11155111.rpc.thirdweb.com","https://sepolia.etherscan.io","ETHEREUM_SEPOLIA_RPC_URL"],
 [80002,"Polygon PoS Amoy",7,"0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582","https://polygon-amoy.drpc.org","https://amoy.polygonscan.com","POLYGON_AMOY_RPC_URL"],
 [43113,"Avalanche Fuji",1,"0x5425890298aed601595a70ab815c96711a31bc65","https://api.avax-test.network/ext/bc/C/rpc","https://testnet.snowtrace.io","AVALANCHE_FUJI_RPC_URL"],
 [1301,"Unichain Sepolia",10,"0x31d0220469e10c4e71834a79b1f276d740d3768f","https://sepolia.unichain.org","https://sepolia.uniscan.xyz","UNICHAIN_SEPOLIA_RPC_URL"],
 [59141,"Linea Sepolia",11,"0xfece4462d57bd51a6a552365a011b95f0e16d9b7","https://rpc.sepolia.linea.build","https://sepolia.lineascan.build","LINEA_SEPOLIA_RPC_URL"],
 [4801,"World Chain Sepolia",14,"0x66145f38cbac35ca6f1dfb4914df98f1614aea88","https://worldchain-sepolia.g.alchemy.com/public","https://sepolia.worldscan.org","WORLD_CHAIN_SEPOLIA_RPC_URL"],
 [998,"HyperEVM Testnet",19,"0x2b3370ee501b4a559b57d449569354196457d8ab","https://rpc.hyperliquid-testnet.xyz/evm","https://explore-testnet.hyperpc.app","HYPEREVM_TESTNET_RPC_URL"]
];
function registry(environment:PaymentEnvironment,definitions:readonly Definition[]):Readonly<Record<number,Route>>{
 const addresses=contracts[environment];
 function verifiedAddress(value:string):PaymentAddress{
  if(!/^0x[0-9a-f]{40}$/.test(value)||/^0x0{40}$/.test(value))throw Error("Invalid candidate issuer address");
  return value as PaymentAddress;
 }
 const rows=definitions.map(([chainId,name,domain,token,rpcUrl,explorerUrl,rpcEnvironmentKey])=>{
  if(!Number.isSafeInteger(chainId)||chainId<1||!Number.isSafeInteger(domain)||domain<0||domain>=2**32)throw Error("Invalid candidate issuer chain or domain");
  const route:Route=Object.freeze({chainId,name,domain,token:verifiedAddress(token),rpcUrl,explorerUrl,rpcEnvironmentKey,testnet:environment==="testnet",availability:"candidate",verified:false,messenger:verifiedAddress(addresses.messenger),transmitter:verifiedAddress(addresses.transmitter),minter:verifiedAddress(addresses.minter)});
  return [chainId,route] as const;
 });
 if(new Set(rows.map(([id])=>id)).size!==rows.length||new Set(rows.map(([,row])=>row.domain)).size!==rows.length)throw Error("Duplicate candidate issuer chain or domain");
 return Object.freeze(Object.fromEntries(rows));
}
const profiles=Object.freeze({mainnet:registry("mainnet",mainnet),testnet:registry("testnet",testnet)});
export function profileRoutes(environment:PaymentEnvironment):Readonly<Record<number,Route>>{
 if(environment!=="mainnet"&&environment!=="testnet")throw Error("Explicit payment environment required");
 return profiles[environment];
}
export function paymentRoute(environment:PaymentEnvironment,chainId:number):Route{
 const route=profileRoutes(environment)[chainId];if(!route||!Number.isSafeInteger(chainId))throw Error("Destination does not belong to the payment environment");return route;
}
export function sourceToken(environment:PaymentEnvironment,asset:PaymentAsset):PaymentAddress{
 if(asset==="USDC")return paymentRoute(environment,SOURCE_CHAIN_IDS[environment]).token;
 if(asset==="USDT0"&&environment==="mainnet")return USDT0_MAINNET;
 throw Error("Unsupported or unverified source asset");
}
