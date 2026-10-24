// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {AgentSpendingCard} from "./AgentSpendingCard.sol";

contract CardFactory {
    mapping(address => bool) public isCard;
    mapping(address => address[]) private _ownerCards;
    event CardCreated(address indexed owner, address indexed card, bytes32 indexed policyHash);

    function createCard(AgentSpendingCard.Config calldata config) external returns (address card) {
        if (config.owner != msg.sender) revert AgentSpendingCard.Unauthorized();
        card = address(new AgentSpendingCard(config)); isCard[card] = true;
        _ownerCards[msg.sender].push(card);
        emit CardCreated(msg.sender, card, config.policyHash);
    }
    function cardsOf(address owner) external view returns (address[] memory) { return _ownerCards[owner]; }
}
