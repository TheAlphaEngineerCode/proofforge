import Link from "next/link";

export default function LandingPage() {
  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <div className="brand">
            <span className="brand-mark">◆</span>
            <span>ProofForge</span>
          </div>
          <Link href="/dashboard" className="btn btn-primary">
            Open dashboard
          </Link>
        </div>
      </nav>

      <div className="container">
        <section className="hero">
          <span className="pill">Proof-Carrying Change</span>
          <h1>Autonomous Software Engineering with Verifiable Changes</h1>
          <p>
            ProofForge turns every change — human or AI — into an auditable, reproducible and
            verifiable record. No change is trusted without technical evidence attached to it.
          </p>
          <div className="row" style={{ justifyContent: "center" }}>
            <Link href="/dashboard" className="btn btn-primary">
              Connect a repository
            </Link>
            <a
              href="https://github.com/proofforge/proofforge"
              className="btn"
              target="_blank"
              rel="noreferrer"
            >
              View on GitHub
            </a>
          </div>
        </section>

        <section className="section grid grid-2">
          <div className="card">
            <h3>Evidence, not vibes</h3>
            <p className="muted">
              Tests, coverage, security scans, dependencies, performance and operations — collected
              into a signed, hashable <span className="mono">proof-manifest.json</span> anyone can
              re-verify.
            </p>
          </div>
          <div className="card">
            <h3>Generation ≠ validation</h3>
            <p className="muted">
              The components that write code are separate from the ones that judge it. An
              independent reviewer must agree before a change is trusted.
            </p>
          </div>
          <div className="card">
            <h3>Transparent risk</h3>
            <p className="muted">
              A deterministic, explainable risk score — every point is justifiable, never an opaque
              number produced by a model.
            </p>
          </div>
          <div className="card">
            <h3>Sandboxed by default</h3>
            <p className="muted">
              Repository code runs only in ephemeral, network-isolated containers — never on the
              host — and repository content is treated as untrusted input.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="card">
            <h3>Verify a manifest with the CLI</h3>
            <div className="codeblock">
              {`proofforge manifest validate proof-manifest.json
proofforge evidence verify   proof-manifest.json  →  ✓ VERIFIED`}
            </div>
          </div>
        </section>

        <footer className="section muted" style={{ textAlign: "center", fontSize: "0.85rem" }}>
          Apache-2.0 · Proof-manifest spec 1.0.0
        </footer>
      </div>
    </>
  );
}
