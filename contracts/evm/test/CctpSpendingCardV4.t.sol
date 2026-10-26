// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {AgentSpendingCard} from "../src/AgentSpendingCard.sol";
import {CctpSpendingCardV4} from "../src/CctpSpendingCardV4.sol";
import {CctpCardFactoryV4} from "../src/CctpCardFactoryV4.sol";
import {MainnetUsdt0CardFactory} from "../src/MainnetUsdt0CardFactory.sol";
import {LocalNandProcessor} from "../src/LocalNandProcessor.sol";
import {Vm, MutableBeacon, FaultProcessor} from "./AgentSpendingCard.t.sol";
import {VmBridge} from "./CctpSpendingCard.t.sol";

/// @dev Isolated fault-injection fixtures; these are never used as production issuer evidence.
contract V4TokenDouble {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public paused;
    bool public wrongDecimals;
    bool public failApprove;
    bool public noReturn;
    bool public shortCredit;
    bool public callbackSucceeded;
    address public callbackTarget;
    bytes public callback;
    function decimals() external view returns (uint8) { return wrongDecimals ? 18 : 6; }
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function setPaused(bool value) external { paused = value; }
    function setWrongDecimals(bool value) external { wrongDecimals = value; }
    function setFailApprove(bool value) external { failApprove = value; }
    function setNoReturn(bool value) external { noReturn = value; }
    function setShortCredit(bool value) external { shortCredit = value; }
    function setCallback(address target, bytes calldata data) external { callbackTarget = target; callback = data; }
    function approve(address spender, uint256 value) external returns (bool) {
        if (failApprove) return false;
        allowance[msg.sender][spender] = value;
        if (noReturn) assembly { return(0, 0) }
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(!paused, "paused");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += shortCredit ? amount - 1 : amount;
        if (callbackTarget != address(0)) (callbackSucceeded,) = callbackTarget.call(callback);
        return true;
    }
    function burnFrom(address from, uint256 amount) external {
        allowance[from][msg.sender] -= amount; balanceOf[from] -= amount;
    }
}
contract V4TransmitterDouble {
    bool public paused;
    bool public wrongDomain;
    function localDomain() external view returns (uint32) { return wrongDomain ? 6 : 37; }
    function setPaused(bool value) external { paused = value; }
    function setWrongDomain(bool value) external { wrongDomain = value; }
}
contract V4MinterDouble {
    bool public paused;
    bool public wrongMessenger;
    function localTokenMessenger() external view returns (address) {
        if (wrongMessenger) return address(1);
        return block.chainid == 196 ? 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d : 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    }
    function setPaused(bool value) external { paused = value; }
    function setWrongMessenger(bool value) external { wrongMessenger = value; }
}
contract V4MessengerDouble {
    bool public wrongTransmitter;
    bool public wrongMinter;
    bool public wrongRemote;
    bool public failBurn;
    bool public shortDebit;
    uint256 public fee;
    uint256 public lastAmount;
    uint32 public lastDomain;
    bytes32 public lastRecipient;
    bool public callbackSucceeded;
    bytes public callback;
    function localMessageTransmitter() external view returns (address) {
        if (wrongTransmitter) return address(1);
        return block.chainid == 196 ? 0x81D40F21F12A8F0E3252Bccb954D722d4c464B64 : 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;
    }
    function localMinter() external view returns (address) {
        if (wrongMinter) return address(1);
        return block.chainid == 196 ? 0xfd78EE919681417d192449715b2594ab58f5D002 : 0xb43db544E2c27092c107639Ad201b3dEfAbcF192;
    }
    function remoteTokenMessengers(uint32) external view returns (bytes32) {
        if (wrongRemote) return bytes32(uint256(1));
        return bytes32(uint256(uint160(address(this))));
    }
    function getMinFeeAmount(uint256) external view returns (uint256) { return fee; }
    function setWrongTransmitter(bool value) external { wrongTransmitter = value; }
    function setWrongMinter(bool value) external { wrongMinter = value; }
    function setWrongRemote(bool value) external { wrongRemote = value; }
    function setFailBurn(bool value) external { failBurn = value; }
    function setShortDebit(bool value) external { shortDebit = value; }
    function setFee(uint256 value) external { fee = value; }
    function setCallback(bytes calldata data) external { callback = data; }
    function depositForBurn(uint256 amount, uint32 domain, bytes32 recipient, address burnToken,
        bytes32 caller, uint256 maxFee, uint32 threshold) external {
        require(!failBurn, "issuer unavailable");
        address expected = block.chainid == 196 ? 0xB6CEceAB302E2E4948951eE7843FC24E92933061 : 0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3;
        require(burnToken == expected && caller == bytes32(0) && maxFee == 0 && threshold == 2000, "immutable CCTP arguments");
        require(domain != 37, "not a bridge");
        lastAmount = amount; lastDomain = domain; lastRecipient = recipient;
        if (callback.length != 0) (callbackSucceeded,) = msg.sender.call(callback);
        V4TokenDouble(burnToken).burnFrom(msg.sender, shortDebit ? amount - 1 : amount);
    }
}

