import type { AnalysisStatus } from "@proofforge/shared-types";

export function statusLabel(status: AnalysisStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export type Tone = "neutral" | "progress" | "success" | "danger" | "warning";

export function statusTone(status: AnalysisStatus): Tone {
  if (status === "APPROVED") return "success";
  if (status === "REJECTED" || status === "FAILED" || status === "CANCELLED") return "danger";
  if (status === "WAITING_FOR_HUMAN_APPROVAL" || status === "WAITING_FOR_PLAN_APPROVAL") {
    return "warning";
  }
  if (status === "CREATED") return "neutral";
  return "progress";
}

export function riskTone(level: string | null): Tone {
  switch (level) {
    case "low":
      return "success";
    case "moderate":
      return "progress";
    case "elevated":
    case "high":
      return "warning";
    case "critical":
      return "danger";
    default:
      return "neutral";
  }
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
