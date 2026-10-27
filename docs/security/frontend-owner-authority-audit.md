# Static frontend owner-authority audit

The new frontend uses one pinned API origin and one payment environment. Mainnet196 payments retain Studionet61999 testnet review. APP_URL names the API; FRONTEND_URL names the approved frontend. Release manifests and database identity also bind that frontend.

Cross-origin login requires the exact frontend Origin and X-IntentGuard-Environment. It issues a ten-minute Origin/API/payment-bound Owner token held in browser memory. Tokens have random nonces, require durable session authority and are revoked on logout. Third-party cookies and wildcard CORS are not enabled. The existing same-origin testnet cookie flow remains covered.

Sixteen focused controls cover allowed and denied preflights, wrong origins/API/environment/transport, challenge replay, expiry, logout, cookie misuse, ambiguous JSON, nonce uniqueness and persistence failures. Together with existing API/runtime/manifest/database tests, the oracle executes47 cases with zero skips, failures, cancellations or todos.

Independent read-only review identified three races in the unpublished implementation. Controlled reproductions passed the twelve existing controls and failed all three new expectations before the fix:

| Finding | Before repair | Repair |
|---|---|---|
| Challenge expires during atomic claim | Fresh session still issued | Bind exact challenge expiry into the claim and recheck after awaited verification and claim |
| Session expires during durable authority read | Owner still authenticated | Recheck expiry after the database read |
| Session persistence finishes after expiry | Expired token returned as login success | Recheck before returning; remove expired durable authority and require a fresh challenge |

All three now pass with the original positive controls. Tokens are credentials; never log or publish them. XSS or a compromised approved frontend can still access an in-memory token, so these tests do not certify the absence of browser vulnerabilities. Final live TapeKit permission/gateway acceptance and deployment-bound retests remain R19/R20/R17.

Run `node tools/production/verify-browser-auth.mjs`. This is local preparation, not a deployed mainnet or third-party audit claim.
 
Public card downloads and share URLs point to the approved frontend, while API requests keep their canonical API origin. A separate regression verifies this split.
