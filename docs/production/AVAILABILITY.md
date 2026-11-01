# Sustained dual-release availability

The required campaign observes the final testnet1952 and mainnet196 deployments from GitHub-hosted Ubuntu24.04, Windows2022 and macOS14. These are three native operating-system environments with separate jobs, but **all share GitHub Actions infrastructure**. This is not proof of three independent cloud providers or resistance to a GitHub outage.

The fixed contract is72 consecutive hours, five-minute public probes and hourly anonymous browser checks for each deployment/OS. Each of the six groups requires **864** expected slots and **72** successful hourly browsers, at least **99.5%** successful slots and no observed gap exceeding15 minutes. Missing slots count as downtime. Four isolated missing slots may fit the percentage threshold; a fifth fails. Two consecutive missing slots may fit the gap threshold; three create a20-minute gap and fail. Startup, queue, scheduling or artifact loss is measured as a missing observation, never backfilled.

`node tools/production/verify-availability.mjs` tests the tooling with positive/negative controls, including source drift, malformed responses, TLS/HTTP failures, stale workers, missing slots, relabelled operating systems, altered artifact digests and unverified gateway bytes. Its success is local tooling evidence and records zero actual hours. Do not infer uptime from those fixtures.

## Campaign setup

Start only after both final release identities and hosted byte manifests are independently verified. Create a version1 campaign with:

- `campaignId` (a unique64-hex SHA256 identity), `repository: "TS-mfon/intentguard"`, `workflowPath: ".github/workflows/availability.yml"`, and `monitorSourceCommit` (the exact commit containing the monitor).
- Canonical UTC `startAt` at an exact hour and `endAt` exactly72 hours later.
- `contract: {durationMs:259200000,intervalMs:300000,browserIntervalMs:3600000,minimumAvailability:0.995,maximumGapMs:900000}`.
- Two `targets`, binding `paymentEnvironment`, `chainId`, exact `sourceCommit`, `releaseId`, canonical HTTPS `applicationOrigin`, all published `frontendOrigins`, `bundleSha256`, and2–8 `canaryFiles` with URL `path` and final byte `sha256`. Include `/agent-setup` and a real `/_next/static/...js` file from that release. Mainnet should include both the TapeKit gateway and identical fallback origin.

Use hashes of the actual route-resolved HTML and static JavaScript. Do not hash the TapeKit bootstrap shell. Its ordinary server HTTP response is not the frontend. For official X Layer TapeKit hosts, every five-minute probe launches a controlled browser and fetches the canary files through the actual **Service Worker**, checking client mode, verified hash and gateway name. Ordinary fallback HTTPS responses must match the same pinned bytes. Hourly browsers also verify live API identity, owner sign-in prompt, environment label, no horizontal overflow and no credential-bearing requests.

Set repository variables `INTENTGUARD_AVAILABILITY_CAMPAIGN` to the complete campaign JSON and `INTENTGUARD_AVAILABILITY_CAMPAIGN_ID` to its same ID. Review the exact targets before setting `INTENTGUARD_AVAILABILITY_ENABLED=true`. Choose a future start with enough time for the first jobs to install dependencies/Chromium. Dispatch the workflow before that hour; subsequent hourly schedules maintain overlapping65-minute batches. Each job is bounded to90 minutes. No owner, agent, signing or database credential is supplied to these public probes.

The workflow runs only on `main` and uses pinned checkout/Node/pnpm/artifact actions. Keep `monitorSourceCommit` unchanged during the campaign. A source push, redeployment, changed byte hash, subscription expiry, stale worker or unavailable API invalidates observations; begin a new campaign after resolving the cause. Do not rewrite the old campaign to conceal failures. Disable the enable variable after the campaign to avoid unnecessary future runs.

## Evidence and verification

Each native job records its actual GitHub run/attempt, runner environment, repository, workflow reference, platform, scheduled slot, observation/completion times, required probe results and a content digest. `records.jsonl` is fsynced after every slot; failures are preserved as well as successes. Missing jobs or files remain missing. Failed or timed-out completed jobs can contribute only the actual valid slots they captured.

Collect actual artifact IDs into a version1 availability manifest `{version:1,campaign,artifactIds}`. After the complete72-hour end time, run:

```sh
node tools/production/availability.mjs verify .local/dual-release/availability-manifest.json .local/dual-release/availability-report.json
```

The read-only verifier refetches GitHub workflow runs, attempts, native job labels/times and artifact metadata. It checks the downloaded ZIP against the actual GitHub SHA256 digest and parses only bounded `records.jsonl` entries without extracting archive paths. It reconciles every observation with its real job and counts all expected slots, independently recomputing availability and gaps. Use a read-only `GITHUB_TOKEN` for private artifact downloads; do not print it. Keep the full artifact list, report and failures for review.

`SUSTAINED_AVAILABILITY_VERIFIED` is emitted only when every group passes after the full window. HTTP200 alone does not establish readiness, a completed job does not establish uptime, and duplicate/late/replayed samples cannot fill missing slots. Actual monitoring has not yet established this72-hour requirement.
