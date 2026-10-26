# Issuer registry and verification tooling

The registry defines X Layer mainnet196 and testnet1952 plus the ten corresponding CCTP destinations. Every entry remains a candidate. Application capabilities come from a separately verified, hash-pinned runtime manifest.

`node tools/production/verify-issuer.mjs` passed17 regressions, including positive controls and failures for wrong chain/domain/token, duplicate or ambiguous issuer rows, malformed RPC results, empty contract code, changed implementation/beacon binding, paused contracts, changed fees and reorgs. The driver independently reran this gate. Registry addresses use validated EVM address types.

The read-only verifier restricts RPC methods, pins snapshot blocks, saves issuer document hashes and code/implementation observations, and labels failures without enabling routes. It records executed source hashes and dirty-source status; exploratory output cannot be promoted into an immutable release by copying a filename.

An exploratory run on2026-10-26 observed18/22 USDC snapshots and mainnet USDT0. Mainnet Base and testnet Polygon Amoy, Base Sepolia and Ethereum Sepolia had transport failures. Those observations require a release-pinned rerun. No official X Layer testnet USDT0 deployment was found. No route was enabled, and no transaction or paid provisioning was performed.

R10 stays open for live acceptance of every required route, issuer/ownership/pause checks, exact-payment zero-fee compatibility, deployment and canary evidence. A changed fee or unsupported issuer deployment must keep the route disabled.

The original review remains at [the preserved feedback](../reviews/2026-10-26-original-feedback.md).
