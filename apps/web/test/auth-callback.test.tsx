/**
 * The page that receives a GitHub sign-in.
 *
 * It is the only place in the dashboard that handles a raw session token, and it
 * runs before any session exists — so nothing upstream can catch what it gets
 * wrong. What matters here is that the token is stored, that it does not linger
 * in the address bar, and that a failure says so instead of hanging on
 * "Signing you in…".
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AuthCallbackPage from "@/app/auth/callback/page";
import { SessionProvider } from "@/components/session";
import { clearToken, getToken } from "@/lib/session";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

function landOn(hash: string): void {
  window.history.replaceState(null, "", `/auth/callback${hash}`);
}

/** The provider calls `/auth/config` on mount, and `adopt` calls `/me`. */
function stubApi(user: unknown = { id: "u_1", name: "Octocat" }, meOk = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/auth/config")) {
        return new Response(JSON.stringify({ github: true, devLogin: false }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(meOk ? user : { error: "unauthorized" }), {
        status: meOk ? 200 : 401,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function renderPage() {
  return render(
    <SessionProvider>
      <AuthCallbackPage />
    </SessionProvider>,
  );
}

beforeEach(() => {
  clearToken();
  replace.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearToken();
});

describe("the OAuth callback page", () => {
  it("stores the token and continues to where the flow started", async () => {
    stubApi();
    landOn("#token=tok_abc&redirect=%2Frepositories%2F7");

    renderPage();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/repositories/7"));
    expect(getToken()).toBe("tok_abc");
  });

  it("erases the token from the address bar", async () => {
    stubApi();
    landOn("#token=tok_abc");

    renderPage();

    // Immediately, not after the network call: a fragment left in place stays
    // in history, and the back button would hand it to whatever loads next.
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(window.location.pathname).toBe("/auth/callback");
  });

  it("refuses to bounce off-site on a crafted fragment", async () => {
    stubApi();
    landOn("#token=tok_abc&redirect=%2F%2Fevil.example");

    renderPage();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("explains a declined authorization", async () => {
    stubApi();
    landOn("#error=access_denied");

    renderPage();

    expect(await screen.findByText(/declined/i)).toBeDefined();
    expect(replace).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });

  it("keeps no token the API will not accept", async () => {
    stubApi(undefined, false);
    landOn("#token=stale");

    renderPage();

    await waitFor(() => expect(screen.getByText(/was not accepted/i)).toBeDefined());
    expect(getToken()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("says so when opened on its own", async () => {
    stubApi();
    landOn("");

    renderPage();

    expect(await screen.findByText(/opens at the end of a GitHub sign-in/i)).toBeDefined();
  });
});
