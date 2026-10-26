// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AgentSpendingCard} from "./AgentSpendingCard.sol";
import {CctpSpendingCard} from "./CctpSpendingCard.sol";

/// @notice Creates owner-bound issuer USDC cards with an immutable subset of testnet destinations.
contract CctpCardFactory {
    mapping(address => bool) public isCard;
    mapping(address => address[]) private _ownerCards;
    event CardCreated(address indexed owner, address indexed card, bytes32 indexed policyHash);

    constructor() {
        if (block.chainid != 1952) revert CctpSpendingCard.UnsupportedAssetOrChain();
    }

    function createCard(AgentSpendingCard.Config calldata config, uint32[] calldata allowedDomains)
        external returns (address card) {
        if (config.owner != msg.sender) revert AgentSpendingCard.Unauthorized();
        card = address(new CctpSpendingCard(config, allowedDomains));
        isCard[card] = true;
        _ownerCards[msg.sender].push(card);
        emit CardCreated(msg.sender, card, config.policyHash);
    }

    function cardsOf(address owner) external view returns (address[] memory) { return _ownerCards[owner]; }
}
