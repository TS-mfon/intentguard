# Native testnet stablecoins and bridge verification

Verified: 2026-10-26T00:55:28.331Z. Machine-readable evidence: [stablecoins.json](deployments/stablecoins.json). Reproduce without keys or transfers:

```bash
pnpm exec tsx scripts/verify-stablecoins.ts
# Update the checked-in public proof only when reviewing the result:
pnpm exec tsx scripts/verify-stablecoins.ts --write-proof
```

The user’s current requested assets are USDC and USDT0. USDT was removed from this phase by the user. Existing agents using the synthetic TEST-USDT vault remain legacy agents; that asset is never relabeled as issuer USDT, USDT0, or USDC.

## Verified native USDC deployments

| Network | EVM chain ID | CCTP domain | Native testnet USDC |
| --- | --- | --- | --- |
| X Layer Testnet | 1952 | 37 | `0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3` |
| Base Sepolia | 84532 | 6 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Arbitrum Sepolia | 421614 | 3 | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |

[Circle’s issuer deployment list](https://developers.circle.com/stablecoins/usdc-contract-addresses.md) identifies these as native USDC. They are actual issuer-deployed contracts on testnets. Testnet USDC is **not backed by real dollars** and must never be presented as mainnet funds.

The same official CCTP V2 addresses are deployed on all three testnets:

| Role | Address |
| --- | --- |
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| TokenMinterV2 | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` |

[Circle’s contract list](https://developers.circle.com/cctp/references/contract-addresses.md) separates mainnet and testnet addresses. All addresses above are taken from its **Testnet contract addresses** section.

The live oracle verifies RPC chain identity, code existence and code hashes, decimals = 6, symbol = USDC, transmitter local domain, local transmitter/minter/messenger relationships, unpaused token/transmitter/minter, positive burn limits and mint allowances, and both remote messenger and remote native token mappings on each network. All six directed network mappings passed. CCTP domains are not EVM chain IDs.

X Layer’s source messenger returned `minFee = 0`. This release selects Standard Transfer (`minFinalityThreshold = 2000`) and `maxFee = 0`, preserving the exact invoice amount. A nonzero required source fee must disable new burns until explicit fee-aware policy support exists. Base and Arbitrum have earlier CCTP V2 deployments whose `minFee()` getter reverts; their role as destinations does not require this getter. Unknown getter support is recorded as null, never represented as a verified zero.

## USDT0 is not verified on X Layer testnet

The user-supplied `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` is listed on the [official USDT0 deployment page](https://docs.usdt0.to/technical-documentation/deployments.md) for **X Layer mainnet, chain 196**, with LayerZero endpoint ID 30274. On X Layer testnet chain 1952, the read-only `eth_getCode` response for that address was exactly `0x`: **zero deployed code bytes**.

The [official deployment API filtered to chain 1952](https://docs.usdt0.to/api/deployments?chainId=1952) returned `{}`. This shows no entry was returned; it is not proof that no private or unlisted test deployment exists. No issuer-backed token/OFT peer route on chain 1952 has been established. Consequently the UI and admission registry leave USDT0 disabled without creating a mock.

The user-provided faucet, [OKX X Layer faucet](https://web3.okx.com/xlayer/faucet/xlayerfaucet), could not be inspected because the hostname did not resolve from this environment. A faucet URL does not establish a token deployment. The remaining requirement is an official chain-1952 USDT0 token and OFT deployment, a source of test tokens, and verified remote peers/destination assets. Recheck the address before enabling anything.

[USDT0’s developer guide](https://docs.usdt0.to/technical-documentation/developer.md) describes its LayerZero OFT route and six decimals. That route needs endpoint IDs, configured peers, quotes and route limits. Current [CCTP](https://developers.circle.com/cctp.md) also supports registered third-party assets via a separate permissionless lock-and-mint wrapping path; this is distinct from native USDC burn-and-mint. No USDT0 testnet asset registration was verified. USDT0 must not be silently routed through the native-USDC messenger.

## CCTP attestation and exact destination verification

The [official Iris V2 API](https://developers.circle.com/api-reference/cctp/all/get-messages-v2.md) uses:

```text
GET https://iris-api-sandbox.circle.com/v2/messages/37?transactionHash=<source-burn-tx-hash>
```

Its OpenAPI declares `security: []`: no Circle API key is needed for this public attestation endpoint. Required response fields are `messages` and `sourceTxHash`. Messages are ordered by source log index. Message entries expose `cctpVersion`, `status` (`complete` or `pending_confirmations`), raw `message`, `attestation`, optional `decodedMessage`, optional `delayReason`, and optional forwarding fields.

Pending entries may have `message = "0x"` and `attestation = "PENDING"` or null. A completed attestation is not a destination transfer. The worker must bind `sourceTxHash`, parse and validate raw V2 bytes, submit to the destination’s MessageTransmitterV2, and independently verify the confirmed mint receipt.

The [technical guide](https://developers.circle.com/cctp/technical-guide.md) specifies a 148-byte header and a 228-byte burn body before optional hook data:

| Field | Offset in complete message | Size |
| --- | --- | --- |
| Source domain | 4 | 4 |
| Destination domain | 8 | 4 |
| Nonce | 12 | 32 |
| Sender messenger | 44 | 32 |
| Destination messenger | 76 | 32 |
| Destination caller | 108 | 32 |
| Requested finality | 140 | 4 |
| Executed finality | 144 | 4 |
| Burn-body version | 148 | 4 |
| Burn token | 152 | 32 |
| Mint recipient | 184 | 32 |
| Amount | 216 | 32 |
| Depositing vault | 248 | 32 |
| Maximum fee | 280 | 32 |
| Executed fee | 312 | 32 |
| Expiration block | 344 | 32 |
| Hook data | 376 | variable |

CCTP V2’s serialized header and burn-body version fields are **1**, although the protocol release is called V2. Iris fills the nonce and executed finality offchain. Comparing the complete source `MessageSent` bytes to the attested message would therefore reject legitimate messages; compare immutable fields while checking the filled fields and Circle’s onchain signature verification.

For the selected route, require source domain37, configured destination3 or6, fixed source and destination messenger, no destination caller restriction, native source token, approved merchant mint recipient, depositing vault, exact requested amount, zero fees, finality2000, and no unexpected hooks. Confirm the destination transaction’s token mint and CCTP message consumption before acknowledging `PAID`. An L2 transaction receipt alone does not prove Ethereum-level finality.

On ARB-stack destinations, the attested `expirationBlock` is an **Ethereum L1** block number, not the L2 block number. Expired attestations may be refreshed through the documented `POST /v2/reattest/{nonce}` endpoint. Do not create a second source burn during recovery. Circle’s public service rate limit is 40 requests/second, with a five-minute block after exceeding it; retain durable backoff.

## Public operator readiness

These were real read-only balances at the proof’s per-chain block numbers; they are deployment readiness evidence, **not agent usage or UI sample data**.

| Network | Official USDC atomic units | Native gas, wei |
| --- | --- | --- |
| X Layer Testnet | 0 | 175310600105935119 |
| Base Sepolia | 34515000 | 18524407958489941 |
| Arbitrum Sepolia | 0 | 2387211412401916000 |

Operator: `0xed9edd8586b20524cafa4f568413c504c9b03172`. Destination gas exists on both Base and Arbitrum Sepolia. X Layer’s operator initially holds no official USDC. Source funding is required before a real X Layer burn; the actual issuer USDC balance on Base may serve as a testnet funding source through a separately journaled CCTP operation in GitHub Actions. No funding or bridge transaction was executed by this research oracle.
