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
const GRADING_MODEL_CACHE_KEY = "flashy_grading_model";
const GENERATION_MODEL_CACHE_KEY = "flashy_generation_model";

// Cold-start fallbacks for the very first render, before any GET /users/me
// has landed — mirrors flashy-api's src/llm/models.ts task defaults. Once a
// real profile has been fetched, its values (and this cache) take over.
const GRADING_MODEL_FALLBACK = "gemini-2.5-flash-lite";
const GENERATION_MODEL_FALLBACK = "gemini-2.5-flash";

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
  /** Registry model id (see ModelInfoWire) used for AI grading. Same sync/cache pattern as gradingDefault. */
  gradingModel: string;
  setGradingModel(value: string): void;
  /** Registry model id used for AI card generation. Same sync/cache pattern as gradingDefault. */
  generationModel: string;
  setGenerationModel(value: string): void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readCached(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { status, getAccessToken } = useAuth();
  const [gradingDefault, setGradingDefaultState] = useState<GradingDefault>(
    () => (readCached(GRADING_DEFAULT_CACHE_KEY, "local") === "ai" ? "ai" : "local"),
  );
  const [gradingModel, setGradingModelState] = useState<string>(() =>
    readCached(GRADING_MODEL_CACHE_KEY, GRADING_MODEL_FALLBACK),
  );
  const [generationModel, setGenerationModelState] = useState<string>(() =>
    readCached(GENERATION_MODEL_CACHE_KEY, GENERATION_MODEL_FALLBACK),
  );

  // Pull the server-authoritative values on sign-in, so preferences set on
  // another device are picked up here too. Best-effort — offline/error just
  // keeps whatever's cached.
  useEffect(() => {
    if (status !== "signedIn") return;
    let cancelled = false;
    UserClient.getProfile(getAccessToken)
      .then((profile) => {
        if (cancelled) return;
        setGradingDefaultState(profile.gradingDefault);
        localStorage.setItem(GRADING_DEFAULT_CACHE_KEY, profile.gradingDefault);
        setGradingModelState(profile.gradingModel);
        localStorage.setItem(GRADING_MODEL_CACHE_KEY, profile.gradingModel);
        setGenerationModelState(profile.generationModel);
        localStorage.setItem(GENERATION_MODEL_CACHE_KEY, profile.generationModel);
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

  const setGradingModel = useCallback(
    (value: string) => {
      setGradingModelState(value);
      localStorage.setItem(GRADING_MODEL_CACHE_KEY, value);
      if (status === "signedIn") {
        UserClient.updateProfile(getAccessToken, { gradingModel: value }).catch(() => {});
      }
    },
    [status, getAccessToken],
  );

  const setGenerationModel = useCallback(
    (value: string) => {
      setGenerationModelState(value);
      localStorage.setItem(GENERATION_MODEL_CACHE_KEY, value);
      if (status === "signedIn") {
        UserClient.updateProfile(getAccessToken, { generationModel: value }).catch(() => {});
      }
    },
    [status, getAccessToken],
  );

  return (
    <SettingsContext.Provider
      value={{
        gradingDefault,
        setGradingDefault,
        gradingModel,
        setGradingModel,
        generationModel,
        setGenerationModel,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
