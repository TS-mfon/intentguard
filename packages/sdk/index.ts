import {ProtocolClient, OwnerClient, SandboxClient} from "./client.mjs";
import type {ClientOptions, CallOptions, WaitOptions, OwnerClientOptions, SandboxClientOptions} from "./client.mjs";
import type {CardView, PaymentInput, RequestView, RequestStatus, PublicConfiguration, HealthView, PageOptions, PublicAgentPage, PublicTransactionPage, PublicTransactionDetail, AgentCardSnapshot, BridgeProofView, DraftInput, DraftView, ReplacementView, ReplacementInput, ReplacementResult, SandboxConfiguration, SandboxScenario, SandboxAdmission, SandboxRequestView} from "./types";
export {IntentGuardError, canonicalJson, commitment, normalizeSettlement, validatePayment} from "./client.mjs";
export type {ClientOptions, CallOptions, WaitOptions, OwnerClientOptions, SandboxClientOptions};
export type * from "./types";
export type ProtocolErrorDetail = {field?: string; code?: string; message?: string};

/** Source SDK; no default host or payment environment and no arbitrary wallet signing. */
export class IntentGuard {
  #client: ProtocolClient;
  constructor(options: ClientOptions) { this.#client = new ProtocolClient(options); }
  capabilities(options?: CallOptions) { return this.#client.capabilities(options) as Promise<PublicConfiguration>; }
  health(options?: CallOptions) { return this.#client.health(options) as Promise<HealthView>; }
  me(options?: CallOptions) { return this.#client.me(options) as Promise<{card: CardView}>; }
  request(payment: PaymentInput, idempotencyKey: string, options?: CallOptions) { return this.#client.request(payment, idempotencyKey, options) as Promise<{id: string; status: RequestStatus}>; }
  get(id: string, options?: CallOptions) { return this.#client.get(id, options) as Promise<RequestView>; }
  wait(id: string, options?: WaitOptions) { return this.#client.wait(id, options) as Promise<RequestView>; }
  listAgents(page?: PageOptions, options?: CallOptions) { return this.#client.listAgents(page, options) as Promise<PublicAgentPage>; }
  listTransactions(page?: PageOptions & {agentId?: string; status?: RequestStatus}, options?: CallOptions) { return this.#client.listTransactions(page, options) as Promise<PublicTransactionPage>; }
  getTransaction(id: string, options?: CallOptions) { return this.#client.getTransaction(id, options) as Promise<PublicTransactionDetail>; }
  getAgentCard(id: string, options?: CallOptions) { return this.#client.getAgentCard(id, options) as Promise<AgentCardSnapshot>; }
  getBridgeProof(id: string, options?: CallOptions) { return this.#client.getBridgeProof(id, options) as Promise<BridgeProofView>; }
}

/** Owner dashboard transport. The caller supplies a challenge signature; this client never signs. */
export class IntentGuardOwner {
  #client: OwnerClient;
  constructor(options: OwnerClientOptions) { this.#client = new OwnerClient(options); }
  capabilities(options?: CallOptions) { return this.#client.capabilities(options) as Promise<PublicConfiguration>; }
  challenge(address: string, options?: CallOptions) { return this.#client.challenge(address, options); }
  login(address: string, signature: string, options?: CallOptions) { return this.#client.login(address, signature, options); }
  session(options?: CallOptions) { return this.#client.session(options); }
  logout(options?: CallOptions) { return this.#client.logout(options); }
  clearSession() { this.#client.clearSession(); }
  listCards(options?: CallOptions) { return this.#client.listCards(options) as Promise<{cards: CardView[]}>; }
  createDraft(input: DraftInput, options?: CallOptions) { return this.#client.createDraft(input, options) as Promise<{id: string; status: RequestStatus}>; }
  getDraft(id: string, options?: CallOptions) { return this.#client.getDraft(id, options) as Promise<DraftView>; }
  activateCard(input: {draftId: string; cardAddress: string; activationTx: string}, options?: CallOptions) { return this.#client.activateCard(input, options) as Promise<{card: CardView}>; }
  getReplacement(id: string, options?: CallOptions) { return this.#client.getReplacement(id, options) as Promise<ReplacementView>; }
  createReplacement(id: string, input: ReplacementInput, options?: CallOptions) { return this.#client.createReplacement(id, input, options) as Promise<ReplacementResult>; }
  retryReviewer(id: string, options?: CallOptions) { return this.#client.retryReviewer(id, options) as Promise<{card: CardView}>; }
  issueKey(id: string, options?: CallOptions) { return this.#client.issueKey(id, options); }
  revokeKeys(id: string, options?: CallOptions) { return this.#client.revokeKeys(id, options); }
  listRequests(options?: CallOptions) { return this.#client.listRequests(options) as Promise<{requests: RequestView[]}>; }
  getRequest(id: string, options?: CallOptions) { return this.#client.getRequest(id, options) as Promise<RequestView>; }
}

/** No wallet or agent key. A private, expiring visitor capability is held in memory. */
export class IntentGuardSandbox {
  #client: SandboxClient;
  constructor(options: SandboxClientOptions) { this.#client = new SandboxClient(options); }
  capabilities(options?: CallOptions) { return this.#client.capabilities(options) as Promise<SandboxConfiguration>; }
  startSession(options?: CallOptions) { return this.#client.startSession(options); }
  clearSession() { this.#client.clearSession(); }
  request(scenario: SandboxScenario, idempotencyKey: string, options?: CallOptions) { return this.#client.request(scenario, idempotencyKey, options) as Promise<SandboxAdmission>; }
  get(id: string, options?: CallOptions) { return this.#client.get(id, options) as Promise<SandboxRequestView>; }
}
