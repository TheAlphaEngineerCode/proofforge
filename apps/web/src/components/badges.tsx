import type { AnalysisStatus } from "@proofforge/shared-types";
import { riskTone, statusLabel, statusTone, type Tone } from "@/lib/format";

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: AnalysisStatus }) {
  return <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>;
}

export function RiskBadge({ score, level }: { score: number | null; level: string | null }) {
  if (score === null || level === null) {
    return <Badge tone="neutral">No risk yet</Badge>;
  }
  return (
    <Badge tone={riskTone(level)}>
      {score}/100 · {level}
    </Badge>
  );
}
