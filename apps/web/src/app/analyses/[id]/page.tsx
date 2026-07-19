"use client";

import type { Manifest } from "@proofforge/evidence-spec";
import type { Analysis, AnalysisEvent, AnalysisStatus } from "@proofforge/shared-types";
import { isTerminal } from "@proofforge/shared-types";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RiskBadge, StatusBadge } from "@/components/badges";
import { AppShell } from "@/components/shell";
import { analysisEventsUrl, api, errorMessage } from "@/lib/api";
import { formatDate, shortSha, statusLabel } from "@/lib/format";

export default function AnalysisPage() {
  return (
    <AppShell>
      <AnalysisDetail />
    </AppShell>
  );
}

interface TimelineEntry {
  status: AnalysisStatus;
  at: string;
}

function AnalysisDetail() {
  const params = useParams<{ id: string }>();
  const analysisId = params.id;

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedManifestFor = useRef<string | null>(null);

  // Load the current analysis once, then follow live updates over SSE.
  useEffect(() => {
    api.getAnalysis(analysisId).then(setAnalysis).catch((e: unknown) => setError(errorMessage(e)));

    const source = new EventSource(analysisEventsUrl(analysisId));
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as AnalysisEvent;
      if (event.type === "status") {
        setTimeline((prev) => [...prev, { status: event.status, at: event.at }]);
        setAnalysis((prev) => (prev ? { ...prev, status: event.status } : prev));
        if (isTerminal(event.status) || event.status === "WAITING_FOR_HUMAN_APPROVAL") {
          void api.getAnalysis(analysisId).then(setAnalysis);
        }
      } else if (event.type === "completed") {
        void api.getAnalysis(analysisId).then(setAnalysis);
        source.close();
      } else if (event.type === "error") {
        setError(event.message);
        source.close();
      }
    };
    source.onerror = () => source.close();

    return () => source.close();
  }, [analysisId]);

  // Once a bundle exists, fetch its manifest (guarded so it loads once).
  useEffect(() => {
    const bundleId = analysis?.evidenceBundleId;
    if (!bundleId || loadedManifestFor.current === bundleId) return;
    loadedManifestFor.current = bundleId;
    api.getManifest(bundleId).then(setManifest).catch((e: unknown) => setError(errorMessage(e)));
  }, [analysis?.evidenceBundleId]);

  return (
    <div className="grid" style={{ gap: 20 }}>
      <Link href="/dashboard" className="muted">
        ← Dashboard
      </Link>

      <div className="spread">
        <h1 style={{ margin: 0 }}>Analysis</h1>
        {analysis && <StatusBadge status={analysis.status} />}
      </div>

      {analysis && (
        <div className="row muted">
          <span className="mono">{shortSha(analysis.commitSha)}</span>
          <span>·</span>
          <RiskBadge score={analysis.riskScore} level={analysis.riskLevel} />
          <span>·</span>
          <span style={{ fontSize: "0.85rem" }}>{formatDate(analysis.createdAt)}</span>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card">
          <h3>Pipeline</h3>
          {timeline.length === 0 ? (
            <p className="muted">Waiting for events…</p>
          ) : (
            <ul className="timeline">
              {timeline.map((entry, i) => (
                <li key={`${entry.status}-${i}`}>
                  <strong>{statusLabel(entry.status)}</strong>
                  <div className="muted" style={{ fontSize: "0.78rem" }}>
                    {formatDate(entry.at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h3>Proof manifest</h3>
          {!manifest ? (
            <p className="muted">The manifest appears once evidence generation completes.</p>
          ) : (
            <ManifestSummary manifest={manifest} showRaw={showRaw} onToggleRaw={() => setShowRaw((v) => !v)} />
          )}
        </div>
      </div>
    </div>
  );
}

function ManifestSummary({
  manifest,
  showRaw,
  onToggleRaw,
}: {
  manifest: Manifest;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  return (
    <div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <Metric label="Risk" value={`${manifest.risk.score}/100 · ${manifest.risk.level}`} />
        <Metric
          label="Tests"
          value={`${manifest.tests.passed} passed / ${manifest.tests.failed} failed`}
        />
        <Metric label="Changed-line coverage" value={`${manifest.tests.coverage.changedLines}%`} />
        <Metric
          label="Security"
          value={`${manifest.security.criticalVulnerabilities} crit / ${manifest.security.secretsDetected} secrets`}
        />
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <span className="label">Evidence hash</span>
        <div className="mono" style={{ wordBreak: "break-all" }}>
          {manifest.evidenceHash}
        </div>
      </div>

      <button className="btn" onClick={onToggleRaw}>
        {showRaw ? "Hide raw manifest" : "Show raw manifest"}
      </button>
      {showRaw && <pre className="codeblock" style={{ marginTop: 12 }}>{JSON.stringify(manifest, null, 2)}</pre>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}
