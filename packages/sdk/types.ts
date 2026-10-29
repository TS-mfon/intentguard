/** Portable API types. The SDK has no dependency on the server, wallet or database. */
export type PaymentEnvironment = "local" | "testnet" | "mainnet";
export type SettlementV2 = {version: 2; paymentEnvironment: "testnet" | "mainnet"; asset: "USDC" | "USDT0"; destinationChainIds: number[]};
export type LegacySettlement = {asset: "USDC"; destinationChainIds: (1952 | 84532 | 421614)[]};
export type Settlement = LegacySettlement | SettlementV2;
export type Policy = {
  version: 1; name: string; mission: string; taskContext: string; allowedCategories: string[]; prohibitedPurchases: string[]; exceptions: string[];
  financial: {totalBudget: string; perPaymentLimit: string; periodBudget: string; periodSeconds: number; validFrom: number; validUntil: number};
  merchants: {name: string; recipient: string; origins: string[]; products: string[]}[];
  evidence: {requiredTypes: string[]; approvedOrigins: string[]; maxAgeSeconds: number}; criteria: {id: string; description: string}[];
};
export type PaymentInput = {destinationChainId?: number; recipient: string; amount: string; purchaseDescription: string; justification: string; category: string; invoiceId: string; evidence: {url: string; sha256?: string}[]};
export type RequestStatus = "QUEUED" | "RESERVED" | "REVIEWING" | "AWAITING_FINALITY" | "APPROVED" | "PAID" | "BLOCKED" | "REJECTED" | "NEEDS_EVIDENCE" | "EXPIRED" | "CANCELLED" | "RETRYING" | "BRIDGING" | "AWAITING_ATTESTATION" | "MINTING";
export type ReviewDecision = {decision: "APPROVE" | "REJECT" | "NEEDS_EVIDENCE"; requestHash: string; policyHash: string; evidenceHash: string; criteria: {id: string; status: "PASS" | "FAIL" | "INSUFFICIENT"; reason: string; sources: string[]}[]; reason: string};
export type ReviewStage = {status: "PENDING" | "COMPLETE" | "SKIPPED" | "FAILED"; reason: string};
export type DeploymentView = {paymentEnvironment?: PaymentEnvironment; reviewEnvironment?: "testnet"; reviewNetwork?: "studionet"; reviewChainId?: 61999; reviewerVersion?: number};
export type Balances = {funded: string; spent: string; reserved: string; available: string; periodSpent: string; periodReserved: string};
export type CardView = DeploymentView & {id: string; name: string; mission: string; address: string; policyHash: string; policy: Policy; status: "ACTIVE" | "PAUSED" | "REVOKED"; balances: Balances; keyStatus: string; chainId: number; token: string; paymentSymbol?: string; settlement?: Settlement; reviewerAddress: string; reviewerTx?: string; activationTx?: string; setupState?: string; setupError?: string | null};
export type BridgeView = {protocol: "CCTP_V2"; phase: "BURNED" | "ATTESTATION_PENDING" | "ATTESTED" | "MINT_SUBMITTED" | "CONFIRMED"; sourceChainId: number; destinationChainId: number; destinationDomain: number; sourceToken: string; destinationToken: string; amount: string; sourceTxHash: string; messageHash?: string; nonce?: string; destinationTxHash?: string; confirmationTxHash?: string; updatedAt: number};
export type RequestView = DeploymentView & {id: string; cardId: string; cardName: string; status: RequestStatus; request: PaymentInput; requestHash: string; evidenceHash: string; guard?: {allow: boolean; failures: string[]; txHash?: string}; review?: ReviewDecision; reviewStage?: ReviewStage; errorCode?: string; genLayerTxHash?: string; paymentTxHash?: string; bridge?: BridgeView; paymentSymbol?: string; error?: string; createdAt: number; updatedAt: number};
export type PublicConfiguration = {
  mode: PaymentEnvironment; paymentEnvironment: PaymentEnvironment; chainId: number; reviewEnvironment: "testnet"; reviewNetwork: "studionet"; reviewChainId: 61999; reviewInfrastructure: "studionet-simulator";
  apiOrigin: string; frontendOrigin: string; applicationUrl: string; ownerSessionTransport: "cookie" | "owner-bearer"; releaseId: string | null; sourceCommit: string | null; configured: boolean; settlementVersion: 1 | 2; readinessReasons: string[];
  token: string; factoryAddress: string | null; cctpFactoryAddress: string | null;
  assets: {asset: "USDC" | "USDT0"; symbol: string; chainId: number; decimals: number; token: string | null; available: boolean; reason: string; sources: string[]}[];
  spendingNetworks: {chainId: number; name: string; domain: number; token: string; explorerUrl: string}[];
  rpcUrl: string; explorerUrl: string; genLayerExplorerUrl: string; networkName: string; paymentSymbol: string; guard: Record<string, unknown>;
};
export type HealthView = {status: "ready" | "degraded"; paymentEnvironment: PaymentEnvironment; paymentChainId: number; reviewEnvironment: "testnet"; reviewNetwork: "studionet"; reviewChainId: 61999; reviewInfrastructure: "studionet-simulator"; releaseId: string | null; sourceCommit: string | null; deploymentVerified: boolean; database: "reachable"; worker: {fresh: boolean; lastHeartbeatAt: number | null}; readinessReasons: string[]};
export type PageOptions = {limit?: number; cursor?: string};
export type AgentUsage = {requestCount: number; paidCount: number; blockedCount: number; rejectedCount: number; needsEvidenceCount: number; cancelledCount: number; activeCount: number; fundsMoved: string; token: string; chainId: number; asOf: number};
export type PublicAgent = Omit<DeploymentView, "reviewerVersion"> & {id: string; name: string; mission: string; address: string; owner: string; policyHash: string; chainId: number; token: string; paymentSymbol?: string; settlement?: Settlement; status: "ACTIVE" | "PAUSED" | "REVOKED" | "UNAVAILABLE"; setupState: string; reviewerAddress: string; reviewerTx: string | null; reviewerVersion: number | null; criteria: Policy["criteria"]; allowedCategories: string[]; financial: Policy["financial"]; balances: Balances | null; createdAt: number; usage?: AgentUsage};
export type PublicTransaction = Omit<DeploymentView, "reviewerVersion"> & {id: string; cardId: string; agentName: string; status: RequestStatus; amount: string; recipient: string; category: string; purchaseDescription: string; chainId: number; token: string; destinationChainId?: number; destinationToken?: string; paymentSymbol?: string; requestHash: string; evidenceHash: string; createdAt: number; updatedAt: number; guard?: RequestView["guard"]; review?: ReviewDecision; reviewStage: ReviewStage; errorCode: string | null; genLayerTxHash?: string; paymentTxHash?: string; bridge?: BridgeView; reviewerVersion: number | null};
export type PublicTransactionDetail = {transaction: PublicTransaction; agent: PublicAgent | null; reviewStage: ReviewStage; reasoningSource: "genlayer-finalized-contract" | "pending" | "unavailable" | "skipped" | "failed"};
export type AgentCardSnapshot = {agent: PublicAgent; usage: AgentUsage; shareUrl: string};
export type PublicAgentPage = {agents: PublicAgent[]; nextCursor: string | null};
export type PublicTransactionPage = {transactions: PublicTransaction[]; nextCursor: string | null};
export type DraftInput = {description: string; guidance?: Record<string, unknown>; settlement?: Settlement};
export type DraftView = {id: string; state: string; status: "PENDING" | "PROPOSED" | "NEEDS_CLARIFICATION"; policy: Policy | null; questions: string[]; interpretation: string; genLayerTxHash?: string; error?: string; settlement?: Settlement; activation?: {factoryAddress: string; config: Record<string, unknown>; kind?: "CCTP_V2" | "CCTP_V4" | "USDT0_LOCAL"; destinationDomains?: number[]; settlement?: Settlement}};
export type ReplacementInput = {settlement: SettlementV2; acknowledgeAccountingReset: true};
export type ReplacementResult = {id: string; state: "FINALIZED"; replacesCardId: string; sourceEnvironment: PaymentEnvironment; accountingReset: true; warnings: string[]};
export type ReplacementView = {sourceCardId: string; sourceAddress: string; sourceEnvironment: PaymentEnvironment; sourceChainId: number; reviewEnvironment: "testnet"; reviewNetwork: "studionet"; sourceReviewerVersion: number; sourceReviewerAddress?: string; policy: Policy; policyHash: string; settlement: Settlement | null; balances: Balances; keyStatus: string; pendingCount: number; pendingRequestIds: string[]; accountingReset: true; warnings: string[]; steps: string[]};
/** Worker-captured bridge data must be independently compared with public receipts. */
export type BridgeProofView = {id: string; proof: {version: 1; requestId: string; paymentEnvironment: PaymentEnvironment; sourceChainId: number; destinationChainId: number; sourceReceipt: Record<string, unknown>; originalMessage: string; trustBoundary: string; [key: string]: unknown}; proofHash: string; verification: string};
