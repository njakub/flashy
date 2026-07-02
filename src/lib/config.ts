/** Base URL of the flashy-api sync/auth backend. */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Google OAuth Client ID (Web application type) — used by @react-oauth/google
 * to request an ID token. Same value as the backend's GOOGLE_CLIENT_ID, which
 * verifies that token's audience; no client secret is needed for this flow.
 */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
