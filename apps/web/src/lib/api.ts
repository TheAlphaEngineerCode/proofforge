import type { Manifest } from "@proofforge/evidence-spec";
import type {
  Analysis,
  EvidenceBundle,
  Organization,
  Repository,
  User,
} from "@proofforge/shared-types";
import { API_URL } from "./config";
import { getToken } from "./session";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface DevLoginResponse {
  token: string;
  expiresAt: string;
  user: User;
}

export const api = {
  devLogin: () =>
    request<DevLoginResponse>("/api/v1/auth/dev-login", { method: "POST", body: "{}" }),
  me: () => request<User>("/api/v1/me"),

  listOrganizations: () => request<Organization[]>("/api/v1/organizations"),
  createOrganization: (input: { name: string; slug: string }) =>
    request<Organization>("/api/v1/organizations", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  listRepositories: (organizationId: string) =>
    request<Repository[]>(`/api/v1/repositories?organizationId=${encodeURIComponent(organizationId)}`),
  createRepository: (input: { organizationId: string; owner: string; name: string }) =>
    request<Repository>("/api/v1/repositories", { method: "POST", body: JSON.stringify(input) }),
  getRepository: (id: string) => request<Repository>(`/api/v1/repositories/${id}`),
  listAnalyses: (repositoryId: string) =>
    request<Analysis[]>(`/api/v1/repositories/${repositoryId}/analyses`),
  analyze: (repositoryId: string, commitSha: string) =>
    request<Analysis>(`/api/v1/repositories/${repositoryId}/analyze`, {
      method: "POST",
      body: JSON.stringify({ commitSha }),
    }),

  getAnalysis: (id: string) => request<Analysis>(`/api/v1/analyses/${id}`),
  getBundle: (id: string) => request<EvidenceBundle>(`/api/v1/evidence-bundles/${id}`),
  getManifest: (bundleId: string) =>
    request<Manifest>(`/api/v1/evidence-bundles/${bundleId}/manifest`),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : "unexpected error";
}

/** URL for the SSE stream. EventSource cannot set headers, so the token rides as a query param. */
export function analysisEventsUrl(analysisId: string): string {
  const token = getToken() ?? "";
  return `${API_URL}/api/v1/analyses/${analysisId}/events?token=${encodeURIComponent(token)}`;
}
