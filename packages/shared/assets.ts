/** Issuer deployments, never synthetic tokens. Testnet assets have no dollar backing.
 * Sources are pinned in docs/deployments/stablecoins.json and rechecked by verify-stablecoins.ts.
 * EVM chain IDs and CCTP domains are different namespaces.
 */
export const TESTNET_CHAIN_IDS = [1952, 84532, 421614] as const;
export type TestnetChainId = (typeof TESTNET_CHAIN_IDS)[number];
export const CCTP_IRIS_TESTNET = "https://iris-api-sandbox.circle.com";
export const CCTP_FINALITY = 2000;
export const CCTP_MAX_FEE = "0";
const contracts = {
  messenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  transmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
  minter: "0xb43db544E2c27092c107639Ad201b3dEfAbcF192",
} as const;
type LegacyRoute={chainId:TestnetChainId;name:string;domain:number;rpcUrl:string;explorerUrl:string;token:`0x${string}`;testnet:true;messenger:`0x${string}`;transmitter:`0x${string}`;minter:`0x${string}`};
export const CCTP_TESTNETS:Readonly<Record<number,LegacyRoute>> = {
  1952: { chainId: 1952, name: "X Layer Testnet", domain: 37, rpcUrl: "https://testrpc.xlayer.tech", explorerUrl: "https://www.okx.com/web3/explorer/xlayer-test", token: "0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3", testnet: true, ...contracts },
  84532: { chainId: 84532, name: "Base Sepolia", domain: 6, rpcUrl: "https://sepolia.base.org", explorerUrl: "https://sepolia.basescan.org", token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", testnet: true, ...contracts },
  421614: { chainId: 421614, name: "Arbitrum Sepolia", domain: 3, rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc", explorerUrl: "https://sepolia.arbiscan.io", token: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", testnet: true, ...contracts },
} as const;
export function testnetRoute(chainId: number) {
  if (!(TESTNET_CHAIN_IDS as readonly number[]).includes(chainId)) throw Error("Unsupported destination testnet");
  return CCTP_TESTNETS[chainId as TestnetChainId];
}
export const TESTNET_ASSETS = [
  {
    asset: "USDC", symbol: "USDC", chainId: 1952, decimals: 6, token: CCTP_TESTNETS[1952].token,
    available: true, reason: "Circle-issued testnet USDC. X Layer deposits can fund approved CCTP V2 testnet payments.",
    sources: ["https://developers.circle.com/stablecoins/usdc-contract-addresses.md", "https://developers.circle.com/cctp/references/contract-addresses.md"],
  },
  {
    asset: "USDT0", symbol: "USDT0", chainId: 1952, decimals: 6, token: null,
    available: false, reason: "Official USDT0 token and OFT deployment on X Layer testnet have not been verified. Mainnet addresses are not accepted as testnet deployments.",
    sources: ["https://docs.usdt0.to/api/deployments?chainId=1952", "https://docs.usdt0.to/technical-documentation/deployments.md"],
  },
] as const;
