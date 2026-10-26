// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Fixed Circle native-USDC / CCTP V2 profiles, checked against issuer tables on 2026-10-26.
/// @dev Candidate routes still require live issuer/RPC verification before operational activation.
/// Sources: https://developers.circle.com/stablecoins/usdc-contract-addresses.md
///          https://developers.circle.com/cctp/references/contract-addresses.md
///          https://developers.circle.com/cctp/concepts/supported-chains-and-domains.md
library CctpRoutesV4 {
    error UnsupportedAssetOrChain();
    error UnsupportedDestination();

    function source(uint256 chainId) internal pure returns (address usdc, address messenger, address transmitter, address minter) {
        if (chainId == 196) return (
            0xB6CEceAB302E2E4948951eE7843FC24E92933061,
            0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d,
            0x81D40F21F12A8F0E3252Bccb954D722d4c464B64,
            0xfd78EE919681417d192449715b2594ab58f5D002
        );
        if (chainId == 1952) return (
            0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3,
            0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA,
            0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275,
            0xb43db544E2c27092c107639Ad201b3dEfAbcF192
        );
        revert UnsupportedAssetOrChain();
    }

    function destination(uint256 sourceChainId, uint32 domain) internal pure returns (uint256 chainId, address usdc) {
        if (sourceChainId == 196) {
            if (domain == 37) return (196, 0xB6CEceAB302E2E4948951eE7843FC24E92933061);
            if (domain == 0) return (1, 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
            if (domain == 1) return (43114, 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E);
            if (domain == 2) return (10, 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85);
            if (domain == 3) return (42161, 0xaf88d065e77c8cC2239327C5EDb3A432268e5831);
            if (domain == 6) return (8453, 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
            if (domain == 7) return (137, 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359);
            if (domain == 10) return (130, 0x078D782b760474a361dDA0AF3839290b0EF57AD6);
            if (domain == 11) return (59144, 0x176211869cA2b568f2A7D4EE941E073a821EE1ff);
            if (domain == 14) return (480, 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1);
            if (domain == 19) return (999, 0xb88339CB7199b77E23DB6E890353E22632Ba630f);
        } else if (sourceChainId == 1952) {
            if (domain == 37) return (1952, 0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3);
            if (domain == 0) return (11155111, 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238);
            if (domain == 1) return (43113, 0x5425890298aed601595a70AB815c96711a31Bc65);
            if (domain == 2) return (11155420, 0x5fd84259d66Cd46123540766Be93DFE6D43130D7);
            if (domain == 3) return (421614, 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d);
            if (domain == 6) return (84532, 0x036CbD53842c5426634e7929541eC2318f3dCF7e);
            if (domain == 7) return (80002, 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582);
            if (domain == 10) return (1301, 0x31d0220469e10c4E71834a79b1f276d740d3768F);
            if (domain == 11) return (59141, 0xFEce4462D57bD51A6A552365A011b95f0E16d9B7);
            if (domain == 14) return (4801, 0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88);
            if (domain == 19) return (998, 0x2B3370eE501B4a559b57D449569354196457D8Ab);
        } else revert UnsupportedAssetOrChain();
        revert UnsupportedDestination();
    }
}
