# IntentGuard spending cards

`AgentSpendingCard` holds only the owner's deposited token. Its owner, gateway,
attestor, token, TapeOut circuit and policy are immutable. Gateway credentials can
reserve at most two requests, and each reservation immediately consumes lifetime,
original-period and funded-balance capacity. Owner withdrawals can only remove
unreserved funds and work independently of evaluator availability or upgrades.

`CardFactory.createCard(Config)` requires caller == config.owner and emits
CardCreated(owner, card, policyHash). No transfer approval gives an agent access to
owner EOA assets: funding is a normal owner-directed USDT transfer to the card.

Build and verify:

```sh
forge build --root contracts/evm
node contracts/evm/export-abi.mjs
node tools/check.mjs evm
node tools/check.mjs circuit
```

The exported `abi.json` includes CardFactory/AgentSpendingCard arrays, local test
processor arrays, configTuple.components, request statuses and the EIP712 release
fields. The Solidity Config order follows docs/CONTRACT.md exactly. Uint64 amounts
are atomic USDT units (6 decimals); no decimal float is accepted.

Reserve signature:
`reserve(bytes32 requestId, bytes32 requestHash, bytes32 evidenceHash, bytes32 invoiceKey, address recipient, uint64 amount, uint64 expiresAt)`.
Reserved emits all immutable request fields. getRequest(id) returns their stored
values and status. Statuses are NONE=0, RESERVED=1, PAID=2, CANCELLED=3, EXPIRED=4.

A successful finalized GenLayer decision is bridged by the configured attestor.
EIP712 domain is IntentGuard / 1 / current chain ID / this card. Release fields:
requestId, requestHash, policyHash, evidenceHash, decisionHash, genLayerTxHash
(all bytes32), validUntil (uint64). Solidity's attestationValidUntil parameter is
the typed field validUntil. Deadline must be <= request.expiresAt, and settlement
requires now < deadline, request expiry and policy validUntil. GenLayer finality
is the attestor's responsibility; the vault does not pretend to validate that
foreign consensus itself. Attestor signatures bind the exact stored request and
evidence. Third parties can deliver a valid signature. Low-s signatures only.

Settlement re-evaluates the genuine processor with its own reservation excluded
from remaining budget, then converts that reservation into spending. A rollover
charges the original period, avoiding reset-driven overspend. Paid request IDs
and invoice keys cannot replay. Cancellation/expiry permanently burn the request
ID but free its invoice key, permitting a corrected request. Pausing and permanent
revocation stop previously signed settlements.

TapeOut ICPU eval(uint256,bytes) is the runtime gate; no Solidity arithmetic
reference evaluator is used for live permission decisions. The vault pins CPU
code, circuit implementation code, beacon implementation, input/output metadata,
and SHA-256(raw netlist). Token flag is true because the card's asset is immutable.
Independent checked ledger arithmetic and actual funding protect reservations.

Local integration can deploy, in order:
1. LocalNandProcessor(raw circuits/artifacts/policy.netlist.bin), circuitId 1.
2. LocalProcessorBeacon(local processor address).
3. CardFactory, then createCard with token/owner/gateway/attestor on a local chain.
Set processor and expectedImplementation to that local processor, beacon to the
local beacon, expectedNetlistHash to metadata.sha256. Artifacts are in
out/LocalNandProcessor.sol/{LocalNandProcessor,LocalProcessorBeacon}.json.

LocalNandProcessor runs the unmodified MIT TapeOut NetlistVM as an independent
oracle. It is never a production deployment claim. Production configuration must
be read from the actual TapeOut CPU/circuit and beacon before wallet activation.
No mainnet transaction has been broadcast by this implementation task.
