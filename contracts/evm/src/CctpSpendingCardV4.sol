// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AgentSpendingCard, IERC20Card} from "./AgentSpendingCard.sol";
import {CctpRoutesV4} from "./CctpRoutesV4.sol";

interface ICctpMessengerV4 {
    function localMessageTransmitter() external view returns (address);
    function localMinter() external view returns (address);
    function remoteTokenMessengers(uint32 domain) external view returns (bytes32);
    function getMinFeeAmount(uint256 amount) external view returns (uint256);
    function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient,
        address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) external;
}
interface ICctpTransmitterV4 {
    function localDomain() external view returns (uint32);
    function paused() external view returns (bool);
}
interface ICctpMinterV4 {
    function localTokenMessenger() external view returns (address);
    function paused() external view returns (bool);
}
interface ICctpTokenV4 {
    function decimals() external view returns (uint8);
    function paused() external view returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @notice Versioned native-USDC card with an immutable X Layer source and a fixed owner-selected route subset.
/// @dev The attestor verifies GenLayer testnet finality and destination receipts offchain.
///      A compromised attestor can falsely acknowledge delivery; this is not a foreign-chain light client.
///      Issuer proxy implementation upgrades are an issuer trust boundary: runtime-code pins do not pin proxy storage.
contract CctpSpendingCardV4 is AgentSpendingCard {
    address public immutable SOURCE_USDC;
    address public immutable TOKEN_MESSENGER;
    address public immutable MESSAGE_TRANSMITTER;
    address public immutable TOKEN_MINTER;
    uint256 public immutable sourceChainId;
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

    bytes32 public immutable sourceTokenCodeHash;
    bytes32 public immutable messengerCodeHash;
    bytes32 public immutable transmitterCodeHash;
    bytes32 public immutable minterCodeHash;
    mapping(uint32 => bool) public domainAllowed;
    uint32[] private _domains;
    mapping(bytes32 => BridgeRequest) private _bridges;

    error UnsupportedAssetOrChain();
    error UnsupportedDestination();
    error MessengerChanged();
    error BridgeAmountMismatch();
    error SourceInfrastructureChanged();
    error TransferFeeRequired();
    error NotBridging();

    event BridgeStarted(bytes32 indexed requestId, uint32 indexed destinationDomain, bytes32 indexed routeHash,
        address recipient, uint64 amount, bytes32 decisionHash, bytes32 genLayerTxHash);
    event BridgePaid(bytes32 indexed requestId, bytes32 sourceTxHash, bytes32 destinationTxHash,
        bytes32 messageHash, address recipient, uint64 amount);

    constructor(Config memory c, uint32[] memory domains) AgentSpendingCard(c) {
        if (block.chainid != 196 && block.chainid != 1952) revert UnsupportedAssetOrChain();
        (address usdc, address messenger, address transmitter, address minter) = CctpRoutesV4.source(block.chainid);
        if (c.token != usdc || ICctpTokenV4(c.token).decimals() != 6) revert UnsupportedAssetOrChain();
        sourceChainId = block.chainid;
        SOURCE_USDC = usdc;
        TOKEN_MESSENGER = messenger;
        MESSAGE_TRANSMITTER = transmitter;
        TOKEN_MINTER = minter;
        sourceTokenCodeHash = usdc.codehash;
        messengerCodeHash = messenger.codehash;
        transmitterCodeHash = transmitter.codehash;
        minterCodeHash = minter.codehash;
        _checkSource();
        if (domains.length == 0 || domains.length > 11) revert UnsupportedDestination();
        for (uint256 i; i < domains.length; ++i) {
            uint32 domain = domains[i];
            CctpRoutesV4.destination(sourceChainId, domain);
            if (domainAllowed[domain]) revert UnsupportedDestination();
            if (domain != SOURCE_DOMAIN) _checkRemote(domain);
            domainAllowed[domain] = true;
            _domains.push(domain);
        }
    }

    function allowedDomains() external view returns (uint32[] memory) { return _domains; }
    function destinationToken(uint32 domain) public view returns (address result) {
        (, result) = CctpRoutesV4.destination(sourceChainId, domain);
    }
    function destinationChainId(uint32 domain) public view returns (uint256 result) {
        (result,) = CctpRoutesV4.destination(sourceChainId, domain);
    }
    function getBridgeRequest(bytes32 id) external view returns (BridgeRequest memory) { return _bridges[id]; }

    // The EIP-712 domain binds this route to the immutable card and execution chain.
    function routeCommitment(uint32 domain, address recipient, uint64 amount) public pure returns (bytes32) {
        return keccak256(abi.encode(domain, bytes32(uint256(uint160(recipient))), amount, MAX_FEE, MIN_FINALITY, bytes32(0)));
    }

    function reserve(bytes32 id, bytes32 requestHash, bytes32 evidenceHash, bytes32 invoiceKey,
        address recipient, uint64 amount, uint64 expiresAt) external override nonReentrant {
        _checkChain();
        if (!domainAllowed[SOURCE_DOMAIN]) revert UnsupportedDestination();
        _reserve(id, requestHash, evidenceHash, invoiceKey, recipient, amount, expiresAt);
    }

    function reserveBridge(bytes32 id, bytes32 requestHash, bytes32 evidenceHash, bytes32 invoiceKey,
        address recipient, uint64 amount, uint64 expiresAt, uint32 destinationDomain) external nonReentrant {
        _checkChain();
        if (destinationDomain == SOURCE_DOMAIN || !domainAllowed[destinationDomain]) revert UnsupportedDestination();
        _reserve(id, requestHash, evidenceHash, invoiceKey, recipient, amount, expiresAt);
        _bridges[id] = BridgeRequest(destinationDomain, routeCommitment(destinationDomain, recipient, amount),
            bytes32(0), bytes32(0), bytes32(0));
    }

    function domainSeparator() public view override returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("IntentGuard"), keccak256("4"), block.chainid, address(this)));
    }

    function releaseDigest(bytes32 id, uint64 attestationValidUntil, bytes32 decisionHash, bytes32 genLayerTxHash)
        public view override returns (bytes32) {
        BridgeRequest storage b = _bridges[id];
        if (b.routeHash == bytes32(0)) return super.releaseDigest(id, attestationValidUntil, decisionHash, genLayerTxHash);
        Request storage r = _requests[id];
        bytes32 structHash = keccak256(abi.encode(BRIDGE_RELEASE_TYPEHASH, id, r.requestHash, policyHash,
            r.evidenceHash, decisionHash, genLayerTxHash, attestationValidUntil, b.routeHash));
        return keccak256(abi.encodePacked(hex"1901", domainSeparator(), structHash));
    }

    function _deliver(bytes32 id, Request storage r, bytes32 decisionHash, bytes32 genLayerTxHash) internal override {
        _checkChain();
        if (token.codehash != sourceTokenCodeHash || ICctpTokenV4(token).decimals() != 6
            || ICctpTokenV4(token).paused()) revert SourceInfrastructureChanged();
        BridgeRequest storage b = _bridges[id];
        if (b.routeHash == bytes32(0)) {
            // A successful ERC20 return alone cannot prove an exact payment.
            uint256 localBefore = IERC20Card(token).balanceOf(address(this));
            uint256 recipientBefore = IERC20Card(token).balanceOf(r.recipient);
            _transfer(r.recipient, r.amount);
            uint256 localAfter = IERC20Card(token).balanceOf(address(this));
            uint256 recipientAfter = IERC20Card(token).balanceOf(r.recipient);
            if (localAfter > localBefore || localBefore - localAfter != r.amount
                || recipientAfter < recipientBefore || recipientAfter - recipientBefore != r.amount) revert BridgeAmountMismatch();
            emit Paid(id, decisionHash, genLayerTxHash, r.recipient, r.amount);
            return;
        }
        _checkSource();
        if (!domainAllowed[b.destinationDomain]
            || b.routeHash != routeCommitment(b.destinationDomain, r.recipient, r.amount)) revert UnsupportedDestination();
        _checkRemote(b.destinationDomain);
        if (ICctpMessengerV4(TOKEN_MESSENGER).getMinFeeAmount(r.amount) != 0) revert TransferFeeRequired();
        // No caller-selected asset, contract, calldata, hook, destination caller, fee, or recipient reaches CCTP.
        // MAX_FEE=0 also makes any nonzero fee required by the issuer fail atomically.
        r.status = Status.BRIDGING;
        uint256 beforeBalance = IERC20Card(token).balanceOf(address(this));
        _approve(0);
        _approve(r.amount);
        ICctpMessengerV4(TOKEN_MESSENGER).depositForBurn(r.amount, b.destinationDomain,
            bytes32(uint256(uint160(r.recipient))), token, bytes32(0), MAX_FEE, MIN_FINALITY);
        _approve(0);
        uint256 afterBalance = IERC20Card(token).balanceOf(address(this));
        if (afterBalance > beforeBalance || beforeBalance - afterBalance != r.amount) revert BridgeAmountMismatch();
        emit BridgeStarted(id, b.destinationDomain, b.routeHash, r.recipient, r.amount, decisionHash, genLayerTxHash);
    }

    function _checkChain() private view {
        if (block.chainid != sourceChainId) revert UnsupportedAssetOrChain();
    }
    function _checkSource() private view {
        _checkChain();
        if (TOKEN_MESSENGER.code.length == 0 || MESSAGE_TRANSMITTER.code.length == 0 || TOKEN_MINTER.code.length == 0
            || TOKEN_MESSENGER.codehash != messengerCodeHash) revert MessengerChanged();
        if (MESSAGE_TRANSMITTER.codehash != transmitterCodeHash || TOKEN_MINTER.codehash != minterCodeHash
            || ICctpMessengerV4(TOKEN_MESSENGER).localMessageTransmitter() != MESSAGE_TRANSMITTER
            || ICctpMessengerV4(TOKEN_MESSENGER).localMinter() != TOKEN_MINTER
            || ICctpMinterV4(TOKEN_MINTER).localTokenMessenger() != TOKEN_MESSENGER
            || ICctpTransmitterV4(MESSAGE_TRANSMITTER).localDomain() != SOURCE_DOMAIN
            || ICctpTransmitterV4(MESSAGE_TRANSMITTER).paused()
            || ICctpMinterV4(TOKEN_MINTER).paused()) revert SourceInfrastructureChanged();
    }
    function _checkRemote(uint32 domain) private view {
        if (ICctpMessengerV4(TOKEN_MESSENGER).remoteTokenMessengers(domain)
            != bytes32(uint256(uint160(TOKEN_MESSENGER)))) revert UnsupportedDestination();
    }
    function _approve(uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(ICctpTokenV4.approve, (TOKEN_MESSENGER, amount)));
        if (!ok || (data.length != 0 && (data.length != 32 || !abi.decode(data, (bool))))) revert TokenTransferFailed();
    }

    function bridgeReceiptDigest(bytes32 id, bytes32 sourceTxHash, bytes32 destinationTxHash, bytes32 messageHash)
        public view returns (bytes32) {
        Request storage r = _requests[id];
        bytes32 structHash = keccak256(abi.encode(BRIDGE_RECEIPT_TYPEHASH, id, r.requestHash, _bridges[id].routeHash,
            sourceTxHash, destinationTxHash, messageHash, r.amount));
        return keccak256(abi.encodePacked(hex"1901", domainSeparator(), structHash));
    }

    /// @notice Acknowledges an already-burned request even after policy expiry or owner revocation. No funds move.
    /// @dev The configured attestor remains responsible for authenticating the foreign receipt.
    function confirmBridge(bytes32 id, bytes32 sourceTxHash, bytes32 destinationTxHash, bytes32 messageHash,
        bytes calldata signature) external nonReentrant {
        _checkChain();
        Request storage r = _requests[id];
        BridgeRequest storage b = _bridges[id];
        if (r.status != Status.BRIDGING || b.routeHash == bytes32(0)) revert NotBridging();
        if (sourceTxHash == bytes32(0) || destinationTxHash == bytes32(0) || messageHash == bytes32(0)) revert InvalidRequest();
        if (_recover(bridgeReceiptDigest(id, sourceTxHash, destinationTxHash, messageHash), signature) != attestor)
            revert InvalidSignature();
        b.sourceTxHash = sourceTxHash;
        b.destinationTxHash = destinationTxHash;
        b.messageHash = messageHash;
        r.status = Status.PAID;
        emit BridgePaid(id, sourceTxHash, destinationTxHash, messageHash, r.recipient, r.amount);
    }
}
