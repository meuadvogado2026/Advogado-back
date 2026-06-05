export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "PASSWORD_CHANGE_REQUIRED"
  | "NOT_IMPLEMENTED"
  | "UPSTREAM_ERROR";

export function apiError(code: ApiErrorCode, message: string, details: unknown[] = []) {
  return {
    error: {
      code,
      message,
      details
    }
  };
}
