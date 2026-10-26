# V4 native stablecoin contract validation

This report covers local contract behavior at the production-readiness implementation stage. **No mainnet contract was broadcast or funded by this work.** Live issuer/RPC verification, official TapeOut deployment, a reviewed cost quote and mainnet canaries remain release gates R10/R18/R26.

The deployed testnet `AgentSpendingCard`, `CardFactory`, `CctpSpendingCard` and `CctpCardFactory` source and exported ABI entries remain unchanged from baseline `63ecc771b3313419f6df7f483e1b2964024570a6`. New versions do not silently migrate existing cards or their reviewers.

## New interfaces and constraints

`CctpSpendingCardV4(Config,uint32[])` derives its immutable source profile from deployment chain 196 or 1952. It admits only that chain's Circle-issued native USDC. It exposes `sourceChainId`, `SOURCE_USDC`, `TOKEN_MESSENGER`, `MESSAGE_TRANSMITTER`, `TOKEN_MINTER`, `destinationChainId(domain)` and `destinationToken(domain)`. Owners choose a nonempty immutable subset of up to eleven domains, including local X Layer domain37 and the ten approved EVM destinations.

| Domain | Mainnet chain | Matching testnet |
|---:|---:|---:|
| 0 | Ethereum 1 | Sepolia 11155111 |
| 1 | Avalanche 43114 | Fuji 43113 |
| 2 | Optimism 10 | OP Sepolia 11155420 |
| 3 | Arbitrum 42161 | Arbitrum Sepolia 421614 |
| 6 | Base 8453 | Base Sepolia 84532 |
| 7 | Polygon 137 | Amoy 80002 |
| 10 | Unichain 130 | Unichain Sepolia 1301 |
| 11 | Linea 59144 | Linea Sepolia 59141 |
| 14 | World Chain 480 | World Chain Sepolia 4801 |
| 19 | HyperEVM 999 | HyperEVM testnet 998 |
| 37 | X Layer 196 | X Layer testnet 1952 |

Version4 retains the existing reserve, reserveBridge, settle, releaseDigest, bridgeReceiptDigest, confirmBridge and request-view signatures. Direct releases, bridge releases and bridge receipts use EIP-712 domain version **4**, binding chain and card. The route hash remains `keccak256(abi.encode(domain,bytes32(recipient),uint64(amount),uint256(0),uint32(2000),bytes32(0)))`.

Each burn checks the source token, messenger, transmitter and minter runtime code hashes; issuer relationships; source domain; transmitter/minter/token pauses; the selected remote messenger; and the issuer's minimum fee for the exact amount. CCTP arguments always use native USDC, the reserved recipient/amount, zero destination caller, zero maximum fee and standard finality2000. Any nonzero required fee fails atomically. A successful burn must debit exactly the reserved amount and clear the allowance.

Local USDC settlement independently checks both vault debit and recipient credit. An ERC20 success return alone cannot create a false exact-payment receipt. A bridge stays `BRIDGING` after burn; only a valid receipt acknowledgement marks it `PAID`. Cancellation and expiry cannot refund or retry an already completed burn.

`MainnetUsdt0CardFactory` admits only chain196 and issuer USDT0 `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`, with six decimals and pinned runtime code. It creates standard `AgentSpendingCard` instances with domain version1 and local settlement. These cards expose no CCTP method.

## Deployability defect found and repaired

A naive V4 factory embedded the card's 27,198-byte creation image in a 28,801-byte runtime, exceeding the 24,576-byte EIP-170 limit. Foundry's successful constructor tests alone did not catch this. The independent artifact-size gate did.

The factory now stores its own compiled creation image in two immutable STOP-prefixed code stores, verifies their code hashes on every creation, reconstructs that image and appends the canonical constructor arguments. It accepts neither caller bytecode nor an external deployer. The stores expose no executable deployment interface.

Measured final compiler output, Solidity0.8.28 with optimizer200 and viaIR:

| Contract | Runtime bytes | Creation bytes |
|---|---:|---:|
| CctpSpendingCardV4 | 21,126 | 27,198 |
| CctpCardFactoryV4 | 2,497 | 30,771 |
| MainnetUsdt0CardFactory | 18,538 | 18,861 |

Factory-created code stores have at most24,001 runtime bytes. Tests check their limits, STOP prefix, identity and refusal after code tampering. The deployer must include creation of both stores in its mainnet gas quote.

## Executable evidence

Run from the repository root with Node24, Foundry and pinned Solidity0.8.28:

```sh
node tools/production/verify-mainnet-contracts.mjs
node tools/production/verify-mainnet-contracts.mjs --usdt0
```

The full verifier runs133 tests:68 unchanged legacy tests,30 V4 tests on mainnet-profile fixtures,30 on testnet-profile fixtures, and5 USDT0 factory tests. Both V4 profiles fuzz exact burn/accounting with64 cases. The verifier requires explicit positive and negative cases, successful outcomes, unchanged legacy source/ABI, current compiled V4 ABI and bytecode within EIP-170/EIP-3860 limits. Missing tests, zero tests and skipped/failed tests do not pass.

The attack matrix covers:

- Forged owner/gateway, other-environment/synthetic assets and unsupported source chains.
- All ten actual burn routes and local settlement, with independent issuer address/chain fixtures.
- Empty/duplicate/unknown/oversized domains and unselected local/cross-chain routes.
- Mutated request/policy/evidence/route/recipient/amount/chain/version commitments.
- Signature replay across cards and requests; malformed receipt fields, wrong signer and duplicate acknowledgement.
- Premature receipt, irreversible burn, pre-burn cancellation and post-revocation/expiry reconciliation.
- Runtime code changes, changed issuer relationships/remote mapping/decimals, pause and fee changes.
- Failed/short burns, approval failure/optional return, reentrant messenger/token callbacks and short local credit.
- Period rollover, lifetime spending, withdrawal accounting, processor change and owner pause.

Test fixtures are isolated contract doubles. They are not proof of deployed bytecode, issuer operation, live GenLayer consensus or a real mainnet payment.

## Issuer provenance and remaining trust

The fixed address/domain candidates were checked against these issuer documents on2026-10-26:

- [Circle native USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses.md)
- [Circle CCTP V2 contract addresses](https://developers.circle.com/cctp/references/contract-addresses.md)
- [Circle supported domains](https://developers.circle.com/cctp/concepts/supported-chains-and-domains.md)
- [Circle CCTP interfaces](https://developers.circle.com/cctp/references/contract-interfaces.md)
- [USDT0 deployments](https://docs.usdt0.to/technical-documentation/deployments)

Operational activation must independently inspect live chain identity, issuer proxy implementations, relationships, paused state, destination token mapping and fees. Runtime-code hashes cannot detect a proxy implementation/storage upgrade by themselves; issuer authority remains trusted. USDT0 retains the standard card's issuer/token-transfer trust model.

The attestor can falsely attest semantic approval within the immutable financial limits or acknowledge a fabricated foreign receipt. No foreign-chain light client was added. Worker verification and proof publication are required, but cannot make a compromised signing authority cryptographically harmless. This self-test report is not third-party or TapeCode certification.
