# IntentGuard follow-up verification

This report supplements [the original 12-request funds audit](AUDIT-12-FINDINGS.md). It preserves that audit's failed overall verdict: 10 of 12 planned outcomes matched, and two semantic-denial cases safely cancelled after unsuccessful GenLayer execution instead of yielding successful finalized rejections.

## Delivery and real activity

The canonical application is https://intentguard-tapeout.vercel.app. The former intentguard-gen-daves-projects.vercel.app alias remains available because existing immutable policies approve its merchant evidence origin.

The hosted read-only follow-up verified Dave's nine unique records: two PAID, three BLOCKED, two NEEDS_EVIDENCE and two CANCELLED. Funds moved totals 3.000001 TEST-USDT on X Layer testnet 1952. No new payment submission was made by this follow-up. The independent total here is computed from hosted records; fresh direct RPC attempts failed intermittently in this environment. Earlier successful onchain balance/event evidence remains in the original audit.

The landing page displays the latest three actual records. Downloaded SVG and 1200×760 PNG cards contain the measured request count and sum of confirmed PAID amounts. The X share composer contains the actual card snapshot and public URL. Owner lists were checked using each agent's actual owner, rather than assuming the operator wallet owns Dave's agent.

## Corrections and results

| Finding | Correction | Verification |
|---|---|---|
| Initial wallet permission produced a false account-change notice | Ignore the initial permission event and repeated same-account events; invalidate private state on real switches/disconnects and recheck account after signing | Production regression and real hosted first-click, single-signature login on both aliases |
| Unsupported methods returned framework responses | Export the supported dispatch entry points and return machine-readable METHOD_NOT_ALLOWED with Allow | Live 405 and production PUT/PATCH/OPTIONS checks |
| Financially blocked requests showed pending evidence review | Separate payment outcome and review stage; report SKIPPED when review never started | Real BLOCKED page contains Skipped, no Pending review |
| Terminal failures appeared to wait indefinitely | Bound processing/finality waits, persist cleanup intent and reconcile cancellation; stop retrying finalized VM/consensus failures | Worker regression suite and original live safe cancellations |
| Invoice mismatch diagnostics were generic | Preserve safe mismatch codes and fields; reject evidence before reservation/review | Buyer and SHA256 mismatch regression checks |
| Quota metadata was missing | Return actual RateLimit headers, correlation ID and retry timing | Live authenticated /me headers plus quota/rejection regression tests |
| New story renderer immediately entered fallback | Remove effect-bearing HTML canvas fallback; rely on actual renderer error boundary and graphics context loss | Actual WebGL rendering plus unavailable/context-loss negative controls |
| Software-rendered animation delayed native input | Use demand rendering with one 24ms timer after each completed frame, a Lambert floor, memoized lighting and bounded adaptive resolution | Measured DOM calls 6–94ms after correction; native PageDown advanced 787px, pause stopped frames, reduced motion held a static pose |
| Framework dependency contained reported vulnerabilities | Upgrade Next.js 16.3.3 to exact 16.4.3 | Production build and pnpm audit --prod: no known vulnerabilities |

## API and developer experience

The hosted check captured structured responses for 400 INVALID_JSON, 401 KEY_REQUIRED, 403 ORIGIN_DENIED, 404 NOT_FOUND, 405 METHOD_NOT_ALLOWED, 415 UNSUPPORTED_MEDIA_TYPE and 422 INVALID_INPUT. Errors include a safe message, stable code, retryable flag and requestId matching X-Request-Id; method errors include Allow. The follow-up did not force a live 429 quota rejection.

The 21 documentation routes each render one bounded section. Documentation, OpenAPI, SDK, MCP resources and the agent skill pass their synchronization check. This removes the need for an agent to infer request schemas from the UI. Tokens remain in secret configuration; owner sessions, agent credentials and merchant administrator credentials remain separate.

Documentation completeness is assessed as 4/5: the supported testnet integration, decimal strings, invoice acquisition, asynchronous admission and operation polling are explicit. A measured human time-to-grasp was not captured. Integration friction still includes separate merchant authorization, stable public evidence bytes and network-dependent GenLayer finality.

## Immersive story revision

Only /why-we-exist changes its design. It uses an original Three.js terminal agent and engraved physical ATM card, a six-act native-scroll camera journey, pointer response, opt-in ambient sound and transaction cues. Human mandate, mandatory TapeOut checks, GenLayer evidence, X Layer settlement and receipt share one continuous scene. The blocked branch illustrates skipped evidence review and no transfer.

The original 28-second protocol film remains available with playback, sound, volume, replay and transcript controls. Reduced motion preserves a static scene and deliberate film playback. Graphics/media failures preserve the readable story and poster with retry controls. Sound and animation suspend offscreen or in hidden tabs; route changes dispose audio and graphics resources.

The rendered-pixel oracle isolates foreground HTML, including the two-pixel scroll-progress line, so it can distinguish actual geometry movement from DOM progress changes. Browser verification covers actual rendered frame and pixel changes, keyboard controls, the permitted/blocked branches, real AudioContext state, video playback, failed video loading, unavailable WebGL and real context loss. Six chapters are checked at 320, 390, 768, 1440 and 1920 pixels. Tests use isolated fixtures only in local regression; hosted usage checks read actual product records. GitHub Actions retains story screenshots and diagnostics as a seven-day artifact for review.

Release acceptance requires a successful complete run in GitHub Actions and independent verification of its exact source commit, story step and downloaded report. Local software-graphics runs were interrupted by SIGTERM; isolated graphics-failure and context-loss probes passed. The release requires all 13 browser outcomes, including resource disposal.

## TapeOut integration and trust

The X Layer testnet adapter executes the unchanged TapeOut NetlistVM with a pinned generated circuit: 451 inputs, eight outputs and 1,766 NAND gates. The vault requires a passing numerical permission result before reservation and again before settlement. The processor is 0xa34d101011d4dbe18375ff2e7591b646e22c2ff3.

[Vendor provenance](../contracts/evm/src/vendor/README.md) and [testnet deployment pins](deployments/testnet.json) explain the adapter. This is not an official mainnet CPU registry deployment, and Vercel hosting is not X Layer DeWEB.

## Remaining limitations

1. **Legacy semantic-rejection reliability remains unresolved.** Dave's immutable v1 reviewer remains pinned. New v2 reviewers move deterministic failures before model evaluation, and the [live v2 proof](deployments/reviewer-v2-proof.json) demonstrates a successfully finalized expired-invoice rejection. It does not prove that prompt-injection disagreement is solved or migrate existing funded agents.
2. **Foreign-chain approval has an attestor trust boundary.** X Layer verifies the configured attestor's signed release; it does not independently execute GenLayer consensus.
3. **External availability affects completion time.** Actions scheduling, RPCs, merchant evidence and GenLayer finality are dependencies. Bounded retries and terminal cleanup prevent false paid states; they cannot guarantee instant consensus.
4. **Testnet evidence is not production certification.** No mainnet contracts or assets were used. Live owner rotation/revocation, pause/withdraw, period rollover and adversarial DNS scenarios were not added to the original 12-payment test; regression coverage is not live proof.

5. **Graphics coverage is bounded.** Browser checks use Chromium with software WebGL and emulated viewport sizes. They do not certify every mobile browser or GPU. The scene adapts resolution, pauses offscreen and preserves the story when graphics fail.

The build and browser checks validate the repaired UI and integration. They do not change the original audit's two failed semantic expectations into successful results.
