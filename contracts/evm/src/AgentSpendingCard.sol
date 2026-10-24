// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ICPU} from "./vendor/interfaces/ICPU.sol";

interface IERC20Card {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}
interface IProcessorBeacon { function implementation() external view returns (address); }

/// @notice One immutable, owner-funded agent mandate. No agent spending key controls owner assets.
contract AgentSpendingCard {
    struct Config {
        address owner;
        address gateway;
        address attestor;
        address token;
        address processor;
        uint256 circuitId;
        address beacon;
        address expectedImplementation;
        bytes32 expectedNetlistHash;
        bytes32 policyHash;
        uint64 totalLimit;
        uint64 perPaymentLimit;
        uint64 periodLimit;
        uint64 periodSeconds;
        uint64 validFrom;
        uint64 validUntil;
        address[] allowedRecipients;
    }
    enum Status { NONE, RESERVED, PAID, CANCELLED, EXPIRED }
    struct Request {
        bytes32 requestHash;
        bytes32 evidenceHash;
        bytes32 invoiceKey;
        address recipient;
        uint64 amount;
        uint64 expiresAt;
        uint64 periodId;
        Status status;
    }
    struct PeriodLedger { uint64 spent; uint64 reserved; }

    address public immutable owner;
    address public immutable gateway;
    address public immutable attestor;
    address public immutable token;
    address public immutable processor;
    uint256 public immutable circuitId;
    address public immutable beacon;
    address public immutable expectedImplementation;
    bytes32 public immutable expectedNetlistHash;
    bytes32 public immutable policyHash;
    bytes32 public immutable processorCodeHash;
    bytes32 public immutable implementationCodeHash;
    uint64 public immutable totalLimit;
    uint64 public immutable perPaymentLimit;
    uint64 public immutable periodLimit;
    uint64 public immutable periodSeconds;
    uint64 public immutable validFrom;
    uint64 public immutable validUntil;

    bool public enabled = true;
    bool public revoked;
    uint8 public pendingCount;
    uint64 public totalSpent;
    uint64 public totalReserved;
    mapping(address => bool) public recipientAllowed;
    address[] private _recipients;
    mapping(bytes32 => Request) private _requests;
    mapping(bytes32 => bytes32) public invoiceRequest;
    mapping(uint64 => PeriodLedger) public periods;
    uint256 private _entered;

    bytes32 public constant RELEASE_TYPEHASH = keccak256(
        "Release(bytes32 requestId,bytes32 requestHash,bytes32 policyHash,bytes32 evidenceHash,bytes32 decisionHash,bytes32 genLayerTxHash,uint64 validUntil)"
    );
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    uint256 private constant HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    error Unauthorized();
    error InvalidConfig();
    error Disabled();
    error InvalidRequest();
    error AlreadyUsed();
    error TooManyPending();
    error NotReserved();
    error NotExpired();
    error Expired();
    error PolicyViolation(uint8 failures);
    error ProcessorChanged();
    error InvalidSignature();
    error InsufficientAvailable();
    error TokenTransferFailed();
    error Reentrant();

    event Reserved(bytes32 indexed requestId, bytes32 indexed requestHash, bytes32 evidenceHash,
        bytes32 invoiceKey, address recipient, uint64 amount, uint64 expiresAt, uint64 periodId);
    event Paid(bytes32 indexed requestId, bytes32 decisionHash, bytes32 genLayerTxHash, address recipient, uint64 amount);
    event Cancelled(bytes32 indexed requestId);
    event RequestExpired(bytes32 indexed requestId);
    event EnabledChanged(bool enabled);
    event Revoked();
    event Withdrawn(address indexed owner, uint256 amount);

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }
    modifier nonReentrant() {
        if (_entered != 0) revert Reentrant();
        _entered = 1; _; _entered = 0;
    }

    constructor(Config memory c) {
        if (c.owner == address(0) || c.gateway == address(0) || c.attestor == address(0)
            || c.token.code.length == 0 || c.processor.code.length == 0 || c.beacon.code.length == 0
            || c.expectedImplementation.code.length == 0 || c.policyHash == bytes32(0)
            || c.expectedNetlistHash == bytes32(0) || c.totalLimit == 0 || c.perPaymentLimit == 0
            || c.periodLimit == 0 || c.perPaymentLimit > c.totalLimit
            || c.periodSeconds == 0 || c.validUntil <= c.validFrom || c.validUntil <= block.timestamp
            || c.allowedRecipients.length == 0 || c.allowedRecipients.length > 64) revert InvalidConfig();
        owner = c.owner; gateway = c.gateway; attestor = c.attestor; token = c.token;
        processor = c.processor; circuitId = c.circuitId; beacon = c.beacon;
        expectedImplementation = c.expectedImplementation; expectedNetlistHash = c.expectedNetlistHash;
        policyHash = c.policyHash; totalLimit = c.totalLimit; perPaymentLimit = c.perPaymentLimit;
        periodLimit = c.periodLimit; periodSeconds = c.periodSeconds; validFrom = c.validFrom;
        validUntil = c.validUntil; processorCodeHash = c.processor.codehash;
        implementationCodeHash = c.expectedImplementation.codehash;
        for (uint256 i; i < c.allowedRecipients.length; ++i) {
            address recipient = c.allowedRecipients[i];
            if (recipient == address(0) || recipient == address(this) || recipientAllowed[recipient]) revert InvalidConfig();
            recipientAllowed[recipient] = true; _recipients.push(recipient);
        }
        _checkProcessor();
    }

    function config() external view returns (Config memory c) {
        c = Config(owner, gateway, attestor, token, processor, circuitId, beacon, expectedImplementation,
            expectedNetlistHash, policyHash, totalLimit, perPaymentLimit, periodLimit, periodSeconds,
            validFrom, validUntil, _recipients);
    }
    function getRequest(bytes32 id) external view returns (Request memory) { return _requests[id]; }
    function allowedRecipients() external view returns (address[] memory) { return _recipients; }
    function currentPeriod() public view returns (uint64) {
        if (block.timestamp < validFrom) return 0;
        return uint64((block.timestamp - validFrom) / periodSeconds);
    }
    function availableBalance() public view returns (uint256) {
        uint256 balance = IERC20Card(token).balanceOf(address(this));
        return balance > totalReserved ? balance - totalReserved : 0;
    }
    function ledger() external view returns (uint256 funded, uint64 spent, uint64 reserved,
        uint256 available, uint64 periodSpent, uint64 periodReserved) {
        funded = IERC20Card(token).balanceOf(address(this)); spent = totalSpent; reserved = totalReserved;
        available = funded > reserved ? funded - reserved : 0;
        PeriodLedger storage p = periods[currentPeriod()]; periodSpent = p.spent; periodReserved = p.reserved;
    }

    function preview(address recipient, uint64 amount, uint64 expiresAt) external view returns (bool allow, uint8 failures) {
        return _evaluate(recipient, amount, expiresAt, currentPeriod(), 0);
    }

    function reserve(bytes32 id, bytes32 requestHash, bytes32 evidenceHash, bytes32 invoiceKey,
        address recipient, uint64 amount, uint64 expiresAt) external nonReentrant {
        if (msg.sender != gateway) revert Unauthorized();
        if (!enabled || revoked) revert Disabled();
        if (id == bytes32(0) || requestHash == bytes32(0) || evidenceHash == bytes32(0)
            || invoiceKey == bytes32(0) || amount == 0 || recipient == address(0)) revert InvalidRequest();
        if (_requests[id].status != Status.NONE || invoiceRequest[invoiceKey] != bytes32(0)) revert AlreadyUsed();
        if (pendingCount >= 2) revert TooManyPending();
        uint64 period = currentPeriod();
        (bool allow, uint8 failures) = _evaluate(recipient, amount, expiresAt, period, 0);
        if (!allow) revert PolicyViolation(failures);
        // Ledger arithmetic remains checked independently of the external processor.
        if (uint256(totalSpent) + totalReserved + amount > totalLimit
            || uint256(periods[period].spent) + periods[period].reserved + amount > periodLimit
            || amount > perPaymentLimit || amount > availableBalance()) revert InsufficientAvailable();
        _requests[id] = Request(requestHash, evidenceHash, invoiceKey, recipient, amount, expiresAt, period, Status.RESERVED);
        invoiceRequest[invoiceKey] = id; ++pendingCount;
        totalReserved += amount; periods[period].reserved += amount;
        emit Reserved(id, requestHash, evidenceHash, invoiceKey, recipient, amount, expiresAt, period);
    }

    function settle(bytes32 id, uint64 attestationValidUntil, bytes32 decisionHash, bytes32 genLayerTxHash,
        bytes calldata signature) external nonReentrant {
        Request storage r = _requests[id];
        if (r.status != Status.RESERVED) revert NotReserved();
        if (!enabled || revoked) revert Disabled();
        if (block.timestamp >= r.expiresAt || block.timestamp >= attestationValidUntil
            || attestationValidUntil > r.expiresAt) revert Expired();
        if (decisionHash == bytes32(0) || genLayerTxHash == bytes32(0)) revert InvalidRequest();
        if (_recover(releaseDigest(id, attestationValidUntil, decisionHash, genLayerTxHash), signature) != attestor)
            revert InvalidSignature();
        (bool allow, uint8 failures) = _evaluate(r.recipient, r.amount, r.expiresAt, r.periodId, r.amount);
        if (!allow) revert PolicyViolation(failures);
        if (uint256(totalSpent) + totalReserved > totalLimit
            || uint256(periods[r.periodId].spent) + periods[r.periodId].reserved > periodLimit
            || IERC20Card(token).balanceOf(address(this)) < totalReserved) revert InsufficientAvailable();
        r.status = Status.PAID;
        _release(r); totalSpent += r.amount; periods[r.periodId].spent += r.amount;
        // Keep paid invoiceRequest forever; cancellation and expiry alone free an invoice.
        _transfer(r.recipient, r.amount);
        emit Paid(id, decisionHash, genLayerTxHash, r.recipient, r.amount);
    }

    function cancel(bytes32 id) external nonReentrant {
        if (msg.sender != owner && msg.sender != gateway) revert Unauthorized();
        Request storage r = _requests[id]; if (r.status != Status.RESERVED) revert NotReserved();
        r.status = Status.CANCELLED; _release(r); delete invoiceRequest[r.invoiceKey];
        emit Cancelled(id);
    }
    function expire(bytes32 id) external nonReentrant {
        Request storage r = _requests[id]; if (r.status != Status.RESERVED) revert NotReserved();
        if (block.timestamp < r.expiresAt) revert NotExpired();
        r.status = Status.EXPIRED; _release(r); delete invoiceRequest[r.invoiceKey];
        emit RequestExpired(id);
    }
    function setEnabled(bool value) external onlyOwner {
        if (revoked && value) revert Disabled();
        enabled = value; emit EnabledChanged(value);
    }
    function revoke() external onlyOwner { revoked = true; enabled = false; emit Revoked(); }
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        if (amount > availableBalance()) revert InsufficientAvailable();
        _transfer(owner, amount); emit Withdrawn(owner, amount);
    }
    function _release(Request storage r) private {
        --pendingCount; totalReserved -= r.amount; periods[r.periodId].reserved -= r.amount;
    }
    function _transfer(address recipient, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20Card.transfer, (recipient, amount)));
        if (!ok || (data.length != 0 && (data.length != 32 || !abi.decode(data, (bool))))) revert TokenTransferFailed();
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("IntentGuard"), keccak256("1"), block.chainid, address(this)));
    }
    function releaseDigest(bytes32 id, uint64 attestationValidUntil, bytes32 decisionHash, bytes32 genLayerTxHash)
        public view returns (bytes32) {
        Request storage r = _requests[id];
        bytes32 structHash = keccak256(abi.encode(RELEASE_TYPEHASH, id, r.requestHash, policyHash,
            r.evidenceHash, decisionHash, genLayerTxHash, attestationValidUntil));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }
    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64))) }
        if (uint256(s) > HALF_ORDER || (v != 27 && v != 28)) revert InvalidSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }

    function _checkProcessor() private view {
        if (processor.codehash != processorCodeHash || expectedImplementation.codehash != implementationCodeHash
            || IProcessorBeacon(beacon).implementation() != expectedImplementation
            || sha256(ICPU(processor).netlist(circuitId)) != expectedNetlistHash) revert ProcessorChanged();
        (uint32 nIn, uint32 nOut, uint32 nState,) = ICPU(processor).circuitInfo(circuitId);
        if (nIn != 451 || nOut != 8 || nState != 0) revert ProcessorChanged();
    }
    function _evaluate(address recipient, uint64 amount, uint64 expiresAt, uint64 period, uint64 excluded)
        private view returns (bool allow, uint8 failures) {
        _checkProcessor();
        uint256 committedTotal = uint256(totalSpent) + totalReserved - excluded;
        uint256 committedPeriod = uint256(periods[period].spent) + periods[period].reserved - excluded;
        uint64 remainingTotal = committedTotal < totalLimit ? uint64(totalLimit - committedTotal) : 0;
        uint64 remainingPeriod = committedPeriod < periodLimit ? uint64(periodLimit - committedPeriod) : 0;
        uint256 balance = IERC20Card(token).balanceOf(address(this));
        uint256 reservedOther = uint256(totalReserved) - excluded;
        uint256 fundedLeft = balance > reservedOther ? balance - reservedOther : 0;
        if (fundedLeft < remainingTotal) remainingTotal = uint64(fundedLeft);
        bytes memory inputs = new bytes(57);
        uint64[7] memory fields = [amount, perPaymentLimit, remainingTotal, remainingPeriod,
            validFrom, uint64(block.timestamp), validUntil];
        for (uint256 f; f < 7; ++f) {
            for (uint256 b; b < 8; ++b) inputs[f * 8 + b] = bytes1(uint8(fields[f] >> (b * 8)));
        }
        inputs[56] = bytes1(uint8((recipientAllowed[recipient] ? 1 : 0) | 2 | ((enabled && !revoked) ? 4 : 0)));
        bytes memory result = ICPU(processor).eval(circuitId, inputs);
        if (result.length != 1) revert ProcessorChanged();
        uint8 bits = uint8(result[0]); failures = bits >> 1;
        if (((bits & 1) != 0) != (failures == 0)) revert ProcessorChanged();
        // Expiry is not a circuit input; lifetime is independently compared inside the circuit.
        if (expiresAt <= block.timestamp || expiresAt > validUntil || amount == 0 || block.timestamp > type(uint64).max)
            failures |= 8;
        allow = (bits & 1) != 0 && failures == 0;
    }
}
