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

/** Wraps authenticated pages: shows a dev-login gate until a session exists. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, login, logout } = useSession();

  if (loading) {
    return (
      <div className="center">
        <span className="muted">Loading…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="center">
        <div className="card" style={{ maxWidth: 380, textAlign: "center" }}>
          <div className="brand-mark" style={{ margin: "0 auto 14px" }}>
            ◆
          </div>
          <h2>Sign in to ProofForge</h2>
          <p className="muted" style={{ fontSize: "0.9rem" }}>
            GitHub OAuth arrives in Phase 5. For now, continue with a local development session.
          </p>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => void login()}>
            Continue with dev login
          </button>
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
