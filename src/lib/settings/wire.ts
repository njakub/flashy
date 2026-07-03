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
  hasPassword: boolean;
  hasGoogle: boolean;
}

export interface UpdateProfileRequestBody {
  gradingDefault: GradingDefault;
}
