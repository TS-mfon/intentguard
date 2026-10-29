# Verified-record submission film

The `SubmissionDemo` composition produces a 170-second, 1920×1080 film from five actual public historical testnet requests. It preserves the existing illustrated protocol film. A missing exported artifact or unavailable finalized contract reasoning fails verification. Film source and tooling alone do not satisfy R25.

Capture occurs after the tested source commit is published at the canonical testnet frontend/API. Set `INTENTGUARD_SOURCE_COMMIT` to that commit in the deployment: capture requires `/api/v1/config.sourceCommit` to match the current committed film source. The script uses read-only public HTTP and RPC calls; it submits no purchases, wallet signatures or payments. It does not intercept browser responses.

```sh
node apps/motion/scripts/submission-demo.mjs capture https://intentguard-tapeout.vercel.app
node apps/motion/scripts/submission-demo.mjs render
node tools/production/verify-demo.mjs
```

`capture` reads the native-USDC historical audit in `docs/audits/cctp-independent.json`, refetches the actual transaction details and finalized reasoning, and takes screenshots of the real hosted routes. It binds displayed source/destination chains, native tokens, request/evidence/policy commitments and every payment/burn/mint/acknowledgement hash to that independently verified audit. It refetches X Layer and Base Sepolia issuer-token receipts and checks exact amounts/recipients. Public financial terms, immutable policy hash and all five request states are independently checked against the actual vault. The readable mission is the public card snapshot for that audited mandate. A current API status alone cannot establish delivery.

`render` requires that captured evidence and rejects changed or uncommitted render inputs before generating media. It generates local synthesized narration through the installed ffmpeg `flite` voice, and renders with the pinned Remotion toolchain. Scene captions, a complete spoken transcript and persistent testnet/trust disclosures accompany the narration. Local IBM Plex fonts are loaded before frames render; a failed font load fails the export. Export progress is streamed to the terminal. The export is `.local/submission-video/intentguard-submission.mp4`; `artifact.json` binds its hash to the capture, source and render props. Generated records/audio/images remain private build artifacts and contain no credentials.

The independent verifier checks committed source, the shared issuer/chain registry, render configuration, both root and motion dependency locks, and local font hashes; snapshot/props/transcript hashes; exact record identity/status/amount mapping; canonical confirmed EVM receipts; a playable H.264/AAC export; measured duration and non-silent audio. Displayed elapsed times require chronological operation timestamps. It extracts one decoded frame per scene under `.local/submission-video/frames/` for parent editorial review. Review those actual frames for legibility, cut-off content and truthful disclosures; a matching hash cannot prove those qualities.

Run the capture/render script from the repository root as shown above. It runs Remotion from `apps/motion`, where the pinned packages, render configuration, fonts and browser cache reside. For a direct CLI render, set that same working directory; launching it from the repository root selects a different package/configuration and browser-cache context.

The film labels the records as completed historical **testnet** requests and testnet tokens as having no monetary value. The replay scene cites the October 26 archived same-operation check and submits no fresh replay. Owner setup, wallet controls, current merchant purchase authorization and recurring customers are not claimed. USD49/team/month and a possible10-basis-point fee remain unvalidated and unimplemented. The existing TapeOut testnet adapter, Studionet review and configured attestor trust are disclosed. Official TapeOut/DeWEB mainnet acceptance and the original10/12 semantic reliability failure remain pending; the later8/8 testnet audit does not close them.

If any required public record, finalized reasoning or receipt cannot be independently verified, repair the hosted release or wait for the dependency before capture. Do not substitute fixture screenshots or saved API results presented as current evidence.
