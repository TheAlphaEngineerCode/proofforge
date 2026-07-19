"use client";

import type { Organization, Repository } from "@proofforge/shared-types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell";
import { api, errorMessage } from "@/lib/api";

export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadRepos = useCallback((orgId: string) => {
    api
      .listRepositories(orgId)
      .then(setRepos)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    api
      .listOrganizations()
      .then((list) => {
        setOrgs(list);
        if (list.length > 0) {
          setSelected(list[0].id);
          loadRepos(list[0].id);
        }
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [loadRepos]);

  function selectOrg(id: string) {
    setSelected(id);
    setRepos([]);
    loadRepos(id);
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr)", gap: 20 }}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Dashboard</h1>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <div className="spread" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Organizations</h3>
        </div>
        {orgs.length === 0 ? (
          <p className="muted">No organizations yet — create one to get started.</p>
        ) : (
          <div className="row">
            {orgs.map((org) => (
              <button
                key={org.id}
                className={`btn ${selected === org.id ? "btn-primary" : ""}`}
                onClick={() => selectOrg(org.id)}
              >
                {org.name}
              </button>
            ))}
          </div>
        )}
        <CreateOrgForm
          onCreated={(org) => {
            setOrgs((prev) => [...prev, org]);
            selectOrg(org.id);
          }}
        />
      </div>

      {selected && (
        <div className="card">
          <h3>Repositories</h3>
          {repos.length === 0 ? (
            <p className="muted">No repositories connected to this organization yet.</p>
          ) : (
            <div>
              {repos.map((repo) => (
                <Link key={repo.id} href={`/repositories/${repo.id}`} className="list-item">
                  <div>
                    <strong>
                      {repo.owner}/{repo.name}
                    </strong>
                    <div className="muted mono">{repo.defaultBranch}</div>
                  </div>
                  <span className="muted">Open →</span>
                </Link>
              ))}
            </div>
          )}
          <CreateRepoForm
            organizationId={selected}
            onCreated={(repo) => setRepos((prev) => [...prev, repo])}
          />
        </div>
      )}
    </div>
  );
}

function CreateOrgForm({ onCreated }: { onCreated: (org: Organization) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const org = await api.createOrganization({ name, slug });
      setName("");
      setSlug("");
      onCreated(org);
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
      <div className="row">
        <input
          className="input"
          style={{ maxWidth: 220 }}
          placeholder="Organization name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input"
          style={{ maxWidth: 180 }}
          placeholder="slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <button className="btn btn-primary" disabled={busy || !name || !slug} onClick={() => void submit()}>
          Create organization
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function CreateRepoForm({
  organizationId,
  onCreated,
}: {
  organizationId: string;
  onCreated: (repo: Repository) => void;
}) {
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const repo = await api.createRepository({ organizationId, owner, name });
      setOwner("");
      setName("");
      onCreated(repo);
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
      <div className="row">
        <input
          className="input"
          style={{ maxWidth: 160 }}
          placeholder="owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        />
        <span className="muted">/</span>
        <input
          className="input"
          style={{ maxWidth: 200 }}
          placeholder="repository"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn-primary" disabled={busy || !owner || !name} onClick={() => void submit()}>
          Connect repository
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
