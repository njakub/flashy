"use client";

import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";

export function AuthBar() {
  const { status, user, logout, syncing, syncError, lastSyncAt } = useAuth();

  if (status === "loading") return null;

  return (
    <div className="w-full border-b border-line bg-surface-1 px-4 py-2 flex items-center justify-end gap-3 text-meta text-ink-3">
      {status === "signedOut" ? (
        <Link href="/login" className="text-accent-hi hover:underline">
          Sign in for cross-device sync
        </Link>
      ) : (
        <>
          <span title={lastSyncAt ?? undefined}>
            {syncing
              ? "Syncing…"
              : syncError
                ? `Sync error: ${syncError}`
                : "Synced"}
          </span>
          <span className="text-ink-3">{user?.email}</span>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-accent-hi hover:underline"
          >
            Sign out
          </button>
        </>
      )}
    </div>
  );
}
