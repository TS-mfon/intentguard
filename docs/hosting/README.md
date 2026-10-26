# X Layer TapeOut and DeWEB preparation

The tooling prepares read-only quotes and publication/resume plans for X Layer mainnet 196. It does not create keys, sign, broadcast, provision a CPU, pay activation, or claim a hosted deployment. R18 and R19 remain pending.

Use Node24.18.0 and the repository lock with pnpm11.9.0:

```sh
node tools/production/verify-hosting.mjs
node tools/hosting/cli.mjs sources
node tools/hosting/cli.mjs probe
```

TapeKit is pinned to [37c617e7e332787c8a32a81e4d7d05a28a06c156](https://github.com/TapeOutProtocol/TapeKit/tree/37c617e7e332787c8a32a81e4d7d05a28a06c156). Obtain that checkout at `.local/TapeKit`. The tool checks the exact README, specification, config, selectors, path rules, factory freeze logic, local vendor interface/interpreter and circuit binary/metadata bytes before quoting or resuming. It uses explicit X Layer constants, rather than TapeKit's default BNB network. `pins.json` contains the address, implementation, runtime SHA256 and source artifact pins; changing a pin requires review and invalidates old quotes.

The circuit binary is independently parsed as 1766 seven-byte NAND gates with no forward references, 451 inputs and 8 outputs. A supplied existing circuit must have the same netlist SHA256 and dimensions and use the official ownerless circuit beacon. The vendor ICPU/NetlistVM provenance is a mirror, as recorded in `contracts/evm/src/vendor/README.md`; byte equality does not convert that mirror into an official source audit.

Quotes use agreed safe blocks from OKX and dRPC, verify chain 196 and block freshness, check ERC1967 storage directly, and hash deployed code. The registry's `implementation()` getter is deliberately excluded from implementation pinning. CPU proxy beacon slots and zero beacon ownership are mandatory. The factory may remain unsealed: that is disclosed, and its observed owner, implementation, bytecode, seal state and registration are bound into the quote. Registry and activation administrators can also change code or fees. A resumed plan rechecks all observed configuration; a new block is allowed, changed configuration is refused.

On October 26, 2026 the production probe agreed between OKX and dRPC at safe block `0x46c9f09` and observed the pinned factory implementation, an ownerless pinned circuit beacon, an unsealed factory, `deployFee() = 6600000000000000` wei (0.0066 OKB), `FEE() = 80000000000000000` wei (0.08 OKB) and `monthlyFee() = 0`. The full historical observation is in [the probe evidence](xlayer-probe-2026-10-26.json). Every new quote reads current fees. Unknown opener fees remain explicit `null` with `INCOMPLETE` status. BNB handbook prices are never used as X Layer prices.

A quote includes a five-minute expiry, source commit, artifact hashes, protocol observations, exact spending cap and a canonical SHA256. Current protocol fees and a bytecode-storage gas lower bound are reported separately. Total payable cost is `null`: dependent mint/tapeout/upload calls, transaction overhead, L1 data charges and changing gas prices are not represented as measured totals. An incomplete or read-only quote is not spending approval.

## Prepare a circuit quote

Create a local JSON configuration containing only public inputs:

```json
{
  "owner": "0xYOUR_OWNER_ADDRESS",
  "capWei": "1000000000000000000"
}
```

`node tools/hosting/cli.mjs quote configuration.json` prints a quote. Save stdout to a new private local file using your normal shell. No secret environment file is loaded.

Then pass the quote file, its exact `quoteHash` and the same decimal `capWei` to `plan`:

```json
{
  "quotePath": ".local/tapeout-quote.json",
  "expectedHash": "QUOTE_SHA256",
  "capWei": "1000000000000000000"
}
```

`node tools/hosting/cli.mjs plan plan-configuration.json` prints a staged CPU/mint/tapeout/open plan. The new processor's transistor code, fee provenance and payable opener ABI must be verified after CPU creation and before building those transactions. The legacy `scripts/deploy.ts` is not invoked. No pending stage is marked deployed.

## Prepare frontend publication

The current Next application has server routes. A verified static export and separate API are required before publication; this tooling does not silently package `.next` or SSR code. The later frontend leaf owns that adaptation.

Give `quote` a plain static directory, the existing circuit's processor address, processor number, circuit token ID, current owner, spending cap and the approved API origins:

```json
{
  "directory": "apps/web/out",
  "processor": "0xVERIFIED_PROCESSOR_ADDRESS",
  "cpuIndex": "7",
  "tokenId": "1",
  "owner": "0xYOUR_OWNER_ADDRESS",
  "capWei": "1000000000000000000",
  "months": 1,
  "apiOrigins": ["https://mainnet-api.example"]
}
```

The scanner requires root `index.html`, NFC names, regular files, no symlinks or special files, no hidden/reserved/traversal/URL-ambiguous paths, and known static MIME types. It rejects source maps, obvious credential literals, server-source extensions and secret/config directories. Every file and chunk is SHA256-bound. Files use 24,000-byte chunks, at most 350 chunks per file, and at most 5,000 manifest paths. Secret-pattern scanning is a guard, not a substitute for reviewing the actual public artifact.

A publication plan requires an opened, verified container and binds chain 196, source commit, directory and chunk hashes, owner, processor/token/name, registry/binding, months, quote hash and cap. It has status `PLANNED_NOT_PUBLISHED`.

Use `resume` with the quote file, plan file, exact quote hash, exact cap and the same directory. Resume verifies the current source checkout and files, then repeats network/protocol/owner/fee checks at a new agreed block. It reads each existing file's declared hash, MIME, size and count, then reads and hashes **every existing chunk** before skipping it. Conflicting content, duplicate chunks or different chunk boundaries are refused. Missing files start with `putFile`; matching partial files use `appendChunk` with the exact current `expectIndex`. No mismatched existing file is silently overwritten. Unsigned call data is review material only.

All read operations use an explicit method allowlist. The CLI has no execute command and imports no signer or wallet client. A future sender must require explicit paid authorization for the exact quote hash and cap, recheck configuration and verified partial content immediately before every step, and fsync an owner-private intent journal before signing/sending. After an uncertain send it must reconcile the saved transaction/receipt before attempting a replay. Plans alone cannot provide that durability.

## Gateway acceptance before activation

Use a real-origin TapeKit Service Worker gateway or compatible browser/desktop shell. X Layer names use `<tokenId>.2.<processorNumber>.tape`; BNB's two-part host example must not be copied. The pinned Service Worker gateway encodes the example as `https://<tokenId>-2-<processorNumber>.<gateway>/`. Confirm the selected live gateway’s X Layer configuration before assigning a public canonical URL.

Root/directory indexes and extensionless deep links follow SPEC §6. The planned fallback is `index.html`; missing paths with an extension stay 404. `/.tape/` is reserved for gateway status/control and cannot be published by the site.

The frontend needs visitor permission for the offchain API and cannot claim “100% on-chain.” Configure origin-bound owner sessions and CORS on the separate mainnet API, and test permission denial/approval, wallet login/account changes, deep links, downloads, media, mobile and reduced motion. Keep the Vercel fallback on the same artifact hash. Browser checks and live file hashes are R19 acceptance, not consequences of local plan tests.

After uploads, independently read every file through the pinned TapeKit kernel and compare SHA256, MIME and size with the release manifest. Preview the unpaid site, then prepare a separate fresh quote for non-refundable name activation. Verify the activation receipt/expiry and final gateway behavior before recording a hosted release. Circuit receipts, live independent evaluation vectors, public frontend file verification and gateway acceptance remain outstanding.
