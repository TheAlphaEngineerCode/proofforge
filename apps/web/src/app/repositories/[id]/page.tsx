"use client";

import type { Analysis, Repository } from "@proofforge/shared-types";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { StatusBadge, RiskBadge } from "@/components/badges";
import { AppShell } from "@/components/shell";
import { api, errorMessage } from "@/lib/api";
import { formatDate, shortSha } from "@/lib/format";

export default function RepositoryPage() {
  return (
    <AppShell>
      <RepositoryDetail />
    </AppShell>
  );
}

function RepositoryDetail() {
  const params = useParams<{ id: string }>();
  const repoId = params.id;

  const [repo, setRepo] = useState<Repository | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [commit, setCommit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.listAnalyses(repoId).then(setAnalyses).catch((e: unknown) => setError(errorMessage(e)));
  }, [repoId]);

  useEffect(() => {
    api.getRepository(repoId).then(setRepo).catch((e: unknown) => setError(errorMessage(e)));
    refresh();
  }, [repoId, refresh]);

  async function runAnalysis() {
    setBusy(true);
    setError(null);
    try {
      await api.analyze(repoId, commit);
      setCommit("");
      refresh();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 20 }}>
      <Link href="/dashboard" className="muted">
        ← Dashboard
      </Link>
      <h1 style={{ margin: 0 }}>
        {repo ? `${repo.owner}/${repo.name}` : "Repository"}
      </h1>
      {repo && (
        <div className="row muted">
          <span className="mono">{repo.defaultBranch}</span>
          <span>·</span>
          <span>{repo.private ? "private" : "public"}</span>
          {repo.language && (
            <>
              <span>·</span>
              <span>{repo.language}</span>
            </>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h3>Run an analysis</h3>
        <p className="muted" style={{ fontSize: "0.9rem" }}>
          Provide a commit SHA to validate. ProofForge runs the pipeline and produces a verifiable
          proof-manifest.
        </p>
        <div className="row">
          <input
            className="input"
            style={{ maxWidth: 420 }}
            placeholder="commit SHA (min 7 chars)"
            value={commit}
            onChange={(e) => setCommit(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={busy || commit.length < 7}
            onClick={() => void runAnalysis()}
          >
            Analyze
          </button>
        </div>
      </div>

      <div className="card">
        <div className="spread" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Analyses</h3>
          <button className="btn" onClick={refresh}>
            Refresh
          </button>
        </div>
        {analyses.length === 0 ? (
          <p className="muted">No analyses yet.</p>
        ) : (
          <div>
            {analyses.map((analysis) => (
              <Link key={analysis.id} href={`/analyses/${analysis.id}`} className="list-item">
                <div className="row">
                  <span className="mono">{shortSha(analysis.commitSha)}</span>
                  <StatusBadge status={analysis.status} />
                </div>
                <div className="row">
                  <RiskBadge score={analysis.riskScore} level={analysis.riskLevel} />
                  <span className="muted" style={{ fontSize: "0.8rem" }}>
                    {formatDate(analysis.createdAt)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