abstract contract CctpV4TestBase {
    VmBridge internal constant vm = VmBridge(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant OWNER = address(0xa11ce);
    address internal constant GATEWAY = address(0x600d);
    address internal constant MERCHANT = address(0xbeef);
    address internal constant OUTSIDER = address(0xbad);
    uint256 internal constant SIGNER = 0x1001;
    uint64 internal constant UNIT = 1_000_000;
    bytes32 internal constant RH = keccak256("canonical payment request");
    bytes32 internal constant EH = keccak256("fresh immutable invoice");
    bytes32 internal constant POLICY = keccak256("owner-authorized policy");
    bytes32 internal constant DECISION = keccak256("finalized decision");
    bytes32 internal constant GL_TX = keccak256("GenLayer transaction");
    bytes32 internal constant SOURCE_TX = keccak256("source receipt");
    bytes32 internal constant DEST_TX = keccak256("destination receipt");
    bytes32 internal constant MESSAGE = keccak256("Circle message");
    address internal usdc;
    address internal messengerAddress;
    address internal transmitterAddress;
    address internal minterAddress;
    V4TokenDouble internal token;
    V4MessengerDouble internal messenger;
    V4TransmitterDouble internal transmitter;
    V4MinterDouble internal minter;
    FaultProcessor internal cpu;
    MutableBeacon internal beacon;
    bytes internal netlist;
    CctpSpendingCardV4 internal card;
    CctpCardFactoryV4 internal factory;

    function profileChain() public pure virtual returns (uint256);
    function yes(bool value) internal pure { require(value, "expected true"); }
    function eq(uint256 a, uint256 b) internal pure { require(a == b, "uint equality"); }
    function eq(bytes32 a, bytes32 b) internal pure { require(a == b, "hash equality"); }

    function setUp() public {
        vm.chainId(profileChain()); vm.warp(1000);
        if (profileChain() == 196) {
            usdc = 0xB6CEceAB302E2E4948951eE7843FC24E92933061;
            messengerAddress = 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d;
            transmitterAddress = 0x81D40F21F12A8F0E3252Bccb954D722d4c464B64;
            minterAddress = 0xfd78EE919681417d192449715b2594ab58f5D002;
        } else {
            usdc = 0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3;
            messengerAddress = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
            transmitterAddress = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;
            minterAddress = 0xb43db544E2c27092c107639Ad201b3dEfAbcF192;
        }
        vm.etch(usdc, address(new V4TokenDouble()).code);
        vm.etch(messengerAddress, address(new V4MessengerDouble()).code);
        vm.etch(transmitterAddress, address(new V4TransmitterDouble()).code);
        vm.etch(minterAddress, address(new V4MinterDouble()).code);
        token = V4TokenDouble(usdc); messenger = V4MessengerDouble(messengerAddress);
        transmitter = V4TransmitterDouble(transmitterAddress); minter = V4MinterDouble(minterAddress);
        netlist = vm.readFileBinary(string.concat(vm.projectRoot(), "/../../circuits/artifacts/policy.netlist.bin"));
        LocalNandProcessor oracle = new LocalNandProcessor(netlist);
        cpu = new FaultProcessor(oracle); beacon = new MutableBeacon(address(cpu));
        factory = new CctpCardFactoryV4();
        AgentSpendingCard.Config memory c = config();
        vm.prank(OWNER); card = CctpSpendingCardV4(factory.createCard(c, domains()));
        token.mint(address(card), 1000 * UNIT);
    }
    function config() internal returns (AgentSpendingCard.Config memory c) {
        address[] memory recipients = new address[](1); recipients[0] = MERCHANT;
        c = AgentSpendingCard.Config(OWNER,GATEWAY,vm.addr(SIGNER),usdc,address(cpu),1,address(beacon),address(cpu),
            sha256(netlist),POLICY,500 * UNIT,100 * UNIT,150 * UNIT,100,1000,10000,recipients);
    }
    function domains() internal pure returns (uint32[] memory values) {
        values = new uint32[](11);
        uint32[11] memory fixedDomains = [uint32(0),1,2,3,6,7,10,11,14,19,37];
        for (uint256 i; i < 11; ++i) values[i] = fixedDomains[i];
    }
    function invoice(uint256 n) internal pure returns (bytes32) { return keccak256(abi.encode(MERCHANT,n)); }
    function reserve(uint256 n,uint64 amount,uint32 domain) internal {
        vm.prank(GATEWAY); card.reserveBridge(bytes32(n),RH,EH,invoice(n),MERCHANT,amount,1200,domain);
    }
    function sign(bytes32 digest,uint256 key) internal returns (bytes memory) {
        (uint8 v,bytes32 r,bytes32 s) = vm.sign(key,digest); return abi.encodePacked(r,s,v);
    }
    function burn(uint256 n) internal {
        bytes memory sig = sign(card.releaseDigest(bytes32(n),1199,DECISION,GL_TX),SIGNER);
        card.settle(bytes32(n),1199,DECISION,GL_TX,sig);
    }
    function independentDomain(address target,uint256 chain,string memory version) internal pure returns (bytes32) {
        return keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("IntentGuard"),keccak256(bytes(version)),chain,target));
    }
    function independentRoute(uint32 domain,address recipient,uint64 amount) internal pure returns (bytes32) {
        return keccak256(abi.encode(domain,bytes32(uint256(uint160(recipient))),amount,uint256(0),uint32(2000),bytes32(0)));
    }
    function independentRelease(uint256 n,bytes32 requestHash,bytes32 evidence,bytes32 policy,uint32 domain,
        address recipient,uint64 amount,uint256 chain,string memory version) internal view returns (bytes32) {
        bytes32 value = keccak256(abi.encode(keccak256("BridgeRelease(bytes32 requestId,bytes32 requestHash,bytes32 policyHash,bytes32 evidenceHash,bytes32 decisionHash,bytes32 genLayerTxHash,uint64 validUntil,bytes32 routeHash)"),
            bytes32(n),requestHash,policy,evidence,DECISION,GL_TX,uint64(1199),independentRoute(domain,recipient,amount)));
        return keccak256(abi.encodePacked(hex"1901",independentDomain(address(card),chain,version),value));
    }
    function independentReceipt(uint256 n,bytes32 source,bytes32 dest,bytes32 message,uint64 amount,address target)
        internal pure returns (bytes32) {
        bytes32 value = keccak256(abi.encode(keccak256("BridgeReceipt(bytes32 requestId,bytes32 requestHash,bytes32 routeHash,bytes32 sourceTxHash,bytes32 destinationTxHash,bytes32 messageHash,uint64 amount)"),
            bytes32(n),RH,independentRoute(6,MERCHANT,UNIT),source,dest,message,amount));
        return keccak256(abi.encodePacked(hex"1901",independentDomain(target,profileChain(),"4"),value));
    }
    function confirm(uint256 n) internal {
        bytes memory sig = sign(independentReceipt(n,SOURCE_TX,DEST_TX,MESSAGE,UNIT,address(card)),SIGNER);
        card.confirmBridge(bytes32(n),SOURCE_TX,DEST_TX,MESSAGE,sig);
    }

    function testSourceAndFactoryIdentityPinned() public view {
        yes(card.token() == usdc && card.SOURCE_USDC() == usdc && card.TOKEN_MESSENGER() == messengerAddress);
        yes(card.MESSAGE_TRANSMITTER() == transmitterAddress && card.TOKEN_MINTER() == minterAddress);
        eq(card.sourceChainId(),profileChain()); eq(factory.sourceChainId(),profileChain());
        eq(card.sourceTokenCodeHash(),usdc.codehash); eq(card.messengerCodeHash(),messengerAddress.codehash);
        yes(factory.isCard(address(card))); eq(factory.cardsOf(OWNER).length,1);
        eq(card.allowedDomains().length,11); eq(card.domainSeparator(),independentDomain(address(card),profileChain(),"4"));
    }
    function testFactoryCreationCodeStoresAreFixedAndDeployable() public view {
        yes(address(factory).code.length <= 24_576);
        yes(factory.creationPrefix().code.length <= 24_576 && factory.creationSuffix().code.length <= 24_576);
        eq(factory.creationPrefixLength() + factory.creationSuffixLength(),type(CctpSpendingCardV4).creationCode.length);
        eq(factory.creationPrefix().codehash,factory.creationPrefixCodeHash());
        eq(factory.creationSuffix().codehash,factory.creationSuffixCodeHash());
        yes(factory.creationPrefix().code[0] == 0x00 && factory.creationSuffix().code[0] == 0x00);
    }
    function testFactoryRejectsTamperedCreationCodeStore() public {
        AgentSpendingCard.Config memory c = config();
        vm.etch(factory.creationPrefix(),hex"00");
        vm.expectRevert(CctpCardFactoryV4.CreationCodeChanged.selector); vm.prank(OWNER); factory.createCard(c,domains());
    }
    function testEveryDestinationMatchesIndependentIssuerTable() public view {
        uint32[] memory ids = domains();
        uint256[11] memory mainChains = [uint256(1),43114,10,42161,8453,137,130,59144,480,999,196];
        uint256[11] memory testChains = [uint256(11155111),43113,11155420,421614,84532,80002,1301,59141,4801,998,1952];
        address[11] memory mainTokens = [
            0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E,
            0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85,0xaf88d065e77c8cC2239327C5EDb3A432268e5831,
            0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359,
            0x078D782b760474a361dDA0AF3839290b0EF57AD6,0x176211869cA2b568f2A7D4EE941E073a821EE1ff,
            0x79A02482A880bCE3F13e09Da970dC34db4CD24d1,0xb88339CB7199b77E23DB6E890353E22632Ba630f,
            0xB6CEceAB302E2E4948951eE7843FC24E92933061
        ];
        address[11] memory testTokens = [
            0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238,0x5425890298aed601595a70AB815c96711a31Bc65,
            0x5fd84259d66Cd46123540766Be93DFE6D43130D7,0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d,
            0x036CbD53842c5426634e7929541eC2318f3dCF7e,0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582,
            0x31d0220469e10c4E71834a79b1f276d740d3768F,0xFEce4462D57bD51A6A552365A011b95f0E16d9B7,
            0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88,0x2B3370eE501B4a559b57D449569354196457D8Ab,
            0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3
        ];
        for (uint256 i; i < 11; ++i) {
            eq(card.destinationChainId(ids[i]),profileChain() == 196 ? mainChains[i] : testChains[i]);
            yes(card.destinationToken(ids[i]) == (profileChain() == 196 ? mainTokens[i] : testTokens[i]));
            yes(card.domainAllowed(ids[i]));
        }
    }
    function testAllTenCrossChainRoutesBurnExactAmountAndNoLocalPaymentEvent() public {
        uint32[] memory ids = domains();
        for (uint256 i; i < 10; ++i) {
            reserve(i + 1,UNIT,ids[i]); vm.recordLogs(); burn(i + 1);
            VmBridge.Log[] memory logs = vm.getRecordedLogs();
            uint256 started;
            for (uint256 j; j < logs.length; ++j) if (logs[j].emitter == address(card)) {
                yes(logs[j].topics[0] != keccak256("Paid(bytes32,bytes32,bytes32,address,uint64)"));
                if (logs[j].topics[0] == keccak256("BridgeStarted(bytes32,uint32,bytes32,address,uint64,bytes32,bytes32)")) started++;
            }
            eq(started,1); eq(messenger.lastDomain(),ids[i]); eq(messenger.lastAmount(),UNIT);
            eq(messenger.lastRecipient(),bytes32(uint256(uint160(MERCHANT))));
            eq(uint256(card.getRequest(bytes32(i + 1)).status),5);
            eq(token.allowance(address(card),messengerAddress),0);
        }
        eq(token.balanceOf(MERCHANT),0); eq(token.balanceOf(address(card)),990 * UNIT);
        eq(card.totalSpent(),10 * UNIT); eq(card.totalReserved(),0);
    }
    function testSourceLocalSettlementUsesV4SignatureAndExactCredit() public {
        vm.prank(GATEWAY); card.reserve(bytes32(uint256(1)),RH,EH,invoice(1),MERCHANT,UNIT,1200);
        bytes32 value = keccak256(abi.encode(keccak256("Release(bytes32 requestId,bytes32 requestHash,bytes32 policyHash,bytes32 evidenceHash,bytes32 decisionHash,bytes32 genLayerTxHash,uint64 validUntil)"),
            bytes32(uint256(1)),RH,POLICY,EH,DECISION,GL_TX,uint64(1199)));
        eq(card.releaseDigest(bytes32(uint256(1)),1199,DECISION,GL_TX),keccak256(abi.encodePacked(hex"1901",independentDomain(address(card),profileChain(),"4"),value)));
        burn(1); eq(token.balanceOf(MERCHANT),UNIT); eq(messenger.lastAmount(),0);
        eq(uint256(card.getRequest(bytes32(uint256(1))).status),2);
    }
    function testWrongLocalTokenCreditRollsBackPaidAndLedger() public {
        vm.prank(GATEWAY); card.reserve(bytes32(uint256(1)),RH,EH,invoice(1),MERCHANT,UNIT,1200);
        token.setShortCredit(true);
        bytes memory sig = sign(card.releaseDigest(bytes32(uint256(1)),1199,DECISION,GL_TX),SIGNER);
        vm.expectRevert(CctpSpendingCardV4.BridgeAmountMismatch.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        eq(card.totalSpent(),0); eq(card.totalReserved(),UNIT); eq(token.balanceOf(MERCHANT),0);
    }
    function testFactoryRejectsForgedOwnerAndChangedChain() public {
        AgentSpendingCard.Config memory c = config();
        vm.expectRevert(AgentSpendingCard.Unauthorized.selector); factory.createCard(c,domains());
        vm.chainId(profileChain() == 196 ? 1952 : 196);
        vm.expectRevert(CctpSpendingCardV4.UnsupportedAssetOrChain.selector); vm.prank(OWNER); factory.createCard(c,domains());
    }
    function testConstructorRejectsUnsupportedChainOrSyntheticToken() public {
        AgentSpendingCard.Config memory c = config(); vm.chainId(1);
        vm.expectRevert(CctpSpendingCardV4.UnsupportedAssetOrChain.selector); new CctpCardFactoryV4();
        vm.expectRevert(CctpSpendingCardV4.UnsupportedAssetOrChain.selector); new CctpSpendingCardV4(c,domains());
        vm.chainId(profileChain()); c.token = address(new V4TokenDouble());
        vm.expectRevert(CctpSpendingCardV4.UnsupportedAssetOrChain.selector); new CctpSpendingCardV4(c,domains());
    }
    function testConstructorRejectsOtherEnvironmentAsset() public {
        AgentSpendingCard.Config memory c = config();
        c.token = profileChain() == 196 ? 0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3 : 0xB6CEceAB302E2E4948951eE7843FC24E92933061;
        vm.etch(c.token,address(new V4TokenDouble()).code);
        vm.expectRevert(CctpSpendingCardV4.UnsupportedAssetOrChain.selector); new CctpSpendingCardV4(c,domains());
    }
    function testEmptyDuplicateOversizedAndUnknownRoutesReject() public {
        AgentSpendingCard.Config memory c = config();
        vm.expectRevert(CctpSpendingCardV4.UnsupportedDestination.selector); new CctpSpendingCardV4(c,new uint32[](0));
        vm.expectRevert(CctpSpendingCardV4.UnsupportedDestination.selector); new CctpSpendingCardV4(c,new uint32[](12));
        uint32[] memory ids = domains(); ids[1] = ids[0];
        vm.expectRevert(CctpSpendingCardV4.UnsupportedDestination.selector); new CctpSpendingCardV4(c,ids);
        ids[1] = 5;
        vm.expectRevert(bytes4(keccak256("UnsupportedDestination()"))); new CctpSpendingCardV4(c,ids);
        vm.expectRevert(bytes4(keccak256("UnsupportedDestination()"))); card.destinationToken(5);
    }
    function testRouteSubsetAndLocalPermissionCannotBeBypassed() public {
        AgentSpendingCard.Config memory c = config(); uint32[] memory ids = new uint32[](1); ids[0] = 6;
        vm.prank(OWNER); CctpSpendingCardV4 baseOnly = CctpSpendingCardV4(factory.createCard(c,ids)); token.mint(address(baseOnly),UNIT);
        vm.expectRevert(CctpSpendingCardV4.UnsupportedDestination.selector); vm.prank(GATEWAY);
        baseOnly.reserve(bytes32(uint256(1)),RH,EH,invoice(1),MERCHANT,UNIT,1200);
        vm.expectRevert(CctpSpendingCardV4.UnsupportedDestination.selector); vm.prank(GATEWAY);
        baseOnly.reserveBridge(bytes32(uint256(1)),RH,EH,invoice(1),MERCHANT,UNIT,1200,3);
        vm.expectRevert(CctpSpendingCardV4.UnsupportedDestination.selector); reserve(1,UNIT,37);
        vm.expectRevert(CctpSpendingCardV4.UnsupportedDestination.selector); reserve(1,UNIT,5);
    }
    function testGatewayBudgetAndRecipientGuardsPreserved() public {
        vm.expectRevert(AgentSpendingCard.Unauthorized.selector);
        card.reserveBridge(bytes32(uint256(1)),RH,EH,invoice(1),MERCHANT,UNIT,1200,6);
        vm.expectRevert(abi.encodeWithSelector(AgentSpendingCard.PolicyViolation.selector,uint8(1))); reserve(1,101 * UNIT,6);
        vm.expectRevert(abi.encodeWithSelector(AgentSpendingCard.PolicyViolation.selector,uint8(16))); vm.prank(GATEWAY);
        card.reserveBridge(bytes32(uint256(1)),RH,EH,invoice(1),OUTSIDER,UNIT,1200,6);
    }
    function testRouteAndReleaseCommitmentsIndependent() public {
        reserve(1,UNIT,6);
        eq(card.getBridgeRequest(bytes32(uint256(1))).routeHash,independentRoute(6,MERCHANT,UNIT));
        eq(card.releaseDigest(bytes32(uint256(1)),1199,DECISION,GL_TX),independentRelease(1,RH,EH,POLICY,6,MERCHANT,UNIT,profileChain(),"4"));
    }
    function testEveryCommitmentMutationAndLegacyDomainCannotBurn() public {
        reserve(1,UNIT,6);
        for (uint256 i; i < 9; ++i) {
            bytes32 digest = independentRelease(i == 0 ? 2 : 1,i == 1 ? bytes32(uint256(9)) : RH,i == 2 ? bytes32(uint256(9)) : EH,
                i == 3 ? bytes32(uint256(9)) : POLICY,i == 4 ? 3 : 6,i == 5 ? OUTSIDER : MERCHANT,i == 6 ? 2 * UNIT : UNIT,
                i == 7 ? (profileChain() == 196 ? 1952 : 196) : profileChain(),i == 8 ? "2" : "4");
            bytes memory sig = sign(digest,SIGNER);
            vm.expectRevert(AgentSpendingCard.InvalidSignature.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        }
        eq(card.totalSpent(),0); eq(token.balanceOf(address(card)),1000 * UNIT);
    }
    function testIndependentReceiptAndDuplicateAcknowledgement() public {
        reserve(1,UNIT,6); burn(1);
        eq(card.bridgeReceiptDigest(bytes32(uint256(1)),SOURCE_TX,DEST_TX,MESSAGE),independentReceipt(1,SOURCE_TX,DEST_TX,MESSAGE,UNIT,address(card)));
        confirm(1); eq(uint256(card.getRequest(bytes32(uint256(1))).status),2);
        eq(token.balanceOf(address(card)),999 * UNIT); eq(card.totalSpent(),UNIT);
        vm.expectRevert(CctpSpendingCardV4.NotBridging.selector); confirm(1);
    }
    function testEveryReceiptFieldMutationAndWrongAttestorRejected() public {
        reserve(1,UNIT,6); burn(1);
        for (uint256 i; i < 5; ++i) {
            bytes memory sig = sign(independentReceipt(1,i == 0 ? bytes32(uint256(1)) : SOURCE_TX,
                i == 1 ? bytes32(uint256(1)) : DEST_TX,i == 2 ? bytes32(uint256(1)) : MESSAGE,i == 3 ? 2 * UNIT : UNIT,address(card)),
                i == 4 ? SIGNER + 1 : SIGNER);
            vm.expectRevert(AgentSpendingCard.InvalidSignature.selector);
            card.confirmBridge(bytes32(uint256(1)),SOURCE_TX,DEST_TX,MESSAGE,sig);
        }
        bytes memory valid = sign(independentReceipt(1,SOURCE_TX,DEST_TX,MESSAGE,UNIT,address(card)),SIGNER);
        for (uint256 i; i < 3; ++i) {
            vm.expectRevert(AgentSpendingCard.InvalidRequest.selector);
            card.confirmBridge(bytes32(uint256(1)),i == 0 ? bytes32(0) : SOURCE_TX,i == 1 ? bytes32(0) : DEST_TX,i == 2 ? bytes32(0) : MESSAGE,valid);
        }
        eq(uint256(card.getRequest(bytes32(uint256(1))).status),5); confirm(1);
    }
    function testNoReceiptBeforeBurnAndNoCancellationOrExpiryAfterBurn() public {
        reserve(1,UNIT,6);
        vm.expectRevert(CctpSpendingCardV4.NotBridging.selector); confirm(1);
        burn(1); vm.prank(OWNER); vm.expectRevert(AgentSpendingCard.NotReserved.selector); card.cancel(bytes32(uint256(1)));
        vm.warp(1300); vm.expectRevert(AgentSpendingCard.NotReserved.selector); card.expire(bytes32(uint256(1)));
        eq(card.invoiceRequest(invoice(1)),bytes32(uint256(1))); eq(card.totalSpent(),UNIT);
    }
    function testReceiptStillReconcilesAfterRevocationExpiryAndIssuerOutage() public {
        reserve(1,UNIT,6); burn(1); vm.prank(OWNER); card.revoke(); vm.warp(11000);
        vm.etch(messengerAddress,hex"00"); confirm(1);
        eq(uint256(card.getRequest(bytes32(uint256(1))).status),2); eq(card.totalSpent(),UNIT);
    }
    function testSignaturesCannotReplayAcrossCardsOrRequests() public {
        reserve(1,UNIT,6); reserve(2,UNIT,6);
        bytes memory sig = sign(card.releaseDigest(bytes32(uint256(1)),1199,DECISION,GL_TX),SIGNER);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector); card.settle(bytes32(uint256(2)),1199,DECISION,GL_TX,sig);
        AgentSpendingCard.Config memory c = config(); vm.prank(OWNER);
        CctpSpendingCardV4 other = CctpSpendingCardV4(factory.createCard(c,domains())); token.mint(address(other),UNIT);
        vm.prank(GATEWAY); other.reserveBridge(bytes32(uint256(1)),RH,EH,invoice(1),MERCHANT,UNIT,1200,6);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector); other.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        sig = sign(other.releaseDigest(bytes32(uint256(1)),1199,DECISION,GL_TX),SIGNER);
        other.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig); burn(1);
        sig = sign(independentReceipt(1,SOURCE_TX,DEST_TX,MESSAGE,UNIT,address(card)),SIGNER);
        vm.expectRevert(AgentSpendingCard.InvalidSignature.selector); other.confirmBridge(bytes32(uint256(1)),SOURCE_TX,DEST_TX,MESSAGE,sig);
    }
    function testChangedChainCannotReserveBurnOrAcknowledge() public {
        reserve(1,UNIT,6); burn(1); vm.chainId(profileChain() == 196 ? 1952 : 196);
        vm.expectRevert(CctpSpendingCardV4.UnsupportedAssetOrChain.selector); reserve(2,UNIT,6);
        bytes memory sig = sign(card.bridgeReceiptDigest(bytes32(uint256(1)),SOURCE_TX,DEST_TX,MESSAGE),SIGNER);
        vm.expectRevert(CctpSpendingCardV4.UnsupportedAssetOrChain.selector); card.confirmBridge(bytes32(uint256(1)),SOURCE_TX,DEST_TX,MESSAGE,sig);
    }
    function testPauseAndProcessorMutationBlockSignedBurn() public {
        reserve(1,UNIT,6); bytes memory sig = sign(card.releaseDigest(bytes32(uint256(1)),1199,DECISION,GL_TX),SIGNER);
        vm.prank(OWNER); card.setEnabled(false);
        vm.expectRevert(AgentSpendingCard.Disabled.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        vm.prank(OWNER); card.setEnabled(true); beacon.upgradeTo(OUTSIDER);
        vm.expectRevert(AgentSpendingCard.ProcessorChanged.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        eq(card.totalReserved(),UNIT);
    }
    function testInfrastructureRelationshipsPausesAndRemoteMappingFailClosed() public {
        reserve(1,UNIT,6); bytes memory sig = sign(card.releaseDigest(bytes32(uint256(1)),1199,DECISION,GL_TX),SIGNER);
        messenger.setWrongTransmitter(true);
        vm.expectRevert(CctpSpendingCardV4.SourceInfrastructureChanged.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        messenger.setWrongTransmitter(false); messenger.setWrongMinter(true);
        vm.expectRevert(CctpSpendingCardV4.SourceInfrastructureChanged.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        messenger.setWrongMinter(false); minter.setWrongMessenger(true);
        vm.expectRevert(CctpSpendingCardV4.SourceInfrastructureChanged.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        minter.setWrongMessenger(false); transmitter.setWrongDomain(true);
        vm.expectRevert(CctpSpendingCardV4.SourceInfrastructureChanged.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        transmitter.setWrongDomain(false); transmitter.setPaused(true);
        vm.expectRevert(CctpSpendingCardV4.SourceInfrastructureChanged.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        transmitter.setPaused(false); minter.setPaused(true);
        vm.expectRevert(CctpSpendingCardV4.SourceInfrastructureChanged.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        minter.setPaused(false); messenger.setWrongRemote(true);
        vm.expectRevert(CctpSpendingCardV4.UnsupportedDestination.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        messenger.setWrongRemote(false); burn(1);
    }
    function testInfrastructureAndTokenRuntimeCodeChangesFailClosed() public {
        reserve(1,UNIT,6); bytes memory sig = sign(card.releaseDigest(bytes32(uint256(1)),1199,DECISION,GL_TX),SIGNER);
        bytes memory oldMessenger = messengerAddress.code; vm.etch(messengerAddress,hex"00");
        vm.expectRevert(CctpSpendingCardV4.MessengerChanged.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        vm.etch(messengerAddress,oldMessenger); bytes memory oldTransmitter = transmitterAddress.code; vm.etch(transmitterAddress,hex"00");
        vm.expectRevert(CctpSpendingCardV4.SourceInfrastructureChanged.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        vm.etch(transmitterAddress,oldTransmitter); bytes memory oldMinter = minterAddress.code; vm.etch(minterAddress,hex"00");
        vm.expectRevert(CctpSpendingCardV4.SourceInfrastructureChanged.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        vm.etch(minterAddress,oldMinter); bytes memory oldToken = usdc.code; vm.etch(usdc,hex"00");
        // The base circuit reads balanceOf before delivery; a missing token interface reverts without data.
        vm.expectRevert(bytes("")); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        vm.etch(usdc,oldToken); burn(1);
    }
    function testFeeChangeAndTokenPauseDoNotConsumeReservation() public {
        reserve(1,UNIT,6); bytes memory sig = sign(card.releaseDigest(bytes32(uint256(1)),1199,DECISION,GL_TX),SIGNER);
        messenger.setFee(1);
        vm.expectRevert(CctpSpendingCardV4.TransferFeeRequired.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        messenger.setFee(0); token.setPaused(true);
        vm.expectRevert(CctpSpendingCardV4.SourceInfrastructureChanged.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        token.setPaused(false); token.setWrongDecimals(true);
        vm.expectRevert(CctpSpendingCardV4.SourceInfrastructureChanged.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        token.setWrongDecimals(false); eq(card.totalReserved(),UNIT); burn(1);
    }
    function testBurnFailureDebitAndApprovalRollBackEntireSettlement() public {
        reserve(1,UNIT,6); bytes memory sig = sign(card.releaseDigest(bytes32(uint256(1)),1199,DECISION,GL_TX),SIGNER);
        messenger.setFailBurn(true);
        vm.expectRevert(bytes("issuer unavailable")); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        messenger.setFailBurn(false); messenger.setShortDebit(true);
        vm.expectRevert(CctpSpendingCardV4.BridgeAmountMismatch.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        messenger.setShortDebit(false); token.setFailApprove(true);
        vm.expectRevert(AgentSpendingCard.TokenTransferFailed.selector); card.settle(bytes32(uint256(1)),1199,DECISION,GL_TX,sig);
        token.setFailApprove(false);
        eq(card.totalReserved(),UNIT); eq(card.totalSpent(),0); eq(token.allowance(address(card),messengerAddress),0);
        eq(token.balanceOf(address(card)),1000 * UNIT); token.setNoReturn(true); burn(1);
    }
    function testIssuerAndTokenCallbacksCannotReenterSettlementOrReceipt() public {
        reserve(1,UNIT,6);
        bytes memory sig = sign(independentReceipt(1,SOURCE_TX,DEST_TX,MESSAGE,UNIT,address(card)),SIGNER);
        messenger.setCallback(abi.encodeCall(card.confirmBridge,(bytes32(uint256(1)),SOURCE_TX,DEST_TX,MESSAGE,sig)));
        burn(1); yes(!messenger.callbackSucceeded()); eq(uint256(card.getRequest(bytes32(uint256(1))).status),5); confirm(1);
        vm.prank(GATEWAY); card.reserve(bytes32(uint256(2)),RH,EH,invoice(2),MERCHANT,UNIT,1200);
        sig = sign(card.releaseDigest(bytes32(uint256(2)),1199,DECISION,GL_TX),SIGNER);
        token.setCallback(address(card),abi.encodeCall(card.settle,(bytes32(uint256(2)),uint64(1199),DECISION,GL_TX,sig)));
        burn(2); yes(!token.callbackSucceeded()); eq(card.totalSpent(),2 * UNIT);
    }
    function testCancellationBeforeBurnReleasesInvoiceButNeverReplaysRequest() public {
        reserve(1,UNIT,6); vm.prank(OWNER); card.cancel(bytes32(uint256(1)));
        eq(card.totalReserved(),0); eq(card.invoiceRequest(invoice(1)),bytes32(0));
        vm.expectRevert(AgentSpendingCard.AlreadyUsed.selector); reserve(1,UNIT,6);
        vm.prank(GATEWAY); card.reserveBridge(bytes32(uint256(2)),RH,EH,invoice(1),MERCHANT,UNIT,1200,3); burn(2);
    }
    function testBudgetsAndWithdrawalAcrossPeriodsIncludeBurnedFunds() public {
        reserve(1,100 * UNIT,6); burn(1);
        vm.expectRevert(abi.encodeWithSelector(AgentSpendingCard.PolicyViolation.selector,uint8(4))); reserve(2,51 * UNIT,3);
        vm.warp(1100); reserve(2,100 * UNIT,3); burn(2); eq(card.totalSpent(),200 * UNIT);
        (uint64 spent0,uint64 reserved0) = card.periods(0); eq(spent0,100 * UNIT); eq(reserved0,0);
        (uint64 spent1,uint64 reserved1) = card.periods(1); eq(spent1,100 * UNIT); eq(reserved1,0);
        vm.prank(OWNER); card.withdraw(800 * UNIT); eq(token.balanceOf(OWNER),800 * UNIT); eq(token.balanceOf(address(card)),0);
    }
    function testFuzzExactBurnAndAccounting(uint64 input,uint8 route) public {
        uint64 amount = uint64(uint256(input) % (100 * UNIT)) + 1;
        uint32[] memory ids = domains(); reserve(1,amount,ids[route % 10]); burn(1);
        eq(card.totalSpent(),amount); eq(card.totalReserved(),0); eq(token.balanceOf(address(card)),1000 * UNIT - amount);
        eq(token.allowance(address(card),messengerAddress),0); eq(messenger.lastAmount(),amount);
    }
}
contract CctpV4MainnetTest is CctpV4TestBase {
    function profileChain() public pure override returns (uint256) { return 196; }
}
contract CctpV4TestnetTest is CctpV4TestBase {
    function profileChain() public pure override returns (uint256) { return 1952; }
}

contract MainnetUsdt0FactoryTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant OWNER = address(0xa11ce);
    address internal constant GATEWAY = address(0x600d);
    address internal constant MERCHANT = address(0xbeef);
    address internal constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    uint256 internal constant SIGNER = 0x1001;
    bytes internal netlist;
    FaultProcessor internal cpu;
    MutableBeacon internal beacon;
    MainnetUsdt0CardFactory internal factory;
    V4TokenDouble internal token;
    function setUp() public {
        vm.chainId(196); vm.warp(1000); vm.etch(USDT0,address(new V4TokenDouble()).code); token = V4TokenDouble(USDT0);
        netlist = vm.readFileBinary(string.concat(vm.projectRoot(),"/../../circuits/artifacts/policy.netlist.bin"));
        cpu = new FaultProcessor(new LocalNandProcessor(netlist)); beacon = new MutableBeacon(address(cpu));
        factory = new MainnetUsdt0CardFactory();
    }
    function config() internal returns (AgentSpendingCard.Config memory c) {
        address[] memory recipients = new address[](1); recipients[0] = MERCHANT;
        c = AgentSpendingCard.Config(OWNER,GATEWAY,vm.addr(SIGNER),USDT0,address(cpu),1,address(beacon),address(cpu),
            sha256(netlist),keccak256("USDT0 policy"),500_000_000,100_000_000,150_000_000,100,1000,10000,recipients);
    }
    function testOnlyOfficialMainnetAssetCreatesStandardLocalCard() public {
        AgentSpendingCard.Config memory c = config(); vm.prank(OWNER);
        AgentSpendingCard card = AgentSpendingCard(factory.createCard(c));
        require(card.token() == USDT0 && factory.isCard(address(card)) && factory.cardsOf(OWNER).length == 1,"issuer card");
        token.mint(address(card),1_000_000);
        vm.prank(GATEWAY); card.reserve(bytes32(uint256(1)),keccak256("request"),keccak256("evidence"),keccak256("invoice"),MERCHANT,1_000_000,1200);
        (uint8 v,bytes32 r,bytes32 s) = vm.sign(SIGNER,card.releaseDigest(bytes32(uint256(1)),1199,keccak256("decision"),keccak256("GL")));
        card.settle(bytes32(uint256(1)),1199,keccak256("decision"),keccak256("GL"),abi.encodePacked(r,s,v));
        require(token.balanceOf(MERCHANT) == 1_000_000 && uint256(card.getRequest(bytes32(uint256(1))).status) == 2,"local transfer");
        (bool ok,) = address(card).call(abi.encodeWithSignature("reserveBridge(bytes32,bytes32,bytes32,bytes32,address,uint64,uint64,uint32)",
            bytes32(uint256(2)),keccak256("request"),keccak256("evidence"),keccak256("invoice2"),MERCHANT,uint64(1_000_000),uint64(1200),uint32(6)));
        require(!ok,"USDT0 has no bridge");
    }
    function testTestnetFactoryAndCreationRefuse() public {
        AgentSpendingCard.Config memory c = config(); vm.chainId(1952);
        vm.expectRevert(MainnetUsdt0CardFactory.UnsupportedAssetOrChain.selector); new MainnetUsdt0CardFactory();
        vm.expectRevert(MainnetUsdt0CardFactory.UnsupportedAssetOrChain.selector); vm.prank(OWNER); factory.createCard(c);
    }
    function testDifferentTokenAndForgedOwnerReject() public {
        AgentSpendingCard.Config memory c = config();
        vm.expectRevert(AgentSpendingCard.Unauthorized.selector); factory.createCard(c);
        c.token = address(new V4TokenDouble());
        vm.expectRevert(MainnetUsdt0CardFactory.UnsupportedAssetOrChain.selector); vm.prank(OWNER); factory.createCard(c);
    }
    function testMissingIssuerCodeRejects() public {
        vm.etch(USDT0,"");
        vm.expectRevert(MainnetUsdt0CardFactory.UnsupportedAssetOrChain.selector); new MainnetUsdt0CardFactory();
    }
    function testChangedIssuerCodeAndDecimalsRefuseNewCard() public {
        AgentSpendingCard.Config memory c = config(); token.setWrongDecimals(true);
        vm.expectRevert(MainnetUsdt0CardFactory.UnsupportedAssetOrChain.selector); vm.prank(OWNER); factory.createCard(c);
        token.setWrongDecimals(false); vm.etch(USDT0,hex"00");
        vm.expectRevert(MainnetUsdt0CardFactory.UnsupportedAssetOrChain.selector); vm.prank(OWNER); factory.createCard(c);
    }
}
