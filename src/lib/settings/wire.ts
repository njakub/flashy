/**
 * Wire protocol for GET/PATCH /users/me — mirrors flashy-api's
 * src/users/users.schema.ts + UsersService's Profile shape. Hand-maintained
 * mirror, same convention as src/lib/sync/wire.ts and src/lib/grading/wire.ts.
 */

export type GradingDefault = "local" | "ai";

export interface ProfileResponseBody {
  userId: string;
  email: string;
  gradingDefault: GradingDefault;
  /** Registry model id (see ModelInfoWire) used for AI grading. */
  gradingModel: string;
  /** Registry model id used for AI card generation. */
  generationModel: string;
  hasPassword: boolean;
  hasGoogle: boolean;
}

/** All fields optional — PATCH sends only the field(s) that changed. */
export interface UpdateProfileRequestBody {
  gradingDefault?: GradingDefault;
  gradingModel?: string;
  generationModel?: string;
}

/**
 * Wire protocol for GET /models — mirrors flashy-api's src/llm/models.ts
 * registry, exposed over HTTP so the client never hand-mirrors pricing.
 */
export type LlmProviderId = "anthropic" | "google" | "deepseek";
export type LlmTaskId = "grading" | "generation";

export interface ModelInfoWire {
  id: string;
  provider: LlmProviderId;
  providerModelId: string;
  displayName: string;
  inputPerMTok: number;
  cachedInputPerMTok: number;
  outputPerMTok: number;
  supportsPdf: boolean;
  qualityTier: 1 | 2 | 3;
  tasks: LlmTaskId[];
}

export interface ModelsResponseBody {
  models: ModelInfoWire[];
  defaults: { grading: string; generation: string };
}
