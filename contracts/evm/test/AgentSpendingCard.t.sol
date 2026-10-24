// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {AgentSpendingCard} from "../src/AgentSpendingCard.sol";
import {CardFactory} from "../src/CardFactory.sol";
import {LocalNandProcessor} from "../src/LocalNandProcessor.sol";
import {PolicyReference} from "./PolicyReference.sol";

interface Vm {
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function chainId(uint256) external;
    function etch(address, bytes calldata) external;
    function projectRoot() external view returns (string memory);
    function readFileBinary(string calldata) external view returns (bytes memory);
}

contract MockUSDT {
    mapping(address => uint256) public balanceOf;
    bool public failTransfers;
    bool public callbackAttempted;
    bool public callbackSucceeded;
    address public callbackTarget;
    bytes public callbackData;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function burn(address from, uint256 amount) external { balanceOf[from] -= amount; }
    function setFail(bool fail) external { failTransfers = fail; }
    function setCallback(address target, bytes calldata data) external { callbackTarget = target; callbackData = data; }
    function transfer(address to, uint256 amount) external returns (bool) {
        if (failTransfers) return false;
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount;
        if (callbackTarget != address(0)) {
            callbackAttempted = true;
            (callbackSucceeded,) = callbackTarget.call(callbackData);
        }
        return true;
    }
}

contract MutableBeacon {
    address public implementation;
    constructor(address impl) { implementation = impl; }
    function upgradeTo(address impl) external { implementation = impl; }
}

/// Test-only fault injection wrapper preserves the real TapeOut evaluator path.
contract FaultProcessor {
    LocalNandProcessor public immutable oracle;
    bool public failEval;
    bool public alteredNetlist;
    uint8 public malformed;
    constructor(LocalNandProcessor p) { oracle = p; }
    function setFail(bool fail) external { failEval = fail; }
    function setNetlistAltered(bool altered) external { alteredNetlist = altered; }
    function setMalformed(uint8 value) external { malformed = value; }
    function eval(uint256 id, bytes calldata input) external view returns (bytes memory) {
        require(!failEval, "processor unavailable");
        if (malformed == 1) return "";
        if (malformed == 2) return hex"03";
        if (malformed == 3) return hex"00";
        return oracle.eval(id, input);
    }
    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32) {
        return oracle.circuitInfo(id);
    }
    function netlist(uint256 id) external view returns (bytes memory) {
        bytes memory nl = oracle.netlist(id); if (alteredNetlist) nl[0] = 0x01; return nl;
    }
}

