/**
 * The sign-in card, which is all a signed-out visitor ever sees.
 *
 * It has to tell three situations apart: GitHub sign-in is available, this
 * deployment has none configured, and the API did not answer at all. Collapsing
 * the last two would send someone to reconfigure a deployment whose only problem
 * is that the API is down.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "@/components/session";
import { AppShell } from "@/components/shell";
import { clearToken } from "@/lib/session";

function stubAuthConfig(result: { github: boolean; devLogin: boolean } | "down"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (result === "down") throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(result), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function renderCard() {
  return render(
    <SessionProvider>
      <AppShell>
        <p>protected</p>
      </AppShell>
    </SessionProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearToken();
});

describe("the sign-in card", () => {
  it("offers GitHub when the API says it is configured", async () => {
    stubAuthConfig({ github: true, devLogin: false });

    renderCard();

    expect(await screen.findByRole("button", { name: /continue with github/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /dev login/i })).toBeNull();
    expect(screen.queryByText("protected")).toBeNull();
  });

  it("offers dev login only where the API still exposes it", async () => {
    stubAuthConfig({ github: false, devLogin: true });

    renderCard();

    expect(await screen.findByRole("button", { name: /dev login/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /continue with github/i })).toBeNull();
    expect(screen.getByText(/not configured on this deployment/i)).toBeDefined();
  });

  it("says the API is unreachable instead of blaming the configuration", async () => {
    stubAuthConfig("down");

    renderCard();

    await waitFor(() => expect(screen.getByText(/could not be reached/i)).toBeDefined());
    expect(screen.queryByText(/not configured on this deployment/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /continue with github/i })).toBeNull();
  });
});
