"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { UserClient } from "@/lib/settings/UserClient";
import { useModelsCatalog } from "@/lib/settings/useModelsCatalog";
import { useSpeechPrefs } from "@/lib/speech/useSpeechPrefs";
import { useThresholdPrefs } from "@/lib/grading/useThresholdPrefs";
import { THRESHOLD_PRESETS } from "@/lib/grading/thresholdPresets";
import type { GradingDefault, ModelInfoWire } from "@/lib/settings/wire";

function formatPriceHint(model: ModelInfoWire): string {
  const fmt = (n: number) => (n < 1 ? n.toFixed(2) : n.toFixed(0));
  return `$${fmt(model.inputPerMTok)} in / $${fmt(model.outputPerMTok)} out per 1M`;
}

const GRADING_OPTIONS: { value: GradingDefault; label: string }[] = [
  { value: "local", label: "Local" },
  { value: "ai", label: "AI-assisted" },
];

export function ProfilePage() {
  const { status, user, getAccessToken, logout } = useAuth();
  const {
    gradingDefault,
    setGradingDefault,
    gradingModel,
    setGradingModel,
    generationModel,
    setGenerationModel,
  } = useSettings();
  const { showSpeakButtons, setShowSpeakButtons } = useSpeechPrefs();
  const { preset: thresholdPreset, setPresetKey } = useThresholdPrefs();
  const { models } = useModelsCatalog();
  const isSignedIn = status === "signedIn";

  const gradingModelOptions = models.filter((m) => m.tasks.includes("grading"));
  const generationModelOptions = models.filter((m) => m.tasks.includes("generation"));

  const [signInMethods, setSignInMethods] = useState<{
    hasPassword: boolean;
    hasGoogle: boolean;
  } | null>(null);

  useEffect(() => {
    // Stale data from a previous session is harmless here — it's only ever
    // rendered inside the isSignedIn branch below, never while signed out.
    if (!isSignedIn) return;
    let cancelled = false;
    UserClient.getProfile(getAccessToken)
      .then((profile) => {
        if (!cancelled) {
          setSignInMethods({
            hasPassword: profile.hasPassword,
            hasGoogle: profile.hasGoogle,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  if (status === "loading") {
    return <div className="p-8 text-ink-3">Loading…</div>;
  }

  return (
    <div className="w-full max-w-xl mx-auto py-10 px-4 space-y-6">
      <h1 className="text-display tracking-tight">Profile</h1>

      {!isSignedIn ? (
        <div className="rounded-card border border-line bg-surface-1 p-6 space-y-2">
          <p className="text-meta text-ink-2">
            Sign in to manage your account and sync settings across devices.
          </p>
          <Link
            href="/login"
            className="inline-block text-button text-accent-hi hover:underline"
          >
            Sign in
          </Link>
        </div>
      ) : (
        <div className="rounded-card border border-line bg-surface-1 p-6 space-y-4">
          <div>
            <p className="text-micro text-ink-3 uppercase tracking-wide">
              Account
            </p>
            <p className="text-body text-ink-1 mt-1">{user?.email}</p>
            {signInMethods && (
              <p className="text-meta text-ink-3 mt-1">
                Signed in with{" "}
                {[
                  signInMethods.hasPassword && "email & password",
                  signInMethods.hasGoogle && "Google",
                ]
                  .filter(Boolean)
                  .join(" and ")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-button rounded-control border border-line-2 text-ink-2 px-4 py-2.5 hover:bg-surface-2 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}

      <div className="rounded-card border border-line bg-surface-1 p-6 space-y-3">
        <div>
          <p className="text-micro text-ink-3 uppercase tracking-wide">
            Default grading method
          </p>
          <p className="text-meta text-ink-2 mt-1">
            {isSignedIn
              ? "AI-assisted grades with the free local model first, and only asks Claude when it's unsure."
              : "Sign in to use AI-assisted grading — it needs a session to call Claude."}
          </p>
        </div>
        <div className="flex bg-surface-2 border border-line rounded-control p-1 gap-1">
          {GRADING_OPTIONS.map(({ value, label }) => {
            const active = gradingDefault === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setGradingDefault(value)}
                disabled={!isSignedIn}
                className={`flex-1 rounded-control py-3 text-button transition-colors ${
                  active
                    ? "bg-accent text-on-accent"
                    : "text-ink-2 hover:bg-surface-3"
                } ${!isSignedIn ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-card border border-line bg-surface-1 p-6 space-y-4">
        <div>
          <p className="text-micro text-ink-3 uppercase tracking-wide">
            AI models
          </p>
          <p className="text-meta text-ink-2 mt-1">
            Choose which model handles each AI task. Pricing shown is per
            provider, before any context-caching discount.
          </p>
        </div>
        <label className="block space-y-1">
          <span className="text-meta text-ink-2">Grade answers with</span>
          <select
            value={gradingModel}
            onChange={(e) => setGradingModel(e.target.value)}
            disabled={!isSignedIn}
            className="w-full rounded-control border border-line-2 bg-surface-2 text-ink-1 px-3 py-2.5 text-body disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {gradingModelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} — {formatPriceHint(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-meta text-ink-2">Generate questions with</span>
          <select
            value={generationModel}
            onChange={(e) => setGenerationModel(e.target.value)}
            disabled={!isSignedIn}
            className="w-full rounded-control border border-line-2 bg-surface-2 text-ink-1 px-3 py-2.5 text-body disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generationModelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} — {formatPriceHint(m)}
                {!m.supportsPdf ? " · no PDF" : ""}
              </option>
            ))}
          </select>
        </label>
        <Link
          href="/profile/usage"
          className="inline-block text-meta text-accent-hi hover:underline"
        >
          Usage &amp; costs →
        </Link>
      </div>

      <div className="rounded-card border border-line bg-surface-1 p-6 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-micro text-ink-3 uppercase tracking-wide">
              Read-aloud buttons
            </p>
            <p className="text-meta text-ink-2 mt-1">
              Show 🔊 buttons on card answers, using your device&apos;s
              built-in voices. This is a per-device setting — it doesn&apos;t
              sync, since available voices differ by device.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowSpeakButtons(!showSpeakButtons)}
            aria-pressed={showSpeakButtons}
            className={`shrink-0 rounded-control px-4 py-2.5 text-button transition-colors ${
              showSpeakButtons
                ? "bg-accent text-on-accent"
                : "bg-surface-2 border border-line-2 text-ink-2"
            }`}
          >
            {showSpeakButtons ? "On" : "Off"}
          </button>
        </div>
      </div>

      <div className="rounded-card border border-line bg-surface-1 p-6 space-y-3">
        <div>
          <p className="text-micro text-ink-3 uppercase tracking-wide">
            Grading strictness
          </p>
          <p className="text-meta text-ink-2 mt-1">
            {thresholdPreset.description}{" "}
            This is a per-device setting — it doesn&apos;t sync.
          </p>
        </div>
        <div className="flex bg-surface-2 border border-line rounded-control p-1 gap-1">
          {THRESHOLD_PRESETS.map(({ key, label }) => {
            const active = thresholdPreset.key === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setPresetKey(key)}
                className={`flex-1 rounded-control py-3 text-button transition-colors ${
                  active
                    ? "bg-accent text-on-accent"
                    : "text-ink-2 hover:bg-surface-3"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <Link
        href="/"
        className="inline-block text-meta text-ink-3 hover:text-ink-1 transition-colors"
      >
        ← Back to decks
      </Link>
    </div>
  );
}
