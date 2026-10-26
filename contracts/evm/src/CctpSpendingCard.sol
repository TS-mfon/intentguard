// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AgentSpendingCard, IERC20Card} from "./AgentSpendingCard.sol";

interface ICctpTokenMessenger {
    function localMessageTransmitter() external view returns (address);
    function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient,
        address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) external;
}
interface ICctpMessageTransmitter { function localDomain() external view returns (uint32); }
interface ICctpUSDC {
    function decimals() external view returns (uint8);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @notice Testnet-only issuer USDC vault. Source release is irreversible; PAID requires an attested destination receipt.
/// @dev The attestor verifies GenLayer consensus and foreign-chain receipts offchain. This is not a trustless light client.
contract CctpSpendingCard is AgentSpendingCard {
    address public constant SOURCE_USDC = 0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3;
    address public constant TOKEN_MESSENGER = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    address public constant MESSAGE_TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;
    uint32 public constant SOURCE_DOMAIN = 37;
    uint32 public constant MIN_FINALITY = 2000;
    uint256 public constant MAX_FEE = 0;

    bytes32 public constant BRIDGE_RELEASE_TYPEHASH = keccak256(
        "BridgeRelease(bytes32 requestId,bytes32 requestHash,bytes32 policyHash,bytes32 evidenceHash,bytes32 decisionHash,bytes32 genLayerTxHash,uint64 validUntil,bytes32 routeHash)"
    );
    bytes32 public constant BRIDGE_RECEIPT_TYPEHASH = keccak256(
        "BridgeReceipt(bytes32 requestId,bytes32 requestHash,bytes32 routeHash,bytes32 sourceTxHash,bytes32 destinationTxHash,bytes32 messageHash,uint64 amount)"
    );

    struct BridgeRequest {
        uint32 destinationDomain;
        bytes32 routeHash;
        bytes32 sourceTxHash;
        bytes32 destinationTxHash;
        bytes32 messageHash;
    }

    bytes32 public immutable messengerCodeHash;
    mapping(uint32 => bool) public domainAllowed;
    uint32[] private _domains;
    mapping(bytes32 => BridgeRequest) private _bridges;

    error UnsupportedAssetOrChain();
    error UnsupportedDestination();
    error MessengerChanged();
    error BridgeAmountMismatch();
    error NotBridging();

    event BridgeStarted(bytes32 indexed requestId, uint32 indexed destinationDomain, bytes32 indexed routeHash,
        address recipient, uint64 amount, bytes32 decisionHash, bytes32 genLayerTxHash);
    event BridgePaid(bytes32 indexed requestId, bytes32 sourceTxHash, bytes32 destinationTxHash,
        bytes32 messageHash, address recipient, uint64 amount);

    constructor(Config memory c, uint32[] memory domains) AgentSpendingCard(c) {
        if (block.chainid != 1952 || c.token != SOURCE_USDC || ICctpUSDC(c.token).decimals() != 6
            || TOKEN_MESSENGER.code.length == 0 || MESSAGE_TRANSMITTER.code.length == 0
            || ICctpTokenMessenger(TOKEN_MESSENGER).localMessageTransmitter() != MESSAGE_TRANSMITTER
            || ICctpMessageTransmitter(MESSAGE_TRANSMITTER).localDomain() != SOURCE_DOMAIN)
            revert UnsupportedAssetOrChain();
        if (domains.length == 0 || domains.length > 3) revert UnsupportedDestination();
        for (uint256 i; i < domains.length; ++i) {
            uint32 domain = domains[i];
            if ((domain != SOURCE_DOMAIN && domain != 3 && domain != 6) || domainAllowed[domain])
                revert UnsupportedDestination();
            domainAllowed[domain] = true;
            _domains.push(domain);
        }
        messengerCodeHash = TOKEN_MESSENGER.codehash;
    }

    function allowedDomains() external view returns (uint32[] memory) { return _domains; }

    function destinationToken(uint32 domain) public pure returns (address) {
        if (domain == 37) return SOURCE_USDC;
        if (domain == 6) return 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
        if (domain == 3) return 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
        revert UnsupportedDestination();
    }

    function getBridgeRequest(bytes32 id) external view returns (BridgeRequest memory) { return _bridges[id]; }

    function routeCommitment(uint32 domain, address recipient, uint64 amount) public pure returns (bytes32) {
        return keccak256(abi.encode(domain, bytes32(uint256(uint160(recipient))), amount, MAX_FEE, MIN_FINALITY, bytes32(0)));
    }

    function reserve(bytes32 id, bytes32 requestHash, bytes32 evidenceHash, bytes32 invoiceKey,
        address recipient, uint64 amount, uint64 expiresAt) external override nonReentrant {
        if (!domainAllowed[SOURCE_DOMAIN]) revert UnsupportedDestination();
        _reserve(id, requestHash, evidenceHash, invoiceKey, recipient, amount, expiresAt);
    }

    function reserveBridge(bytes32 id, bytes32 requestHash, bytes32 evidenceHash, bytes32 invoiceKey,
        address recipient, uint64 amount, uint64 expiresAt, uint32 destinationDomain) external nonReentrant {
        if ((destinationDomain != 3 && destinationDomain != 6) || !domainAllowed[destinationDomain])
            revert UnsupportedDestination();
        _reserve(id, requestHash, evidenceHash, invoiceKey, recipient, amount, expiresAt);
        _bridges[id] = BridgeRequest(destinationDomain, routeCommitment(destinationDomain, recipient, amount),
            bytes32(0), bytes32(0), bytes32(0));
    }

    function domainSeparator() public view override returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("IntentGuard"), keccak256("2"), block.chainid, address(this)));
    }

    function releaseDigest(bytes32 id, uint64 attestationValidUntil, bytes32 decisionHash, bytes32 genLayerTxHash)
        public view override returns (bytes32) {
        BridgeRequest storage b = _bridges[id];
        if (b.routeHash == bytes32(0)) return super.releaseDigest(id, attestationValidUntil, decisionHash, genLayerTxHash);
        Request storage r = _requests[id];
        bytes32 structHash = keccak256(abi.encode(BRIDGE_RELEASE_TYPEHASH, id, r.requestHash, policyHash,
            r.evidenceHash, decisionHash, genLayerTxHash, attestationValidUntil, b.routeHash));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _deliver(bytes32 id, Request storage r, bytes32 decisionHash, bytes32 genLayerTxHash) internal override {
        BridgeRequest storage b = _bridges[id];
        if (b.routeHash == bytes32(0)) {
            super._deliver(id, r, decisionHash, genLayerTxHash);
            return;
        }
        if (TOKEN_MESSENGER.codehash != messengerCodeHash) revert MessengerChanged();
        if (!domainAllowed[b.destinationDomain]
            || b.routeHash != routeCommitment(b.destinationDomain, r.recipient, r.amount)) revert UnsupportedDestination();
        // CCTP standard transfer has a zero maximum token fee. If the issuer requires a fee, the burn reverts.
        // No caller-supplied contract, calldata, hook, destination caller, fee or recipient reaches CCTP.
        r.status = Status.BRIDGING;
        uint256 beforeBalance = IERC20Card(token).balanceOf(address(this));
        _approve(0);
        _approve(r.amount);
        ICctpTokenMessenger(TOKEN_MESSENGER).depositForBurn(r.amount, b.destinationDomain,
            bytes32(uint256(uint160(r.recipient))), token, bytes32(0), MAX_FEE, MIN_FINALITY);
        _approve(0);
        uint256 afterBalance = IERC20Card(token).balanceOf(address(this));
        if (afterBalance > beforeBalance || beforeBalance - afterBalance != r.amount) revert BridgeAmountMismatch();
        emit BridgeStarted(id, b.destinationDomain, b.routeHash, r.recipient, r.amount, decisionHash, genLayerTxHash);
    }

    function _approve(uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(ICctpUSDC.approve, (TOKEN_MESSENGER, amount)));
        if (!ok || (data.length != 0 && (data.length != 32 || !abi.decode(data, (bool))))) revert TokenTransferFailed();
    }

    function bridgeReceiptDigest(bytes32 id, bytes32 sourceTxHash, bytes32 destinationTxHash, bytes32 messageHash)
        public view returns (bytes32) {
        Request storage r = _requests[id];
        bytes32 structHash = keccak256(abi.encode(BRIDGE_RECEIPT_TYPEHASH, id, r.requestHash, _bridges[id].routeHash,
            sourceTxHash, destinationTxHash, messageHash, r.amount));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    /// @notice Records a verified mint even after owner revocation or policy expiry: the source funds were already burnt.
    /// @dev No funds move here. Foreign-chain receipt authenticity relies on the configured attestor.
    function confirmBridge(bytes32 id, bytes32 sourceTxHash, bytes32 destinationTxHash, bytes32 messageHash,
        bytes calldata signature) external nonReentrant {
        Request storage r = _requests[id];
        BridgeRequest storage b = _bridges[id];
        if (r.status != Status.BRIDGING || b.routeHash == bytes32(0)) revert NotBridging();
        if (sourceTxHash == bytes32(0) || destinationTxHash == bytes32(0) || messageHash == bytes32(0))
            revert InvalidRequest();
        if (_recover(bridgeReceiptDigest(id, sourceTxHash, destinationTxHash, messageHash), signature) != attestor)
            revert InvalidSignature();
        b.sourceTxHash = sourceTxHash;
        b.destinationTxHash = destinationTxHash;
        b.messageHash = messageHash;
        r.status = Status.PAID;
        emit BridgePaid(id, sourceTxHash, destinationTxHash, messageHash, r.recipient, r.amount);
    }
}