contract AgentSpendingCardTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ATTESTOR_KEY = 0x1001;
    address private constant OWNER = address(0xa11ce);
    address private constant GATEWAY = address(0x600d);
    address private constant MERCHANT = address(0xbeef);
    address private constant OUTSIDER = address(0xbad);
    bytes32 private constant POLICY = keccak256("immutable finalized owner policy");
    bytes32 private constant DECISION = keccak256("all criteria passed");
    bytes32 private constant GL_TX = keccak256("successful finalized GenLayer transaction");
    bytes32 private constant RH = keccak256("same canonical request");
    bytes32 private constant EH = keccak256("same evidence");
    uint64 private constant UNIT = 1_000_000;
    AgentSpendingCard private card;
    MockUSDT private token;
    LocalNandProcessor private oracle;
    FaultProcessor private cpu;
    MutableBeacon private beacon;
    CardFactory private factory;
    bytes private nl;

    function assertEq(uint256 a, uint256 b) private pure { require(a == b, "assert uint equality"); }
    function assertEq(bytes32 a, bytes32 b) private pure { require(a == b, "assert hash equality"); }
    function assertTrue(bool value) private pure { require(value, "assert true"); }

    function setUp() public {
        vm.chainId(196); vm.warp(1000);
        nl = vm.readFileBinary(string.concat(vm.projectRoot(), "/../../circuits/artifacts/policy.netlist.bin"));
        oracle = new LocalNandProcessor(nl); cpu = new FaultProcessor(oracle); beacon = new MutableBeacon(address(cpu));
        token = new MockUSDT(); factory = new CardFactory();
        AgentSpendingCard.Config memory c = _config();
        vm.prank(OWNER); card = AgentSpendingCard(factory.createCard(c));
        token.mint(address(card), 1000 * UNIT);
    }
    function _config() private returns (AgentSpendingCard.Config memory c) {
        address[] memory recipients = new address[](1); recipients[0] = MERCHANT;
        c = AgentSpendingCard.Config(OWNER, GATEWAY, vm.addr(ATTESTOR_KEY), address(token), address(cpu), 1,
            address(beacon), address(cpu), sha256(nl), POLICY, 500 * UNIT, 100 * UNIT,
            150 * UNIT, 100, 1000, 10000, recipients);
    }
    function _id(uint256 n) private pure returns (bytes32) { return bytes32(n); }
    function _invoice(uint256 n) private pure returns (bytes32) { return keccak256(abi.encode(MERCHANT, n)); }
    function _reserve(uint256 n, uint64 amount, uint64 expiresAt) private {
        vm.prank(GATEWAY); card.reserve(_id(n), RH, EH, _invoice(n), MERCHANT, amount, expiresAt);
    }
    function _sign(AgentSpendingCard target, uint256 n, uint64 validUntil, bytes32 decision, bytes32 glTx)
        private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTOR_KEY, target.releaseDigest(_id(n), validUntil, decision, glTx));
        return abi.encodePacked(r, s, v);
    }
    function _pay(uint256 n, uint64 validUntil) private {
        bytes memory signature = _sign(card, n, validUntil, DECISION, GL_TX);
        vm.prank(OUTSIDER); card.settle(_id(n), validUntil, DECISION, GL_TX, signature);
    }

    function testFactoryOwnerConfigAndImmutableViews() public {
        AgentSpendingCard.Config memory c = card.config();
        assertTrue(c.owner == OWNER && c.gateway == GATEWAY && c.attestor == vm.addr(ATTESTOR_KEY));
        assertEq(c.totalLimit, 500 * UNIT); assertEq(c.policyHash, POLICY); assertEq(c.expectedNetlistHash, sha256(nl));
        assertTrue(factory.isCard(address(card))); assertEq(factory.cardsOf(OWNER).length, 1);
        assertTrue(card.recipientAllowed(MERCHANT)); assertEq(card.allowedRecipients().length, 1);
    }
    function testFactoryCannotCreateForAnotherOwner() public {
        AgentSpendingCard.Config memory c = _config();
        vm.expectRevert(AgentSpendingCard.Unauthorized.selector); factory.createCard(c);
    }
    function testBadConfigZeroPeriodAndDuplicateRecipientReject() public {
        AgentSpendingCard.Config memory c = _config(); c.periodSeconds = 0;
        vm.expectRevert(AgentSpendingCard.InvalidConfig.selector); new AgentSpendingCard(c);
        c = _config(); c.allowedRecipients = new address[](2); c.allowedRecipients[0] = MERCHANT; c.allowedRecipients[1] = MERCHANT;
        vm.expectRevert(AgentSpendingCard.InvalidConfig.selector); new AgentSpendingCard(c);
    }
    function testOnlyGatewayCanReserve() public {
        vm.expectRevert(AgentSpendingCard.Unauthorized.selector);
        card.reserve(_id(1), RH, EH, _invoice(1), MERCHANT, UNIT, 1099);
    }
    function testReserveImmutableRequestAndBalances() public {
        _reserve(1, 100 * UNIT, 1200);
        AgentSpendingCard.Request memory r = card.getRequest(_id(1));
        assertEq(r.requestHash, RH); assertEq(r.evidenceHash, EH); assertEq(r.invoiceKey, _invoice(1));
        assertTrue(r.recipient == MERCHANT); assertEq(r.amount, 100 * UNIT); assertEq(r.periodId, 0);
        assertEq(uint256(r.status), 1); assertEq(card.totalReserved(), 100 * UNIT); assertEq(card.pendingCount(), 1);
        assertEq(card.availableBalance(), 900 * UNIT); (uint64 spent, uint64 reserved) = card.periods(0);
        assertEq(spent, 0); assertEq(reserved, 100 * UNIT);
    }
    function testTwoReservationsCannotOvercommitPeriod() public {
        _reserve(1, 100 * UNIT, 1200); _reserve(2, 50 * UNIT, 1200);
        assertEq(card.totalReserved(), 150 * UNIT);
        vm.expectRevert(AgentSpendingCard.TooManyPending.selector);
        _reserve(3, UNIT, 1200);
    }
    function testPeriodReservationDeniesSecondPaymentOverBudget() public {
        _reserve(1, 100 * UNIT, 1200);
        vm.expectRevert(abi.encodeWithSelector(AgentSpendingCard.PolicyViolation.selector, uint8(4)));
        _reserve(2, 51 * UNIT, 1200);
        assertEq(card.totalReserved(), 100 * UNIT); assertEq(card.pendingCount(), 1);
    }
    function testActualFundedBalanceLimitsReservations() public {
        token.burn(address(card), 910 * UNIT);
        (bool allow, uint8 failure) = card.preview(MERCHANT, 90 * UNIT, 1200);
        assertTrue(allow); assertEq(failure, 0); _reserve(1, 90 * UNIT, 1200);
        vm.expectRevert(abi.encodeWithSelector(AgentSpendingCard.PolicyViolation.selector, uint8(2)));
        _reserve(2, UNIT, 1200);
    }
    function testCircuitPerPaymentAndRecipientFailures() public view {
        (bool allow, uint8 failure) = card.preview(OUTSIDER, 101 * UNIT, 1200);
        assertTrue(!allow); assertEq(failure, 17);
    }
    function testLifetimeAndExpiryBoundaries() public {
        vm.warp(999); (bool allow, uint8 failure) = card.preview(MERCHANT, UNIT, 1200);
        assertTrue(!allow); assertEq(failure, 8);
        vm.warp(1000); (allow, failure) = card.preview(MERCHANT, UNIT, 1000); assertTrue(!allow); assertEq(failure, 8);
        (allow, failure) = card.preview(MERCHANT, UNIT, 10001); assertTrue(!allow); assertEq(failure, 8);
        (allow, failure) = card.preview(MERCHANT, UNIT, 10000); assertTrue(allow); assertEq(failure, 0);
        vm.warp(10000); (allow, failure) = card.preview(MERCHANT, UNIT, 10000); assertTrue(!allow); assertEq(failure, 8);
    }
    function testZeroAmountOrMissingHashRejected() public {
        vm.expectRevert(AgentSpendingCard.InvalidRequest.selector); _reserve(1, 0, 1200);
        vm.expectRevert(AgentSpendingCard.InvalidRequest.selector); vm.prank(GATEWAY);
        card.reserve(_id(1), RH, bytes32(0), _invoice(1), MERCHANT, UNIT, 1200);
    }
    function testSignedSettlementOnceAndLedgerCommit() public {
        _reserve(1, 100 * UNIT, 1200); bytes memory sig = _sign(card, 1, 1199, DECISION, GL_TX);
        vm.prank(OUTSIDER); card.settle(_id(1), 1199, DECISION, GL_TX, sig);
        assertEq(token.balanceOf(MERCHANT), 100 * UNIT); assertEq(card.totalSpent(), 100 * UNIT);
        assertEq(card.totalReserved(), 0); assertEq(card.pendingCount(), 0);
        (uint64 spent, uint64 reserved) = card.periods(0); assertEq(spent, 100 * UNIT); assertEq(reserved, 0);
        assertEq(uint256(card.getRequest(_id(1)).status), 2);
        vm.expectRevert(AgentSpendingCard.NotReserved.selector); card.settle(_id(1), 1199, DECISION, GL_TX, sig);
    }
    function testSameInvoicePendingAndPaidCannotBeReused() public {
        _reserve(1, UNIT, 1200);
        vm.expectRevert(AgentSpendingCard.AlreadyUsed.selector); vm.prank(GATEWAY);
        card.reserve(_id(2), RH, EH, _invoice(1), MERCHANT, UNIT, 1200);
        _pay(1, 1199);
        vm.expectRevert(AgentSpendingCard.AlreadyUsed.selector); vm.prank(GATEWAY);
        card.reserve(_id(3), RH, EH, _invoice(1), MERCHANT, UNIT, 1200);
    }
    function testSameRequestCannotBeAlteredOrReusedAfterCancel() public {
        _reserve(1, UNIT, 1200);
        vm.expectRevert(AgentSpendingCard.AlreadyUsed.selector); vm.prank(GATEWAY);
        card.reserve(_id(1), keccak256("altered"), EH, _invoice(2), MERCHANT, 2 * UNIT, 1300);
        vm.prank(OWNER); card.cancel(_id(1));
        vm.expectRevert(AgentSpendingCard.AlreadyUsed.selector); _reserve(1, UNIT, 1200);
        vm.prank(GATEWAY); card.reserve(_id(2), RH, EH, _invoice(1), MERCHANT, UNIT, 1200);
    }
    function testRolloverSettlementChargesOriginalReservationPeriod() public {
        _reserve(1, 100 * UNIT, 1300); vm.warp(1100); _reserve(2, 100 * UNIT, 1300);
        _pay(1, 1299);
        (uint64 spent0, uint64 reserved0) = card.periods(0);
        (uint64 spent1, uint64 reserved1) = card.periods(1);
        assertEq(spent0, 100 * UNIT); assertEq(reserved0, 0); assertEq(spent1, 0); assertEq(reserved1, 100 * UNIT);
        _pay(2, 1299); assertEq(card.totalSpent(), 200 * UNIT);
    }
    function testTotalBudgetPersistsAcrossPeriodsAndCanBeExactlyExhausted() public {
        for (uint256 i = 1; i <= 5; i++) {
            vm.warp(1000 + (i-1)*100); _reserve(i, 100 * UNIT, uint64(1100 + (i-1)*100)); _pay(i, uint64(1099 + (i-1)*100));
        }
        vm.warp(1500); assertEq(card.totalSpent(), 500 * UNIT);
        vm.expectRevert(abi.encodeWithSelector(AgentSpendingCard.PolicyViolation.selector, uint8(2)));
        _reserve(6, 1, 1600);
    }
    function testAttestationAlteredDecisionTxAndDeadlineRejected() public {
        _reserve(1, UNIT, 1200); bytes memory sig = _sign(card, 1, 1199, DECISION, GL_TX);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector);
        card.settle(_id(1), 1199, keccak256("altered decision"), GL_TX, sig);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector);
        card.settle(_id(1), 1199, DECISION, keccak256("altered finality"), sig);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector);
        card.settle(_id(1), 1198, DECISION, GL_TX, sig);
        assertEq(card.totalReserved(), UNIT);
    }
    function testAttestationCannotReleaseAnotherRequestOrEvidence() public {
        _reserve(1, UNIT, 1200);
        vm.prank(GATEWAY); card.reserve(_id(2), RH, keccak256("other evidence"), _invoice(2), MERCHANT, UNIT, 1200);
        bytes memory sig = _sign(card, 1, 1199, DECISION, GL_TX);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector); card.settle(_id(2), 1199, DECISION, GL_TX, sig);
    }
    function testSignatureWrongChainAndWrongCardRejected() public {
        _reserve(1, UNIT, 1200); bytes memory sig = _sign(card, 1, 1199, DECISION, GL_TX);
        vm.chainId(197); vm.expectRevert(AgentSpendingCard.InvalidSignature.selector);
        card.settle(_id(1), 1199, DECISION, GL_TX, sig); vm.chainId(196);
        AgentSpendingCard.Config memory c = _config(); vm.prank(OWNER); AgentSpendingCard other = AgentSpendingCard(factory.createCard(c));
        token.mint(address(other), UNIT); vm.prank(GATEWAY); other.reserve(_id(1), RH, EH, _invoice(1), MERCHANT, UNIT, 1200);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector); other.settle(_id(1), 1199, DECISION, GL_TX, sig);
    }
    function testMalformedAndHighSSignaturesRejected() public {
        _reserve(1, UNIT, 1200); bytes memory sig = _sign(card, 1, 1199, DECISION, GL_TX);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector); card.settle(_id(1), 1199, DECISION, GL_TX, hex"00");
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := mload(add(sig,32)) s := mload(add(sig,64)) v := byte(0,mload(add(sig,96))) }
        uint256 order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
        bytes memory highS = abi.encodePacked(r, bytes32(order-uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector); card.settle(_id(1), 1199, DECISION, GL_TX, highS);
    }
    function testExpiredRequestAndAttestationCannotSettle() public {
        _reserve(1, UNIT, 1200); bytes memory sig = _sign(card, 1, 1199, DECISION, GL_TX);
        vm.warp(1199); vm.expectRevert(AgentSpendingCard.Expired.selector); card.settle(_id(1), 1199, DECISION, GL_TX, sig);
        sig = _sign(card, 1, 1201, DECISION, GL_TX);
        vm.expectRevert(AgentSpendingCard.Expired.selector); card.settle(_id(1), 1201, DECISION, GL_TX, sig);
        sig = _sign(card, 1, 1200, DECISION, GL_TX); vm.warp(1200);
        vm.expectRevert(AgentSpendingCard.Expired.selector); card.settle(_id(1), 1200, DECISION, GL_TX, sig);
    }
    function testAnyoneCanExpireAtBoundaryReleasesOriginalPeriodAndInvoice() public {
        _reserve(1, 100 * UNIT, 1200); vm.warp(1199);
        vm.expectRevert(AgentSpendingCard.NotExpired.selector); card.expire(_id(1));
        vm.warp(1200); vm.prank(OUTSIDER); card.expire(_id(1));
        assertEq(card.totalReserved(), 0); assertEq(card.pendingCount(), 0);
        (uint64 spent, uint64 reserved) = card.periods(0); assertEq(spent, 0); assertEq(reserved, 0);
        assertEq(card.invoiceRequest(_invoice(1)), bytes32(0)); assertEq(uint256(card.getRequest(_id(1)).status), 4);
    }
    function testCancellationOwnerOrGatewayAndNoLateSignature() public {
        _reserve(1, UNIT, 1200); bytes memory sig = _sign(card, 1, 1199, DECISION, GL_TX);
        vm.expectRevert(AgentSpendingCard.Unauthorized.selector); card.cancel(_id(1));
        vm.prank(GATEWAY); card.cancel(_id(1)); assertEq(card.totalReserved(), 0);
        vm.expectRevert(AgentSpendingCard.NotReserved.selector); card.settle(_id(1), 1199, DECISION, GL_TX, sig);
    }
    function testPauseStopsReserveAndPreviouslySignedSettlement() public {
        _reserve(1, UNIT, 1200); bytes memory sig = _sign(card, 1, 1199, DECISION, GL_TX);
        vm.expectRevert(AgentSpendingCard.Unauthorized.selector); card.setEnabled(false);
        vm.prank(OWNER); card.setEnabled(false);
        vm.expectRevert(AgentSpendingCard.Disabled.selector); _reserve(2, UNIT, 1200);
        vm.expectRevert(AgentSpendingCard.Disabled.selector); card.settle(_id(1), 1199, DECISION, GL_TX, sig);
        (bool allow, uint8 failures) = card.preview(MERCHANT, UNIT, 1200); assertTrue(!allow); assertEq(failures, 64);
        vm.prank(OWNER); card.setEnabled(true); _pay(1, 1199);
    }
    function testRevokePermanentAndOwnerCanCancelThenWithdraw() public {
        _reserve(1, UNIT, 1200);
        vm.expectRevert(AgentSpendingCard.Unauthorized.selector); card.revoke();
        vm.prank(OWNER); card.revoke();
        vm.expectRevert(AgentSpendingCard.Disabled.selector); vm.prank(OWNER); card.setEnabled(true);
        vm.expectRevert(AgentSpendingCard.Disabled.selector); _reserve(2, UNIT, 1200);
        vm.prank(OWNER); card.cancel(_id(1)); vm.prank(OWNER); card.withdraw(1000 * UNIT);
        assertEq(token.balanceOf(OWNER), 1000 * UNIT);
    }
    function testWithdrawCannotSpendReservationsAndRequiresOwner() public {
        _reserve(1, 100 * UNIT, 1200);
        vm.expectRevert(AgentSpendingCard.Unauthorized.selector); card.withdraw(1);
        vm.expectRevert(AgentSpendingCard.InsufficientAvailable.selector); vm.prank(OWNER); card.withdraw(901 * UNIT);
        vm.prank(OWNER); card.withdraw(900 * UNIT); assertEq(token.balanceOf(address(card)), 100 * UNIT);
        _pay(1, 1199); assertEq(token.balanceOf(MERCHANT), 100 * UNIT);
    }
    function testWithdrawIndependentOfProcessorFailureAndUpgrade() public {
        _reserve(1, 100 * UNIT, 1200); cpu.setFail(true); beacon.upgradeTo(OUTSIDER);
        vm.prank(OWNER); card.withdraw(900 * UNIT); assertEq(token.balanceOf(OWNER), 900 * UNIT);
        vm.prank(OWNER); card.cancel(_id(1)); vm.prank(OWNER); card.withdraw(100 * UNIT);
        assertEq(token.balanceOf(address(card)), 0);
    }
    function testChangedBeaconAndNetlistRejectNewAndReservedPayments() public {
        _reserve(1, UNIT, 1200); bytes memory sig = _sign(card, 1, 1199, DECISION, GL_TX);
        beacon.upgradeTo(OUTSIDER);
        vm.expectRevert(AgentSpendingCard.ProcessorChanged.selector); _reserve(2, UNIT, 1200);
        vm.expectRevert(AgentSpendingCard.ProcessorChanged.selector); card.settle(_id(1), 1199, DECISION, GL_TX, sig);
        beacon.upgradeTo(address(cpu)); cpu.setNetlistAltered(true);
        vm.expectRevert(AgentSpendingCard.ProcessorChanged.selector); card.settle(_id(1), 1199, DECISION, GL_TX, sig);
        assertEq(card.totalReserved(), UNIT);
    }
    function testProcessorCodeReplacementPinAndWithdrawal() public {
        _reserve(1, UNIT, 1200); vm.etch(address(cpu), hex"00");
        vm.expectRevert(AgentSpendingCard.ProcessorChanged.selector); _reserve(2, UNIT, 1200);
        vm.prank(OWNER); card.withdraw(999 * UNIT); assertEq(token.balanceOf(OWNER), 999 * UNIT);
    }
    function testMalformedProcessorFailsClosed() public {
        for (uint8 i = 1; i <= 3; ++i) {
            cpu.setMalformed(i); vm.expectRevert(AgentSpendingCard.ProcessorChanged.selector); _reserve(1, UNIT, 1200);
        }
        assertEq(card.totalReserved(), 0);
    }
    function testTokenTransferFailureRollsBackSettlementAndWithdrawal() public {
        _reserve(1, UNIT, 1200); token.setFail(true);
        bytes memory sig = _sign(card, 1, 1199, DECISION, GL_TX);
        vm.expectRevert(AgentSpendingCard.TokenTransferFailed.selector); card.settle(_id(1), 1199, DECISION, GL_TX, sig);
        assertEq(card.totalReserved(), UNIT); assertEq(card.totalSpent(), 0); assertEq(uint256(card.getRequest(_id(1)).status), 1);
        vm.expectRevert(AgentSpendingCard.TokenTransferFailed.selector); vm.prank(OWNER); card.withdraw(UNIT);
        token.setFail(false); _pay(1, 1199);
    }
    function testTokenCallbackCannotReenterSettlement() public {
        _reserve(1, UNIT, 1200); bytes memory sig = _sign(card, 1, 1199, DECISION, GL_TX);
        token.setCallback(address(card), abi.encodeCall(card.settle, (_id(1), 1199, DECISION, GL_TX, sig)));
        card.settle(_id(1), 1199, DECISION, GL_TX, sig);
        assertTrue(token.callbackAttempted()); assertTrue(!token.callbackSucceeded()); assertEq(token.balanceOf(MERCHANT), UNIT);
    }
    function testDeflationaryBalanceLossStopsReservedSettlementWithoutCorruptingLedger() public {
        _reserve(1, 100 * UNIT, 1200); _reserve(2, 50 * UNIT, 1200); token.burn(address(card), 851 * UNIT);
        bytes memory sig = _sign(card, 1, 1199, DECISION, GL_TX);
        vm.expectRevert(abi.encodeWithSelector(AgentSpendingCard.PolicyViolation.selector, uint8(2)));
        card.settle(_id(1), 1199, DECISION, GL_TX, sig);
        assertEq(card.totalReserved(), 150 * UNIT); assertEq(card.totalSpent(), 0);
    }
    function testMaxUint64BudgetAndAmountsDoNotOverflow() public {
        AgentSpendingCard.Config memory c = _config(); c.totalLimit = type(uint64).max;
        c.perPaymentLimit = type(uint64).max; c.periodLimit = type(uint64).max;
        vm.prank(OWNER); AgentSpendingCard maxCard = AgentSpendingCard(factory.createCard(c));
        token.mint(address(maxCard), uint256(type(uint64).max)+1);
        vm.prank(GATEWAY); maxCard.reserve(_id(1), RH, EH, _invoice(1), MERCHANT, type(uint64).max, 1200);
        bytes memory sig = _sign(maxCard, 1, 1199, DECISION, GL_TX);
        maxCard.settle(_id(1), 1199, DECISION, GL_TX, sig);
        assertEq(maxCard.totalSpent(), type(uint64).max); assertEq(maxCard.totalReserved(), 0);
        (bool allow, uint8 failures) = maxCard.preview(MERCHANT, 1, 1200); assertTrue(!allow); assertEq(failures, 6);
    }
    function testFuzzRealTapeOutVMMatchesIndependentArithmetic(uint64 amount, uint64 perPayment, uint64 total,
        uint64 period, uint64 from, uint64 now_, uint64 until, uint8 flags) public view {
        bytes memory inputs = new bytes(57);
        uint64[7] memory fields = [amount, perPayment, total, period, from, now_, until];
        for (uint256 f; f < 7; ++f) for (uint256 b; b < 8; ++b) inputs[f*8+b] = bytes1(uint8(fields[f]>>(b*8)));
        inputs[56] = bytes1(flags & 7);
        assertEq(uint8(oracle.eval(1, inputs)[0]), PolicyReference.eval(inputs));
    }

    function _independentDigest(bytes32 requestId, bytes32 requestHash, bytes32 policyHash_, bytes32 evidenceHash,
        uint64 deadline, bytes32 decision, bytes32 genLayerTx) private view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("IntentGuard"), keccak256("1"), uint256(196), address(card)));
        bytes32 release = keccak256(abi.encode(
            keccak256("Release(bytes32 requestId,bytes32 requestHash,bytes32 policyHash,bytes32 evidenceHash,bytes32 decisionHash,bytes32 genLayerTxHash,uint64 validUntil)"),
            requestId, requestHash, policyHash_, evidenceHash, decision, genLayerTx, deadline));
        return keccak256(abi.encodePacked(hex"1901", domain, release));
    }
    function _signatureFor(bytes32 digest, uint256 key) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
    function testIndependentEIP712ReleaseMatchesAndExecutes() public {
        _reserve(1, UNIT, 1200);
        bytes32 independent = _independentDigest(_id(1), RH, POLICY, EH, 1199, DECISION, GL_TX);
        assertEq(card.releaseDigest(_id(1), 1199, DECISION, GL_TX), independent);
        bytes memory signature = _signatureFor(independent, ATTESTOR_KEY);
        card.settle(_id(1), 1199, DECISION, GL_TX, signature);
        assertEq(token.balanceOf(MERCHANT), UNIT);
    }
    function testAlteredSignedRequestPolicyOrEvidenceCannotPaySameReservation() public {
        _reserve(1, UNIT, 1200);
        for (uint256 i; i < 3; ++i) {
            bytes32 digest = _independentDigest(_id(1), i == 0 ? keccak256("altered request") : RH,
                i == 1 ? keccak256("altered policy") : POLICY, i == 2 ? keccak256("altered evidence") : EH,
                1199, DECISION, GL_TX);
            bytes memory signature = _signatureFor(digest, ATTESTOR_KEY);
            vm.expectRevert(AgentSpendingCard.InvalidSignature.selector);
            card.settle(_id(1), 1199, DECISION, GL_TX, signature);
        }
        assertEq(card.totalReserved(), UNIT);
    }
    function testWrongAttestorAndAbsentDecisionHashesCannotPay() public {
        _reserve(1, UNIT, 1200);
        bytes memory signature = _signatureFor(_independentDigest(_id(1), RH, POLICY, EH, 1199, DECISION, GL_TX), 0x1002);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector);
        card.settle(_id(1), 1199, DECISION, GL_TX, signature);
        signature = _sign(card, 1, 1199, bytes32(0), GL_TX);
        vm.expectRevert(AgentSpendingCard.InvalidRequest.selector);
        card.settle(_id(1), 1199, bytes32(0), GL_TX, signature);
        signature = _sign(card, 1, 1199, DECISION, bytes32(0));
        vm.expectRevert(AgentSpendingCard.InvalidRequest.selector);
        card.settle(_id(1), 1199, DECISION, bytes32(0), signature);
    }
    function testPendingReservationCountsAgainstLifetimeBudgetAcrossPeriods() public {
        for (uint256 i = 1; i <= 4; ++i) {
            vm.warp(1000+(i-1)*100); _reserve(i, 100*UNIT, uint64(1100+(i-1)*100));
            _pay(i, uint64(1099+(i-1)*100));
        }
        vm.warp(1400); _reserve(5, 100*UNIT, 1700); vm.warp(1500);
        vm.expectRevert(abi.encodeWithSelector(AgentSpendingCard.PolicyViolation.selector, uint8(2)));
        _reserve(6, 1, 1600);
        _pay(5, 1699); assertEq(card.totalSpent(), 500*UNIT);
    }

    function testStricterPeriodBudgetThanSinglePaymentLimitIsValid() public {
        AgentSpendingCard.Config memory c = _config(); c.periodLimit = 50 * UNIT;
        vm.prank(OWNER); AgentSpendingCard stricter = AgentSpendingCard(factory.createCard(c));
        token.mint(address(stricter), 100 * UNIT);
        (bool allow, uint8 failures) = stricter.preview(MERCHANT, 50 * UNIT, 1200);
        assertTrue(allow); assertEq(failures, 0);
        (allow, failures) = stricter.preview(MERCHANT, 51 * UNIT, 1200);
        assertTrue(!allow); assertEq(failures, 4);
    }
}
