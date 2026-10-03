import type { ValidationError, ValidationWarning } from "@twin/schema";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown[] = [],
    public warnings: ValidationWarning[] = [],
  ) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError(404, "NOT_FOUND", `${what} not found`);
export const badRequest = (message: string, details: unknown[] = []) => new AppError(400, "BAD_REQUEST", message, details);
export const validationFailed = (errors: ValidationError[], warnings: ValidationWarning[]) =>
  new AppError(400, "VALIDATION_FAILED", "Spec invalid", errors, warnings);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
