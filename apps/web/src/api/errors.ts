import type { ApiError, ApiErrorCode } from "./types";

export interface ErrorCopy {
  title: string;
  message: string;
  retry: boolean;
}

const BY_CODE: Record<ApiErrorCode, ErrorCopy> = {
  VALIDATION_FAILED: { title: "The scene has errors", message: "Fix the objects listed below, then try again.", retry: false },
  BAD_REQUEST: { title: "The request was not valid", message: "A field is missing or malformed.", retry: false },
  NOT_FOUND: { title: "Not found", message: "This environment or version does not exist.", retry: false },
  VERSION_CONFLICT: { title: "A newer version exists", message: "Someone saved while you were editing. Load the latest version or save on top of it.", retry: false },
  ALREADY_AT_VERSION: { title: "Already at that version", message: "There is nothing to restore.", retry: false },
  DB_VALIDATION_FAILED: { title: "Something went wrong", message: "The database refused the save. Your edits are still here.", retry: true },
  INTERNAL: { title: "Something went wrong", message: "The server hit an error. Your edits are still here.", retry: true },
  PROVIDER_UNAVAILABLE: { title: "The AI service is busy", message: "Nothing changed. Try again, or open the demo warehouse.", retry: true },
  RATE_LIMITED: { title: "Too many requests", message: "Wait a moment, then try again.", retry: true },
  FORBIDDEN: { title: "Not allowed", message: "You do not have access to this environment.", retry: false },
  COMPILE_FAILED: { title: "Could not build the USD file", message: "Your environment is unchanged.", retry: true },
};

export function copyFor(error: ApiError): ErrorCopy {
  switch (error.kind) {
    case "http":
      if (error.code === "RATE_LIMITED" && error.retryAfterSec) return { ...BY_CODE.RATE_LIMITED, message: `Try again in ${error.retryAfterSec} seconds.` };
      return BY_CODE[error.code];
    case "network":
      return { title: "Can't reach the server", message: "Check that the API is running, then try again.", retry: true };
    case "timeout":
      return { title: "This is taking too long", message: `The server did not answer in ${Math.round(error.afterMs / 1000)} seconds.`, retry: true };
    case "aborted":
      return { title: "Cancelled", message: "Nothing was created.", retry: true };
    case "schema":
      return { title: "Something went wrong", message: "The server sent data this app does not understand.", retry: true };
    case "photo":
      return { title: "That photo did not work", message: error.message, retry: false };
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
