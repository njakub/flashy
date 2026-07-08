"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { ModelsClient, readCachedModelsCatalog } from "./ModelsClient";
import type { ModelsResponseBody } from "./wire";

/**
 * The LLM provider/model registry (flashy-api's src/llm/models.ts), fetched
 * once per session and cached to localStorage for instant reads on
 * subsequent visits. Read-only reference data — not a user preference, so
 * it lives outside SettingsProvider; ProfilePage and the usage dashboard
 * both consume this directly.
 */
export function useModelsCatalog(): ModelsResponseBody {
  const { status, getAccessToken } = useAuth();
  const [catalog, setCatalog] = useState<ModelsResponseBody>(readCachedModelsCatalog);

  useEffect(() => {
    if (status !== "signedIn") return;
    let cancelled = false;
    ModelsClient.list(getAccessToken)
      .then((result) => {
        if (!cancelled) setCatalog(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return catalog;
}
