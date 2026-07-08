import { authedFetch, type AccessTokenGetter } from "./UserClient";
import type { ModelsResponseBody } from "./wire";

const CATALOG_CACHE_KEY = "flashy_models_catalog";

/**
 * Hardcoded fallback for the very first render before the network catalog
 * has ever loaded (or when offline) — mirrors flashy-api's src/llm/models.ts
 * defaults only, not the full registry. Once a real GET /models response has
 * been cached, that's used instead.
 */
const COLD_START_DEFAULTS: ModelsResponseBody = {
  models: [],
  defaults: { grading: "gemini-2.5-flash-lite", generation: "gemini-2.5-flash" },
};

export function readCachedModelsCatalog(): ModelsResponseBody {
  if (typeof window === "undefined") return COLD_START_DEFAULTS;
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return COLD_START_DEFAULTS;
    return JSON.parse(raw) as ModelsResponseBody;
  } catch {
    return COLD_START_DEFAULTS;
  }
}

/** Thin wrapper over flashy-api's guarded GET /models endpoint. */
export const ModelsClient = {
  async list(getAccessToken: AccessTokenGetter): Promise<ModelsResponseBody> {
    const catalog = await authedFetch<ModelsResponseBody>(
      "/models",
      "GET",
      getAccessToken,
    );
    if (typeof window !== "undefined") {
      localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(catalog));
    }
    return catalog;
  },
};
