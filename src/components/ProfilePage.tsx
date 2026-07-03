"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { UserClient } from "@/lib/settings/UserClient";
import { useSpeechPrefs } from "@/lib/speech/useSpeechPrefs";
import type { GradingDefault } from "@/lib/settings/wire";

const GRADING_OPTIONS: { value: GradingDefault; label: string }[] = [
  { value: "local", label: "Local" },
  { value: "ai", label: "AI-assisted" },
];

export function ProfilePage() {
  const { status, user, getAccessToken, logout } = useAuth();
  const { gradingDefault, setGradingDefault } = useSettings();
  const { showSpeakButtons, setShowSpeakButtons } = useSpeechPrefs();
  const isSignedIn = status === "signedIn";

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

      <Link
        href="/"
        className="inline-block text-meta text-ink-3 hover:text-ink-1 transition-colors"
      >
        ← Back to decks
      </Link>
    </div>
  );
}
