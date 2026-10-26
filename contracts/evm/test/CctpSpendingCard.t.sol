// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AgentSpendingCard} from "../src/AgentSpendingCard.sol";
import {CctpSpendingCard} from "../src/CctpSpendingCard.sol";
import {CctpCardFactory} from "../src/CctpCardFactory.sol";
import {LocalNandProcessor} from "../src/LocalNandProcessor.sol";
import {Vm, MutableBeacon, FaultProcessor} from "./AgentSpendingCard.t.sol";

interface VmBridge is Vm {
    struct Log { bytes32[] topics; bytes data; address emitter; }
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

/// @dev Test-only issuer and messenger doubles; never deployed or exposed as real stablecoins.
contract CctpTokenDouble {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public failApprove;
    bool public noReturn;
    function decimals() external pure returns (uint8) { return 6; }
    function mint(address to, uint256 value) external { balanceOf[to] += value; }
    function setApprovalFailure(bool fail) external { failApprove = fail; }
    function setNoReturn(bool value) external { noReturn = value; }
    function approve(address to, uint256 value) external returns (bool) {
        if (failApprove) return false;
        allowance[msg.sender][to] = value;
        if (noReturn) assembly { return(0, 0) }
        return true;
    }
    function transfer(address to, uint256 value) external returns (bool) {
        balanceOf[msg.sender] -= value; balanceOf[to] += value; return true;
    }
    function burnFrom(address from, uint256 value) external {
        allowance[from][msg.sender] -= value; balanceOf[from] -= value;
    }
}
contract CctpTransmitterDouble {
    function localDomain() external pure returns (uint32) { return 37; }
}
contract CctpMessengerDouble {
    address private constant TOKEN = 0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3;
    address private constant TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;
    uint32 public lastDomain;
    bytes32 public lastRecipient;
    uint256 public lastAmount;
    bool public failBurn;
    bool public incorrectDebit;
    bool public callbackSucceeded;
    bool public callbackAttempted;
    bytes public callback;
    function localMessageTransmitter() external pure returns (address) { return TRANSMITTER; }
    function setFail(bool value) external { failBurn = value; }
    function setIncorrectDebit(bool value) external { incorrectDebit = value; }
    function setCallback(bytes calldata value) external { callback = value; }
    function depositForBurn(uint256 amount, uint32 domain, bytes32 recipient, address token,
        bytes32 caller, uint256 maxFee, uint32 threshold) external {
        require(!failBurn, "test issuer burn failure");
        require(token == TOKEN && caller == bytes32(0) && maxFee == 0 && threshold == 2000, "CCTP binding");
        require(domain == 3 || domain == 6, "CCTP domain");
        lastDomain = domain; lastRecipient = recipient; lastAmount = amount;
        CctpTokenDouble(TOKEN).burnFrom(msg.sender, incorrectDebit ? amount - 1 : amount);
        if (callback.length != 0) {
            callbackAttempted = true;
            (callbackSucceeded,) = msg.sender.call(callback);
        }
    }
}

contract CctpSpendingCardTest {
    VmBridge private constant vm = VmBridge(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SIGNER = 0x1001;
    address private constant OWNER = address(0xa11ce);
    address private constant GATEWAY = address(0x600d);
    address private constant MERCHANT = address(0xbeef);
    address private constant OUTSIDER = address(0xbad);
    address private constant USDC = 0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3;
    address private constant MESSENGER = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    address private constant TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;
    uint64 private constant UNIT = 1_000_000;
    bytes32 private constant RH = keccak256("canonical source and destination request");
    bytes32 private constant EH = keccak256("immutable invoice");
    bytes32 private constant POLICY = keccak256("owner policy");
    bytes32 private constant DECISION = keccak256("all GenLayer criteria passed");
    bytes32 private constant GL_TX = keccak256("GenLayer successful finalized transaction");
    bytes32 private constant SOURCE_TX = keccak256("verified source burn transaction");
    bytes32 private constant DEST_TX = keccak256("verified destination mint transaction");
    bytes32 private constant MESSAGE = keccak256("bound Circle CCTP message");
    CctpSpendingCard private card;
    CctpCardFactory private factory;
    CctpTokenDouble private token;
    CctpMessengerDouble private messenger;
    FaultProcessor private cpu;
    MutableBeacon private beacon;
    bytes private nl;

    function eq(uint256 a, uint256 b) private pure { require(a == b, "uint equality"); }
    function eq(bytes32 a, bytes32 b) private pure { require(a == b, "hash equality"); }
    function yes(bool value) private pure { require(value, "expected true"); }

    function setUp() public {
        vm.chainId(1952); vm.warp(1000);
        nl = vm.readFileBinary(string.concat(vm.projectRoot(), "/../../circuits/artifacts/policy.netlist.bin"));
        LocalNandProcessor oracle = new LocalNandProcessor(nl);
        cpu = new FaultProcessor(oracle); beacon = new MutableBeacon(address(cpu));
        vm.etch(USDC, address(new CctpTokenDouble()).code);
        vm.etch(MESSENGER, address(new CctpMessengerDouble()).code);
        vm.etch(TRANSMITTER, address(new CctpTransmitterDouble()).code);
        token = CctpTokenDouble(USDC); messenger = CctpMessengerDouble(MESSENGER);
        factory = new CctpCardFactory();
        AgentSpendingCard.Config memory c = _config();
        vm.prank(OWNER); card = CctpSpendingCard(factory.createCard(c, _domains(true)));
        token.mint(address(card), 1000 * UNIT);
    }
    function _domains(bool direct) private pure returns (uint32[] memory domains) {
        domains = new uint32[](direct ? 3 : 2); domains[0] = 6; domains[1] = 3;
        if (direct) domains[2] = 37;
    }
    function _config() private returns (AgentSpendingCard.Config memory c) {
        address[] memory recipients = new address[](1); recipients[0] = MERCHANT;
        c = AgentSpendingCard.Config(OWNER, GATEWAY, vm.addr(SIGNER), USDC, address(cpu), 1,
            address(beacon), address(cpu), sha256(nl), POLICY, 500 * UNIT, 100 * UNIT, 150 * UNIT,
            100, 1000, 10000, recipients);
    }
    function _invoice(uint256 n) private pure returns (bytes32) { return keccak256(abi.encode(MERCHANT, n)); }
    function _reserve(uint256 n, uint64 amount, uint32 domain) private {
        vm.prank(GATEWAY);
        card.reserveBridge(bytes32(n), RH, EH, _invoice(n), MERCHANT, amount, 1200, domain);
    }
    function _sign(bytes32 value, uint256 key) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, value); return abi.encodePacked(r, s, v);
    }
    function _burn(uint256 n) private {
        bytes memory sig = _sign(card.releaseDigest(bytes32(n), 1199, DECISION, GL_TX), SIGNER);
        card.settle(bytes32(n), 1199, DECISION, GL_TX, sig);
    }
    function _domain(address target, uint256 chainId, string memory version) private pure returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("IntentGuard"), keccak256(bytes(version)), chainId, target));
    }
    function _route(uint32 domain, address recipient, uint64 amount) private pure returns (bytes32) {
        return keccak256(abi.encode(domain, bytes32(uint256(uint160(recipient))), amount, uint256(0), uint32(2000), bytes32(0)));
    }
    function _release(uint256 n, bytes32 requestHash, bytes32 evidenceHash, bytes32 policy, uint32 domain,
        address recipient, uint64 amount) private view returns (bytes32) {
        return keccak256(abi.encodePacked(hex"1901", _domain(address(card), 1952, "2"), keccak256(abi.encode(
            keccak256("BridgeRelease(bytes32 requestId,bytes32 requestHash,bytes32 policyHash,bytes32 evidenceHash,bytes32 decisionHash,bytes32 genLayerTxHash,uint64 validUntil,bytes32 routeHash)"),
            bytes32(n), requestHash, policy, evidenceHash, DECISION, GL_TX, uint64(1199), _route(domain, recipient, amount)))));
    }
    function _receipt(uint256 n, bytes32 source, bytes32 destination, bytes32 message, uint64 amount)
        private view returns (bytes32) {
        return keccak256(abi.encodePacked(hex"1901", _domain(address(card), 1952, "2"), keccak256(abi.encode(
            keccak256("BridgeReceipt(bytes32 requestId,bytes32 requestHash,bytes32 routeHash,bytes32 sourceTxHash,bytes32 destinationTxHash,bytes32 messageHash,uint64 amount)"),
            bytes32(n), RH, _route(6, MERCHANT, UNIT), source, destination, message, amount))));
    }
    function _confirm(uint256 n) private {
        bytes memory sig = _sign(_receipt(n, SOURCE_TX, DEST_TX, MESSAGE, UNIT), SIGNER);
        card.confirmBridge(bytes32(n), SOURCE_TX, DEST_TX, MESSAGE, sig);
    }

    function testFactoryPinsOfficialAssetAndDestinations() public view {
        yes(card.token() == USDC); yes(card.TOKEN_MESSENGER() == MESSENGER);
        yes(factory.isCard(address(card))); eq(factory.cardsOf(OWNER).length, 1);
        yes(card.domainAllowed(3) && card.domainAllowed(6) && card.domainAllowed(37));
        eq(card.allowedDomains().length, 3);
        yes(card.destinationToken(6) == 0x036CbD53842c5426634e7929541eC2318f3dCF7e);
        yes(card.destinationToken(3) == 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d);
    }
    function testFactoryOwnerCannotBeForged() public {
        AgentSpendingCard.Config memory c = _config();
        vm.expectRevert(AgentSpendingCard.Unauthorized.selector); factory.createCard(c, _domains(true));
    }
    function testFactoryCannotDeployOnMainnet() public {
        vm.chainId(196);
        vm.expectRevert(CctpSpendingCard.UnsupportedAssetOrChain.selector); new CctpCardFactory();
    }
    function testMainnetAndDifferentTokenConstructorReject() public {
        AgentSpendingCard.Config memory c = _config();
        vm.chainId(196);
        vm.expectRevert(CctpSpendingCard.UnsupportedAssetOrChain.selector); new CctpSpendingCard(c, _domains(true));
        vm.chainId(1952); c.token = address(new CctpTokenDouble());
        vm.expectRevert(CctpSpendingCard.UnsupportedAssetOrChain.selector); new CctpSpendingCard(c, _domains(true));
    }
    function testEmptyDuplicateOrUnknownDomainsReject() public {
        AgentSpendingCard.Config memory c = _config();
        vm.expectRevert(CctpSpendingCard.UnsupportedDestination.selector); new CctpSpendingCard(c, new uint32[](0));
        uint32[] memory domains = _domains(true); domains[2] = 6;
        vm.expectRevert(CctpSpendingCard.UnsupportedDestination.selector); new CctpSpendingCard(c, domains);
        domains[2] = 0;
        vm.expectRevert(CctpSpendingCard.UnsupportedDestination.selector); new CctpSpendingCard(c, domains);
    }
    function testDestinationAndDirectPermissionEnforcedOnchain() public {
        vm.expectRevert(CctpSpendingCard.UnsupportedDestination.selector); _reserve(1, UNIT, 37);
        vm.expectRevert(CctpSpendingCard.UnsupportedDestination.selector); _reserve(1, UNIT, 0);
        AgentSpendingCard.Config memory c = _config();
        vm.prank(OWNER); CctpSpendingCard crossOnly = CctpSpendingCard(factory.createCard(c, _domains(false)));
        token.mint(address(crossOnly), UNIT);
        vm.expectRevert(CctpSpendingCard.UnsupportedDestination.selector); vm.prank(GATEWAY);
        crossOnly.reserve(bytes32(uint256(1)), RH, EH, _invoice(1), MERCHANT, UNIT, 1200);
    }
    function testUnselectedBridgeRouteRejects() public {
        AgentSpendingCard.Config memory c = _config();
        uint32[] memory domains = new uint32[](1); domains[0] = 6;
        vm.prank(OWNER); CctpSpendingCard baseOnly = CctpSpendingCard(factory.createCard(c, domains));
        token.mint(address(baseOnly), UNIT);
        vm.expectRevert(CctpSpendingCard.UnsupportedDestination.selector); vm.prank(GATEWAY);
        baseOnly.reserveBridge(bytes32(uint256(1)), RH, EH, _invoice(1), MERCHANT, UNIT, 1200, 3);
    }
    function testGatewayAndRecipientGuardsCannotBeBypassed() public {
        vm.expectRevert(AgentSpendingCard.Unauthorized.selector);
        card.reserveBridge(bytes32(uint256(1)), RH, EH, _invoice(1), MERCHANT, UNIT, 1200, 6);
        vm.expectRevert(abi.encodeWithSelector(AgentSpendingCard.PolicyViolation.selector, uint8(16))); vm.prank(GATEWAY);
        card.reserveBridge(bytes32(uint256(1)), RH, EH, _invoice(1), OUTSIDER, UNIT, 1200, 6);
        vm.expectRevert(abi.encodeWithSelector(AgentSpendingCard.PolicyViolation.selector, uint8(1)));
        _reserve(1, 101 * UNIT, 6);
    }
    function testIndependentReleaseCommitmentAndBurnRemainInProgress() public {
        _reserve(1, UNIT, 6);
        eq(card.getBridgeRequest(bytes32(uint256(1))).routeHash, _route(6, MERCHANT, UNIT));
        eq(card.releaseDigest(bytes32(uint256(1)), 1199, DECISION, GL_TX), _release(1, RH, EH, POLICY, 6, MERCHANT, UNIT));
        vm.recordLogs(); _burn(1);
        VmBridge.Log[] memory logs = vm.getRecordedLogs();
        bytes32 paid = keccak256("Paid(bytes32,bytes32,bytes32,address,uint64)");
        bytes32 started = keccak256("BridgeStarted(bytes32,uint32,bytes32,address,uint64,bytes32,bytes32)");
        uint256 startedCount;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(card)) continue;
            yes(logs[i].topics[0] != paid);
            if (logs[i].topics[0] == started) startedCount++;
        }
        eq(startedCount, 1);
        eq(uint256(card.getRequest(bytes32(uint256(1))).status), 5);
        eq(token.balanceOf(address(card)), 999 * UNIT); eq(token.balanceOf(MERCHANT), 0);
        eq(token.allowance(address(card), MESSENGER), 0);
        eq(messenger.lastDomain(), 6); eq(messenger.lastRecipient(), bytes32(uint256(uint160(MERCHANT))));
        eq(messenger.lastAmount(), UNIT); eq(card.totalSpent(), UNIT); eq(card.totalReserved(), 0);
        eq(card.pendingCount(), 0); eq(card.invoiceRequest(_invoice(1)), bytes32(uint256(1)));
    }
    function testDirectUSDCUsesVersionTwoReleaseAndTransfers() public {
        vm.prank(GATEWAY); card.reserve(bytes32(uint256(1)), RH, EH, _invoice(1), MERCHANT, UNIT, 1200);
        bytes32 expected = keccak256(abi.encodePacked(hex"1901", _domain(address(card), 1952, "2"), keccak256(abi.encode(
            keccak256("Release(bytes32 requestId,bytes32 requestHash,bytes32 policyHash,bytes32 evidenceHash,bytes32 decisionHash,bytes32 genLayerTxHash,uint64 validUntil)"),
            bytes32(uint256(1)), RH, POLICY, EH, DECISION, GL_TX, uint64(1199)))));
        eq(card.releaseDigest(bytes32(uint256(1)), 1199, DECISION, GL_TX), expected);
        _burn(1); eq(uint256(card.getRequest(bytes32(uint256(1))).status), 2); eq(token.balanceOf(MERCHANT), UNIT);
        eq(messenger.lastAmount(), 0);
    }
    function testChangedRouteRecipientAmountOrCommitmentsCannotBurn() public {
        _reserve(1, UNIT, 6);
        for (uint256 i; i < 6; ++i) {
            bytes32 value = _release(1, i == 0 ? bytes32(uint256(123)) : RH, i == 1 ? bytes32(uint256(123)) : EH,
                i == 2 ? bytes32(uint256(123)) : POLICY, i == 3 ? 3 : 6, i == 4 ? OUTSIDER : MERCHANT,
                i == 5 ? 2 * UNIT : UNIT);
            bytes memory sig = _sign(value, SIGNER);
            vm.expectRevert(AgentSpendingCard.InvalidSignature.selector); card.settle(bytes32(uint256(1)), 1199, DECISION, GL_TX, sig);
        }
        eq(token.balanceOf(address(card)), 1000 * UNIT); eq(card.totalSpent(), 0);
    }
    function testLegacyReleaseCannotAuthorizeBridge() public {
        _reserve(1, UNIT, 6);
        bytes32 oldRelease = keccak256(abi.encodePacked(hex"1901", _domain(address(card), 1952, "1"), keccak256(abi.encode(
            keccak256("Release(bytes32 requestId,bytes32 requestHash,bytes32 policyHash,bytes32 evidenceHash,bytes32 decisionHash,bytes32 genLayerTxHash,uint64 validUntil)"),
            bytes32(uint256(1)), RH, POLICY, EH, DECISION, GL_TX, uint64(1199)))));
        bytes memory sig = _sign(oldRelease, SIGNER);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector);
        card.settle(bytes32(uint256(1)), 1199, DECISION, GL_TX, sig);
    }
    function testBridgeSignatureCannotReplayAcrossRequestsOrChains() public {
        _reserve(1, UNIT, 6); _reserve(2, UNIT, 6);
        bytes memory sig = _sign(card.releaseDigest(bytes32(uint256(1)), 1199, DECISION, GL_TX), SIGNER);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector); card.settle(bytes32(uint256(2)), 1199, DECISION, GL_TX, sig);
        vm.chainId(84532);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector); card.settle(bytes32(uint256(1)), 1199, DECISION, GL_TX, sig);
    }
    function testPauseAndTapeOutUpgradeStopPreviouslySignedBurn() public {
        _reserve(1, UNIT, 6);
        bytes memory sig = _sign(card.releaseDigest(bytes32(uint256(1)), 1199, DECISION, GL_TX), SIGNER);
        vm.prank(OWNER); card.setEnabled(false);
        vm.expectRevert(AgentSpendingCard.Disabled.selector); card.settle(bytes32(uint256(1)), 1199, DECISION, GL_TX, sig);
        vm.prank(OWNER); card.setEnabled(true); beacon.upgradeTo(OUTSIDER);
        vm.expectRevert(AgentSpendingCard.ProcessorChanged.selector);
        card.settle(bytes32(uint256(1)), 1199, DECISION, GL_TX, sig);
        eq(token.balanceOf(address(card)), 1000 * UNIT); eq(card.totalReserved(), UNIT);
    }
    function testIssuerBurnFailureRollsBackSpendAndAllowance() public {
        _reserve(1, UNIT, 6); messenger.setFail(true);
        bytes memory sig = _sign(card.releaseDigest(bytes32(uint256(1)), 1199, DECISION, GL_TX), SIGNER);
        vm.expectRevert(bytes("test issuer burn failure")); card.settle(bytes32(uint256(1)), 1199, DECISION, GL_TX, sig);
        eq(card.totalSpent(), 0); eq(card.totalReserved(), UNIT); eq(token.allowance(address(card), MESSENGER), 0);
        eq(uint256(card.getRequest(bytes32(uint256(1))).status), 1);
    }
    function testUnexpectedTokenDebitRollsBackBurn() public {
        _reserve(1, UNIT, 6); messenger.setIncorrectDebit(true);
        bytes memory sig = _sign(card.releaseDigest(bytes32(uint256(1)), 1199, DECISION, GL_TX), SIGNER);
        vm.expectRevert(CctpSpendingCard.BridgeAmountMismatch.selector); card.settle(bytes32(uint256(1)), 1199, DECISION, GL_TX, sig);
        eq(token.balanceOf(address(card)), 1000 * UNIT); eq(card.totalReserved(), UNIT);
        eq(token.allowance(address(card), MESSENGER), 0);
    }
    function testApprovalFailureRollsBackAndOptionalReturnSupported() public {
        _reserve(1, UNIT, 6); token.setApprovalFailure(true);
        bytes memory sig = _sign(card.releaseDigest(bytes32(uint256(1)), 1199, DECISION, GL_TX), SIGNER);
        vm.expectRevert(AgentSpendingCard.TokenTransferFailed.selector); card.settle(bytes32(uint256(1)), 1199, DECISION, GL_TX, sig);
        eq(card.totalReserved(), UNIT); token.setApprovalFailure(false); token.setNoReturn(true);
        _burn(1); eq(card.totalSpent(), UNIT); eq(token.allowance(address(card), MESSENGER), 0);
    }
    function testMessengerCallbackCannotReenterSettlementOrReceipt() public {
        _reserve(1, UNIT, 6);
        bytes memory sig = _sign(card.releaseDigest(bytes32(uint256(1)), 1199, DECISION, GL_TX), SIGNER);
        messenger.setCallback(abi.encodeCall(card.settle, (bytes32(uint256(1)), uint64(1199), DECISION, GL_TX, sig)));
        _burn(1); yes(messenger.callbackAttempted()); yes(!messenger.callbackSucceeded()); eq(card.totalSpent(), UNIT);
    }
    function testMessengerCodeChangeFailsClosed() public {
        _reserve(1, UNIT, 6);
        bytes memory sig = _sign(card.releaseDigest(bytes32(uint256(1)), 1199, DECISION, GL_TX), SIGNER);
        vm.etch(MESSENGER, hex"00");
        vm.expectRevert(CctpSpendingCard.MessengerChanged.selector); card.settle(bytes32(uint256(1)), 1199, DECISION, GL_TX, sig);
    }
    function testCancelBeforeBurnReleasesReservationAndInvoice() public {
        _reserve(1, UNIT, 6); vm.prank(OWNER); card.cancel(bytes32(uint256(1)));
        eq(card.totalSpent(), 0); eq(card.totalReserved(), 0); eq(card.invoiceRequest(_invoice(1)), bytes32(0));
        vm.prank(GATEWAY); card.reserveBridge(bytes32(uint256(2)), RH, EH, _invoice(1), MERCHANT, UNIT, 1200, 3);
        _burn(2); eq(messenger.lastDomain(), 3);
    }
    function testBurnCannotBeCancelledExpiredOrReplayedAndInvoiceStaysUsed() public {
        _reserve(1, UNIT, 6); _burn(1);
        vm.expectRevert(AgentSpendingCard.NotReserved.selector); vm.prank(OWNER); card.cancel(bytes32(uint256(1)));
        vm.warp(1300);
        vm.expectRevert(AgentSpendingCard.NotReserved.selector); card.expire(bytes32(uint256(1)));
        bytes memory sig = _sign(card.releaseDigest(bytes32(uint256(1)), 1199, DECISION, GL_TX), SIGNER);
        vm.expectRevert(AgentSpendingCard.NotReserved.selector); card.settle(bytes32(uint256(1)), 1199, DECISION, GL_TX, sig);
        vm.expectRevert(AgentSpendingCard.AlreadyUsed.selector); vm.prank(GATEWAY);
        card.reserveBridge(bytes32(uint256(2)), RH, EH, _invoice(1), MERCHANT, UNIT, 1400, 3);
        eq(card.totalSpent(), UNIT); eq(token.balanceOf(address(card)), 999 * UNIT);
    }
    function testIndependentReceiptMarksPaidWithoutMovingMoreFunds() public {
        _reserve(1, UNIT, 6); _burn(1);
        eq(card.bridgeReceiptDigest(bytes32(uint256(1)), SOURCE_TX, DEST_TX, MESSAGE), _receipt(1, SOURCE_TX, DEST_TX, MESSAGE, UNIT));
        _confirm(1);
        CctpSpendingCard.BridgeRequest memory b = card.getBridgeRequest(bytes32(uint256(1)));
        eq(b.sourceTxHash, SOURCE_TX); eq(b.destinationTxHash, DEST_TX); eq(b.messageHash, MESSAGE);
        eq(uint256(card.getRequest(bytes32(uint256(1))).status), 2);
        eq(card.totalSpent(), UNIT); eq(token.balanceOf(address(card)), 999 * UNIT); eq(card.totalReserved(), 0);
        vm.expectRevert(CctpSpendingCard.NotBridging.selector); _confirm(1);
    }
    function testReceiptCanFinalizeAfterRevocationAndPolicyExpiry() public {
        _reserve(1, UNIT, 6); _burn(1);
        vm.prank(OWNER); card.revoke(); vm.warp(11000); _confirm(1);
        eq(uint256(card.getRequest(bytes32(uint256(1))).status), 2); yes(card.revoked()); eq(card.totalSpent(), UNIT);
    }
    function testReceiptBeforeBurnAndForDirectTransferRejects() public {
        _reserve(1, UNIT, 6);
        vm.expectRevert(CctpSpendingCard.NotBridging.selector); _confirm(1);
        vm.prank(GATEWAY); card.reserve(bytes32(uint256(2)), RH, EH, _invoice(2), MERCHANT, UNIT, 1200);
        _burn(2);
        vm.expectRevert(CctpSpendingCard.NotBridging.selector); _confirm(2);
    }
    function testReceiptMutationWrongAttestorOrZeroCommitmentsReject() public {
        _reserve(1, UNIT, 6); _burn(1);
        bytes memory sig = _sign(_receipt(1, SOURCE_TX, DEST_TX, MESSAGE, UNIT), SIGNER);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector);
        card.confirmBridge(bytes32(uint256(1)), bytes32(uint256(123)), DEST_TX, MESSAGE, sig);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector);
        card.confirmBridge(bytes32(uint256(1)), SOURCE_TX, bytes32(uint256(123)), MESSAGE, sig);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector);
        card.confirmBridge(bytes32(uint256(1)), SOURCE_TX, DEST_TX, bytes32(uint256(123)), sig);
        sig = _sign(_receipt(1, SOURCE_TX, DEST_TX, MESSAGE, UNIT), SIGNER + 1);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector);
        card.confirmBridge(bytes32(uint256(1)), SOURCE_TX, DEST_TX, MESSAGE, sig);
        sig = _sign(_receipt(1, SOURCE_TX, DEST_TX, MESSAGE, 2 * UNIT), SIGNER);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector);
        card.confirmBridge(bytes32(uint256(1)), SOURCE_TX, DEST_TX, MESSAGE, sig);
        vm.expectRevert(AgentSpendingCard.InvalidRequest.selector);
        card.confirmBridge(bytes32(uint256(1)), bytes32(0), DEST_TX, MESSAGE, sig);
        eq(uint256(card.getRequest(bytes32(uint256(1))).status), 5);
    }
    function testBridgeAndReceiptSignaturesCannotReplayAcrossCards() public {
        _reserve(1, UNIT, 6); _burn(1);
        AgentSpendingCard.Config memory c = _config();
        vm.prank(OWNER); CctpSpendingCard other = CctpSpendingCard(factory.createCard(c, _domains(true)));
        token.mint(address(other), UNIT);
        vm.prank(GATEWAY); other.reserveBridge(bytes32(uint256(1)), RH, EH, _invoice(1), MERCHANT, UNIT, 1200, 6);
        bytes memory sig = _sign(card.releaseDigest(bytes32(uint256(1)), 1199, DECISION, GL_TX), SIGNER);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector); other.settle(bytes32(uint256(1)), 1199, DECISION, GL_TX, sig);
        sig = _sign(other.releaseDigest(bytes32(uint256(1)), 1199, DECISION, GL_TX), SIGNER);
        other.settle(bytes32(uint256(1)), 1199, DECISION, GL_TX, sig);
        sig = _sign(_receipt(1, SOURCE_TX, DEST_TX, MESSAGE, UNIT), SIGNER);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector);
        other.confirmBridge(bytes32(uint256(1)), SOURCE_TX, DEST_TX, MESSAGE, sig);
        eq(uint256(other.getRequest(bytes32(uint256(1))).status), 5);
        _confirm(1);
    }
    function testIssuerCallbackCannotConfirmReceiptDuringBurn() public {
        _reserve(1, UNIT, 6);
        bytes memory sig = _sign(_receipt(1, SOURCE_TX, DEST_TX, MESSAGE, UNIT), SIGNER);
        messenger.setCallback(abi.encodeCall(card.confirmBridge, (bytes32(uint256(1)), SOURCE_TX, DEST_TX, MESSAGE, sig)));
        _burn(1); yes(messenger.callbackAttempted()); yes(!messenger.callbackSucceeded());
        eq(uint256(card.getRequest(bytes32(uint256(1))).status), 5); _confirm(1);
    }
    function testSourceBudgetRemainsChargedAcrossPeriodsAndWithdrawOnlyUnspent() public {
        _reserve(1, 100 * UNIT, 6); _burn(1);
        (uint64 spent0, uint64 reserved0) = card.periods(0); eq(spent0, 100 * UNIT); eq(reserved0, 0);
        vm.expectRevert(abi.encodeWithSelector(AgentSpendingCard.PolicyViolation.selector, uint8(4)));
        _reserve(2, 51 * UNIT, 3);
        vm.warp(1100); _reserve(2, 100 * UNIT, 3); _burn(2);
        eq(card.totalSpent(), 200 * UNIT);
        (uint64 spent1, uint64 reserved1) = card.periods(1); eq(spent1, 100 * UNIT); eq(reserved1, 0);
        vm.prank(OWNER); card.withdraw(800 * UNIT);
        eq(token.balanceOf(OWNER), 800 * UNIT); eq(token.balanceOf(address(card)), 0);
    }
}
