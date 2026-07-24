"use client";

import type { User } from "@proofforge/shared-types";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, githubLoginUrl, type AuthConfig } from "@/lib/api";
import { clearToken, getToken, setToken } from "@/lib/session";

/**
 * What the dashboard knows about how to sign in: nothing yet, the answer, or
 * that the API could not be reached. The third case has to stay distinguishable
 * from `{github: false}` — telling someone their deployment has no GitHub login
 * when the API is simply down sends them to fix the wrong thing.
 */
export type AuthMethods = AuthConfig | "unknown" | "unreachable";

interface SessionState {
  user: User | null;
  loading: boolean;
  methods: AuthMethods;
  devLogin: () => Promise<void>;
  loginWithGitHub: (redirectTo?: string) => void;
  logout: () => void;
  /** Adopt a session the OAuth callback just delivered. */
  adopt: (token: string) => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [methods, setMethods] = useState<AuthMethods>("unknown");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Both run regardless of whether a token exists: the sign-in card needs to
    // know what to offer precisely when nobody is signed in.
    void api
      .authConfig()
      .then(setMethods)
      .catch(() => setMethods("unreachable"));

    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => {
        clearToken();
      })
      .finally(() => setLoading(false));
  }, []);

  const devLogin = useCallback(async () => {
    const result = await api.devLogin();
    setToken(result.token);
    setUser(result.user);
  }, []);

  const loginWithGitHub = useCallback((redirectTo = "/dashboard") => {
    window.location.assign(githubLoginUrl(redirectTo));
  }, []);

  const adopt = useCallback(async (token: string) => {
    setToken(token);
    try {
      setUser(await api.me());
    } catch (error) {
      // A token the API will not accept is worse than none: it would leave the
      // dashboard retrying against a session that does not exist.
      clearToken();
      throw error;
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider
      value={{ user, loading, methods, devLogin, loginWithGitHub, logout, adopt }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
