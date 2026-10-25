export const docsSections=[
  [
    "Start here",
    "quickstart",
    "Quickstart"
  ],
  [
    "Start here",
    "wallet-sessions",
    "Wallet and sessions"
  ],
  [
    "Owner setup",
    "policy-fields",
    "Complete policy reference"
  ],
  [
    "Owner setup",
    "proposal",
    "Proposal and activation"
  ],
  [
    "Owner setup",
    "funding",
    "Funding and reviewer"
  ],
  [
    "Owner setup",
    "credentials",
    "Agent credentials"
  ],
  [
    "Owner setup",
    "agent-cards",
    "Download and share cards"
  ],
  [
    "Integration",
    "agent-api",
    "SDK and curl"
  ],
  [
    "Integration",
    "mcp-skills",
    "Agent skills and MCP"
  ],
  [
    "Integration",
    "api-reference",
    "API reference"
  ],
  [
    "Integration",
    "statuses",
    "Statuses and errors"
  ],
  [
    "Integration",
    "idempotency",
    "Idempotency and retries"
  ],
  [
    "Evidence and trust",
    "invoice",
    "Merchant invoice"
  ],
  [
    "Evidence and trust",
    "snapshots",
    "Snapshots and commitments"
  ],
  [
    "Evidence and trust",
    "reasoning",
    "GenLayer finality"
  ],
  [
    "Evidence and trust",
    "architecture",
    "Architecture and trust"
  ],
  [
    "Operations",
    "owner-controls",
    "Owner controls"
  ],
  [
    "Operations",
    "contracts",
    "Testnet contracts"
  ],
  [
    "Operations",
    "actions",
    "Actions worker"
  ],
  [
    "Operations",
    "troubleshooting",
    "Troubleshooting"
  ],
  [
    "Operations",
    "faq",
    "FAQ"
  ]
] as const;
export type DocsSection=typeof docsSections[number][1];
