// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {AgentSpendingCard} from "./AgentSpendingCard.sol";

interface IUSDT0Decimals { function decimals() external view returns (uint8); }

/// @notice Mainnet-only factory for standard AgentSpendingCards denominated in official X Layer USDT0.
/// @dev USDT0 cards settle locally through AgentSpendingCard; no CCTP interface or arbitrary token is exposed.
/// Issuer reference: https://docs.usdt0.to/technical-documentation/deployments
contract MainnetUsdt0CardFactory {
    uint256 public constant SOURCE_CHAIN_ID = 196;
    address public constant SOURCE_USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    bytes32 public immutable tokenCodeHash;
    mapping(address => bool) public isCard;
    mapping(address => address[]) private _ownerCards;
    event CardCreated(address indexed owner, address indexed card, bytes32 indexed policyHash);
    error UnsupportedAssetOrChain();

    constructor() {
        if (block.chainid != SOURCE_CHAIN_ID || SOURCE_USDT0.code.length == 0
            || IUSDT0Decimals(SOURCE_USDT0).decimals() != 6) revert UnsupportedAssetOrChain();
        tokenCodeHash = SOURCE_USDT0.codehash;
    }
    function createCard(AgentSpendingCard.Config calldata config) external returns (address card) {
        if (block.chainid != SOURCE_CHAIN_ID || config.token != SOURCE_USDT0
            || SOURCE_USDT0.codehash != tokenCodeHash || IUSDT0Decimals(SOURCE_USDT0).decimals() != 6)
            revert UnsupportedAssetOrChain();
        if (config.owner != msg.sender) revert AgentSpendingCard.Unauthorized();
        card = address(new AgentSpendingCard(config));
        isCard[card] = true;
        _ownerCards[msg.sender].push(card);
        emit CardCreated(msg.sender, card, config.policyHash);
    }
    function cardsOf(address owner) external view returns (address[] memory) { return _ownerCards[owner]; }
}
