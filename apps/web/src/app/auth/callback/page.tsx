"use client";

/**
 * Where GitHub's sign-in lands.
 *
 * The API puts the session token in the URL fragment, which never leaves the
 * browser, so this page is the only thing that can read it. It stores the token,
 * erases the fragment from the address bar and history, and moves on.
 *
 * Deliberately outside `AppShell`: this page runs *before* a session exists, and
 * the shell would flash its sign-in card over a login that is still succeeding.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/session";

const MESSAGES: Record<string, string> = {
  access_denied: "The GitHub authorization was declined.",
  invalid_state: "That sign-in link has expired. Please start again.",
  oauth_failed: "GitHub sign-in could not be completed.",
};

/** The fragment is not signed, so a crafted link cannot be allowed to redirect off-site. */
function safePath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/dashboard";
  }
  return raw;
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const { adopt } = useSession();
  const [error, setError] = useState<string | null>(null);
  // React runs effects twice in development; adopting a token twice would create
  // a second session for no reason.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    // Drop the token from the address bar and from the back button's reach
    // before anything can await; a fragment survives navigation otherwise.
    window.history.replaceState(null, "", window.location.pathname);

    const failure = params.get("error");
    if (failure) {
      setError(MESSAGES[failure] ?? "GitHub sign-in failed.");
      return;
    }

    const token = params.get("token");
    if (!token) {
      setError("This page opens at the end of a GitHub sign-in.");
      return;
    }

    adopt(token)
      .then(() => router.replace(safePath(params.get("redirect"))))
      .catch(() => setError("The session GitHub issued was not accepted."));
  }, [adopt, router]);

  return (
    <div className="center">
      <div className="card" style={{ maxWidth: 380, textAlign: "center" }}>
        <div className="brand-mark" style={{ margin: "0 auto 14px" }}>
          ◆
        </div>
        {error ? (
          <>
            <h2>Sign-in failed</h2>
            <p className="muted" style={{ fontSize: "0.9rem" }}>
              {error}
            </p>
            <button
              className="btn btn-primary"
              style={{ width: "100%" }}
              onClick={() => router.replace("/dashboard")}
            >
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <h2>Signing you in…</h2>
            <p className="muted" style={{ fontSize: "0.9rem" }}>
              Completing the GitHub authorization.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
