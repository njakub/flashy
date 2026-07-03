"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthProvider";
import { UserClient } from "@/lib/settings/UserClient";
import type { GradingDefault } from "@/lib/settings/wire";

const GRADING_DEFAULT_CACHE_KEY = "flashy_grading_default";

interface SettingsContextValue {
  /**
   * The user's preferred grading method. Server-authoritative + synced when
   * signed in (mirrored to localStorage for instant/offline reads); a plain
   * local cache when signed out. Consumers that need auth-gated behavior
   * (the AI grader requires a session) combine this with useAuth().status
   * themselves — this provider doesn't force a signed-out fallback, so the
   * profile toggle can still show what the account is set to.
   */
  gradingDefault: GradingDefault;
  setGradingDefault(value: GradingDefault): void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readCachedGradingDefault(): GradingDefault {
  if (typeof window === "undefined") return "local";
  return localStorage.getItem(GRADING_DEFAULT_CACHE_KEY) === "ai"
    ? "ai"
    : "local";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { status, getAccessToken } = useAuth();
  const [gradingDefault, setGradingDefaultState] = useState<GradingDefault>(
    readCachedGradingDefault,
  );

  // Pull the server-authoritative value on sign-in, so a preference set on
  // another device is picked up here too. Best-effort — offline/error just
  // keeps whatever's cached.
  useEffect(() => {
    if (status !== "signedIn") return;
    let cancelled = false;
    UserClient.getProfile(getAccessToken)
      .then((profile) => {
        if (cancelled) return;
        setGradingDefaultState(profile.gradingDefault);
        localStorage.setItem(GRADING_DEFAULT_CACHE_KEY, profile.gradingDefault);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const setGradingDefault = useCallback(
    (value: GradingDefault) => {
      setGradingDefaultState(value);
      localStorage.setItem(GRADING_DEFAULT_CACHE_KEY, value);
      if (status === "signedIn") {
        UserClient.updateProfile(getAccessToken, {
          gradingDefault: value,
        }).catch(() => {
          // Best-effort — local state/cache already reflect the choice;
          // the next successful GET reconciles against the server.
        });
      }
    },
    [status, getAccessToken],
  );

  return (
    <SettingsContext.Provider value={{ gradingDefault, setGradingDefault }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
