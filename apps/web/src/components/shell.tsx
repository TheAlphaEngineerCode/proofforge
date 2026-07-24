"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useSession } from "@/components/session";

function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="brand-mark">◆</span>
      <span>ProofForge</span>
    </Link>
  );
}

/** Wraps authenticated pages: shows the sign-in gate until a session exists. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, methods, devLogin, loginWithGitHub, logout } = useSession();

  if (loading) {
    return (
      <div className="center">
        <span className="muted">Loading…</span>
      </div>
    );
  }

  if (!user) {
    // "The API did not answer" and "this deployment has no GitHub login" call for
    // different things from the reader, so the card never states one as the other.
    const available = typeof methods === "string" ? null : methods;
    const notice =
      methods === "unreachable"
        ? "The API could not be reached, so there is no way to tell which sign-in methods exist."
        : methods === "unknown"
          ? "Checking which sign-in methods are available…"
          : "GitHub sign-in is not configured on this deployment.";

    return (
      <div className="center">
        <div className="card" style={{ maxWidth: 380, textAlign: "center" }}>
          <div className="brand-mark" style={{ margin: "0 auto 14px" }}>
            ◆
          </div>
          <h2>Sign in to ProofForge</h2>
          <p className="muted" style={{ fontSize: "0.9rem" }}>
            {available?.github
              ? "ProofForge signs you in with the GitHub account it already verifies changes for."
              : notice}
          </p>
          {available?.github ? (
            <button
              className="btn btn-primary"
              style={{ width: "100%" }}
              onClick={() => loginWithGitHub()}
            >
              Continue with GitHub
            </button>
          ) : null}
          {/* Only ever offered where the API still exposes it — never in production. */}
          {available?.devLogin ? (
            <button
              className="btn"
              style={{ width: "100%", marginTop: available.github ? 10 : 0 }}
              onClick={() => void devLogin()}
            >
              Continue with dev login
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <Brand />
          <div className="row">
            <Link href="/dashboard" className="btn">
              Dashboard
            </Link>
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              {user.name}
            </span>
            <button className="btn" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </nav>
      <main className="container section">{children}</main>
    </>
  );
}
