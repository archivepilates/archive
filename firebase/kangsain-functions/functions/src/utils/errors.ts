import { HttpsError } from "firebase-functions/v2/https";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export function toHttpsError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof AppError) {
    if (err.code === "AUTH_REQUIRED") return new HttpsError("unauthenticated", err.message);
    if (err.code === "PERMISSION_DENIED") return new HttpsError("permission-denied", err.message);
    if (err.code === "INVALID_ARGUMENT") return new HttpsError("invalid-argument", err.message);
    if (err.code === "NOT_FOUND") return new HttpsError("not-found", err.message);
    return new HttpsError("internal", err.message);
  }
  return new HttpsError("internal", err instanceof Error ? err.message : "Unknown error");
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
