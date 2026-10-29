export type ClientOptions = {
  baseUrl: string; paymentEnvironment: "local" | "testnet" | "mainnet"; apiKey?: string;
  frontendOrigin?: string; sourceChainId?: number; expectedReleaseId?: string; expectedSourceCommit?: string;
  expectedCardId?: string; requestTimeoutMs?: number; fetchImpl?: typeof fetch;
};
export type CallOptions = {signal?: AbortSignal};
export type WaitOptions = CallOptions & {timeoutMs?: number; intervalMs?: number};
export class IntentGuardError extends Error {
  constructor(message: string, status: number, code: string, retryable: boolean, requestId?: string, retryAfterSeconds?: number, details?: unknown);
  status: number; code: string; retryable: boolean; requestId?: string; retryAfterSeconds?: number; details?: unknown;
}
export const REQUEST_STATES: readonly string[];
export const TERMINAL_STATES: readonly string[];
export const PROFILES: Readonly<Record<"testnet" | "mainnet", {sourceChainId: number; sourceUSDC: string; usdt0: string | null; routes: Readonly<Record<number, {domain: number; token: string}>>}>>;
export function canonicalJson(value: unknown): string;
export function commitment(value: unknown): Promise<string>;
export function validatePayment(value: unknown): void;
export function normalizeSettlement(value: unknown, environment: "local" | "testnet" | "mainnet"): import("./types").Settlement;
export class ProtocolClient {
  constructor(options: ClientOptions);
  capabilities(options?: CallOptions): Promise<any>;
  health(options?: CallOptions): Promise<any>;
  me(options?: CallOptions): Promise<any>;
  request(payment: unknown, idempotencyKey: string, options?: CallOptions): Promise<any>;
  get(id: string, options?: CallOptions): Promise<any>;
  wait(id: string, options?: WaitOptions): Promise<any>;
  poll(id: string, options?: WaitOptions): Promise<{request: any; pending: boolean; operationId: string}>;
  listAgents(page?: {limit?: number; cursor?: string}, options?: CallOptions): Promise<any>;
  listTransactions(page?: {limit?: number; cursor?: string; agentId?: string; status?: string}, options?: CallOptions): Promise<any>;
  getTransaction(id: string, options?: CallOptions): Promise<any>;
  getAgentCard(id: string, options?: CallOptions): Promise<any>;
  getBridgeProof(id: string, options?: CallOptions): Promise<any>;
}
export type OwnerClientOptions = Omit<ClientOptions, "apiKey" | "expectedCardId">;
export class OwnerClient {
  constructor(options: OwnerClientOptions);
  capabilities(options?: CallOptions): Promise<any>;
  challenge(address: string, options?: CallOptions): Promise<{message: string}>;
  login(address: string, signature: string, options?: CallOptions): Promise<{address: string; expiresAt: number | null; transport: "cookie" | "owner-bearer"}>;
  session(options?: CallOptions): Promise<{address: string | null}>;
  logout(options?: CallOptions): Promise<void>;
  clearSession(): void;
  listCards(options?: CallOptions): Promise<any>;
  createDraft(input: unknown, options?: CallOptions): Promise<any>;
  getDraft(id: string, options?: CallOptions): Promise<any>;
  activateCard(input: {draftId: string; cardAddress: string; activationTx: string}, options?: CallOptions): Promise<any>;
  getReplacement(id: string, input?: CallOptions): Promise<any>;
  createReplacement(id: string, input: unknown, options?: CallOptions): Promise<any>;
  retryReviewer(id: string, options?: CallOptions): Promise<any>;
  issueKey(id: string, options?: CallOptions): Promise<{apiKey: string}>;
  revokeKeys(id: string, options?: CallOptions): Promise<void>;
  listRequests(options?: CallOptions): Promise<any>;
  getRequest(id: string, options?: CallOptions): Promise<any>;
}
