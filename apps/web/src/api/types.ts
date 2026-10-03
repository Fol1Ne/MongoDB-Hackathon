import type { AssetDefinition, EnvironmentSpec, ValidationError } from "../contract";

export type EnvId = string & { readonly __brand: "EnvId" };

export type Result<T, E = ApiError> = { ok: true; data: T } | { ok: false; error: E };
export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = <T>(error: ApiError): Result<T> => ({ ok: false, error });

export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "BAD_REQUEST",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "ALREADY_AT_VERSION",
  "DB_VALIDATION_FAILED",
  "INTERNAL",
  "PROVIDER_UNAVAILABLE",
  "RATE_LIMITED",
  "FORBIDDEN",
  "COMPILE_FAILED",
] as const;
export type ApiErrorCode = (typeof ERROR_CODES)[number];
export const isApiErrorCode = (c: string): c is ApiErrorCode => (ERROR_CODES as readonly string[]).includes(c);

export type ApiError =
  | { kind: "http"; status: number; code: ApiErrorCode; message: string; details: ValidationError[]; retryAfterSec: number | null }
  | { kind: "network"; message: string }
  | { kind: "timeout"; afterMs: number }
  | { kind: "aborted" }
  | { kind: "schema"; where: string; issues: string[] }
  | { kind: "photo"; message: string };

export interface EnvironmentDto {
  id: EnvId;
  name: string;
  type: EnvironmentSpec["environment"]["type"];
  headVersionId: string;
  versionCount: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VersionMeta {
  id: string;
  environmentId: string;
  version: number;
  parentVersionId: string | null;
  summaryText: string;
  changeNote: string | null;
  revertedFromVersion: number | null;
  createdAt: string;
}

export interface VersionDto extends VersionMeta {
  spec: EnvironmentSpec;
}

export interface Written {
  environment: EnvironmentDto;
  version: VersionDto;
}

export type Confidence = Readonly<Record<string, number>>;

export interface Created extends Written {
  confidence: Confidence | null;
  origin: "server" | "local";
}

export const PHASES = ["uploading", "analyzing", "estimating", "drafting", "validating", "saving"] as const;
export type Phase = (typeof PHASES)[number];
export const PHASE_LABEL: Record<Phase, string> = {
  uploading: "Uploading photos",
  analyzing: "Reading the photos",
  estimating: "Estimating size and layout",
  drafting: "Drafting the environment",
  validating: "Checking bounds and overlaps",
  saving: "Saving version 1",
};

export interface PreparedPhoto {
  id: string;
  name: string;
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
}

export interface StoredPhoto {
  name: string;
  blob: Blob;
  width: number;
  height: number;
}

export const KNOWN_DIMENSIONS = {
  door_height: "Door height",
  room_width: "Room width",
  room_length: "Room length",
  ceiling_height: "Ceiling height",
} as const;
export type KnownDimension = { kind: keyof typeof KNOWN_DIMENSIONS; meters: number };

export interface CallOptions {
  signal?: AbortSignal;
  onPhase?: (phase: Phase) => void;
}

export interface ApiClient {
  readonly mode: "mock" | "http";
  catalogue(): Promise<Result<AssetDefinition[]>>;
  listEnvironments(): Promise<Result<EnvironmentDto[]>>;
  getHead(id: EnvId): Promise<Result<Written & { confidence: Confidence | null }>>;
  listVersions(id: EnvId): Promise<Result<VersionMeta[]>>;
  getVersion(id: EnvId, n: number): Promise<Result<VersionDto>>;
  save(id: EnvId, input: { spec: EnvironmentSpec; changeNote: string; baseVersion: number }): Promise<Result<Written>>;
  revert(id: EnvId, input: { toVersion: number; baseVersion: number }): Promise<Result<Written>>;
  generate(input: { prompt: string }, opts?: CallOptions): Promise<Result<Created>>;
  fromImages(input: { photos: PreparedPhoto[]; hint: string; knownDimension: KnownDimension | null }, opts?: CallOptions): Promise<Result<Created>>;
  photos(id: EnvId): Promise<Result<StoredPhoto[]>>;
}
