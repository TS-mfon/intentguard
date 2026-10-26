// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {AgentSpendingCard} from "./AgentSpendingCard.sol";
import {CctpSpendingCardV4} from "./CctpSpendingCardV4.sol";

/// @dev Constructor returns STOP-prefixed data, not callable deployment logic.
/// A fixed creation image is split because one EVM contract cannot hold more than 24,576 runtime bytes.
contract CctpCreationCodeV4 {
    constructor(bytes memory image) {
        assembly ("memory-safe") { return(add(image,32),mload(image)) }
    }
}

/// @notice Creates owner-bound V4 native-USDC cards; source profile and route subset never change.
/// @dev The constructor stores its own compiled creation image in two immutable, hash-pinned code stores.
/// No external deployer or caller-supplied bytecode is accepted. This keeps factory runtime below EIP-170.
contract CctpCardFactoryV4 {
    uint256 public immutable sourceChainId;
    address public immutable creationPrefix;
    address public immutable creationSuffix;
    bytes32 public immutable creationPrefixCodeHash;
    bytes32 public immutable creationSuffixCodeHash;
    uint256 public immutable creationPrefixLength;
    uint256 public immutable creationSuffixLength;
    mapping(address => bool) public isCard;
    mapping(address => address[]) private _ownerCards;
    event CardCreated(address indexed owner, address indexed card, bytes32 indexed policyHash);
    error CreationCodeChanged();

    constructor() {
        if (block.chainid != 196 && block.chainid != 1952) revert CctpSpendingCardV4.UnsupportedAssetOrChain();
        sourceChainId = block.chainid;
        bytes memory image = type(CctpSpendingCardV4).creationCode;
        uint256 split = image.length > 24_000 ? 24_000 : image.length;
        creationPrefixLength = split;
        creationSuffixLength = image.length - split;
        creationPrefix = address(new CctpCreationCodeV4(_chunk(image,0,split)));
        creationSuffix = address(new CctpCreationCodeV4(_chunk(image,split,image.length - split)));
        creationPrefixCodeHash = creationPrefix.codehash;
        creationSuffixCodeHash = creationSuffix.codehash;
    }
    function _chunk(bytes memory image,uint256 offset,uint256 size) private pure returns (bytes memory result) {
        // The first byte is STOP. extcodecopy skips it when reconstructing the creation image.
        result = new bytes(size + 1);
        for (uint256 i; i < size; ++i) result[i + 1] = image[offset + i];
    }

    function createCard(AgentSpendingCard.Config calldata config, uint32[] calldata allowedDomains)
        external returns (address card) {
        if (block.chainid != sourceChainId) revert CctpSpendingCardV4.UnsupportedAssetOrChain();
        if (config.owner != msg.sender) revert AgentSpendingCard.Unauthorized();
        if (creationPrefix.codehash != creationPrefixCodeHash || creationSuffix.codehash != creationSuffixCodeHash)
            revert CreationCodeChanged();
        bytes memory image = new bytes(creationPrefixLength + creationSuffixLength);
        address prefix = creationPrefix;
        address suffix = creationSuffix;
        uint256 prefixLength = creationPrefixLength;
        uint256 suffixLength = creationSuffixLength;
        assembly ("memory-safe") {
            extcodecopy(prefix,add(image,32),1,prefixLength)
            extcodecopy(suffix,add(add(image,32),prefixLength),1,suffixLength)
        }
        bytes memory initCode = bytes.concat(image,abi.encode(config,allowedDomains));
        assembly ("memory-safe") {
            card := create(0,add(initCode,32),mload(initCode))
            if iszero(card) {
                let errorData := mload(0x40)
                returndatacopy(errorData,0,returndatasize())
                revert(errorData,returndatasize())
            }
        }
        isCard[card] = true;
        _ownerCards[msg.sender].push(card);
        emit CardCreated(msg.sender, card, config.policyHash);
    }
    function cardsOf(address owner) external view returns (address[] memory) { return _ownerCards[owner]; }
}
