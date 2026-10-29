# Static frontend preparation

`node tools/production/verify-frontend.mjs` builds both payment environments, verifies their exported file/chunk hashes, exercises the static frontend against two isolated HTTPS origins with the production authentication code, and confirms that the default standalone application still builds.

The browser check uses synthetic records, a memory database, a synthetic runtime manifest, and a simulated EVM wallet. Its cryptographic login signature, nonce handling, CORS preflight, owner token transport, and replacement API are real implementation paths. These checks are local preparation evidence, not mainnet payment or hosted acceptance evidence. Reports and screenshots are written to ignored `.local/production-frontend/`.

Static builds exclude API handlers and the dynamic transaction directory without modifying the application source. New transaction links use `/transaction?id=<requestId>`; extensionless legacy transaction links use the TapeKit-compatible fallback. API and frontend origins, payment environment, source commit, and Studionet testnet review are explicit. Separate-origin owner tokens remain in browser memory and expire within ten minutes; a page reload requires a new login.

Build a candidate with explicit origins:

```sh
node scripts/static-frontend.mjs --payment-environment mainnet --api-origin https://api.example --frontend-origin https://frontend.example
```

The preparation manifest binds the included frontend, shared code, ABI, configuration, lockfile, builder, toolchain versions, static bundle, and each chunk hash. It records dirty source honestly and rejects a source commit different from the checkout. `PREPARED_NOT_HOSTED` remains the status until independent DeWEB and gateway acceptance exists. Final release builds require clean source and actual deployment origins.

Versioned capabilities expose only verified assets and routes. Mainnet USDT0 remains local to X Layer 196. Failed capability verification disables owner actions. Replacement creates a new policy-copy draft with an explicit accounting-reset acknowledgement; deposits, withdrawals, reservations, and old history remain independently owned. Proof inspection checks the canonical commitment and deployment identity before enabling JSON download, and a failed refresh clears the previous proof.

The industrial product identity, public latest-three records, distinct empty/error states, downloadable card usage, sectioned documentation, story assets, and reduced-motion behavior remain covered. R19/R20 still require actual DeWEB upload, gateway permissions, wallet extensions, mobile browsers, and independent hosted verification.
