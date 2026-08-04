export class ContractError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ContractError";
  }
}

export interface RepositoryRef { owner: string; name: string }
export interface VisualAnchorMetadata {
  page: string;
  originCommit: string;
  stableId: string | null;
  selector: string;
  textFingerprint: string;
  point: { x: number; y: number };
  viewport: { width: number; height: number };
}
export interface ReviewComment {
  id: string;
  databaseId: number;
  author: { id: string; login: string; avatarUrl: string | null };
  body: string;
  createdAt: string;
  updatedAt: string;
}
export interface ReviewThread {
  id: string;
  path: string;
  isResolved: boolean;
  comments: ReviewComment[];
  anchor: VisualAnchorMetadata | null;
  anchorHealth: "attached" | "uncertain" | "detached" | null;
}
export interface LiveAnchorMetadata {
  targetCommentNodeId: string;
  url: string;
  point: { xRatio: number; yRatio: number };
  viewport: { width: number; height: number };
}
export type ReviewTargetValue =
  | { type: "repository"; path: string }
  | { type: "live"; url: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractError("invalid_contract", `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string, maximum = 10_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new ContractError("invalid_contract", `${field} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ContractError("invalid_contract", `${field} must be a positive safe integer`);
  }
  return value as number;
}

function exactFields(value: Record<string, unknown>, fields: string[], label: string): void {
  const allowed = new Set(fields);
  if (Object.keys(value).length !== fields.length || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ContractError("invalid_contract", `${label} has unsupported fields`);
  }
}

function ratio(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ContractError("invalid_anchor", `${field} must be between 0 and 1`);
  }
  return value;
}

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function encodeCanonicalBase64Url(value: unknown, maximumBytes: number): string {
  const bytes = encoder.encode(JSON.stringify(value));
  if (bytes.byteLength > maximumBytes) throw new ContractError("metadata_too_large", "metadata is too large");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeCanonicalBase64Url(value: string, maximumBytes: number): unknown | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.byteLength > maximumBytes) return null;
    const parsed = JSON.parse(decoder.decode(bytes)) as unknown;
    return encodeCanonicalBase64Url(parsed, maximumBytes) === value ? parsed : null;
  } catch {
    return null;
  }
}

function exactTrailingMarker(body: string, namespace: string, version: number) {
  const escaped = namespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const markers = body.match(new RegExp(`<!--\\s*${escaped}:v[\\s\\S]*?-->`, "g"));
  if (markers?.length !== 1) return null;
  const match = new RegExp(`<!-- ${escaped}:v(\\d+) ([A-Za-z0-9_-]+) -->$`).exec(body);
  if (!match || match[1] !== String(version) || markers[0] !== match[0]) return null;
  const prefix = body.slice(0, match.index);
  if (!prefix.endsWith("\n\n")) return null;
  const visibleBody = prefix.slice(0, -2);
  if (!visibleBody.trim()) return null;
  return { payload: match[2]!, visibleBody };
}

export function validateRepositoryRef(value: unknown): RepositoryRef {
  const candidate = record(value, "repository");
  if (typeof candidate.owner !== "string" || !OWNER_PATTERN.test(candidate.owner)) {
    throw new ContractError("invalid_repository", "repository owner is invalid");
  }
  if (
    typeof candidate.name !== "string" ||
    !REPOSITORY_PATTERN.test(candidate.name) ||
    candidate.name === "." || candidate.name === ".."
  ) {
    throw new ContractError("invalid_repository", "repository name is invalid");
  }
  return { owner: candidate.owner, name: candidate.name };
}

export function validatePullNumber(value: unknown): number {
  return positiveInteger(value, "pull number");
}

export function validateCommitSha(value: unknown): string {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    throw new ContractError("invalid_commit_sha", "commit SHA must be 40 lowercase hexadecimal characters");
  }
  return value;
}

export function normalizeRepositoryPath(value: unknown): string {
  const path = string(value, "repository path", 4_096);
  if (
    path !== path.trim() || path.startsWith("/") || path.includes("\\") || path.includes("\0") ||
    path.endsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new ContractError("invalid_path", `unsafe repository path: ${path}`);
  }
  return path;
}

function validateVisualAnchorMetadata(value: unknown): VisualAnchorMetadata {
  const candidate = record(value, "visual anchor metadata");
  const point = record(candidate.point, "visual anchor point");
  const viewport = record(candidate.viewport, "visual anchor viewport");
  const page = normalizeRepositoryPath(candidate.page);
  if (!/\.(?:html|md)$/i.test(page)) throw new ContractError("invalid_anchor", "visual anchor must target HTML or Markdown");
  const stableId = candidate.stableId;
  if (stableId !== null && (typeof stableId !== "string" || !stableId || stableId.length > 500)) {
    throw new ContractError("invalid_anchor", "stable ID is invalid");
  }
  const width = positiveInteger(viewport.width, "anchor viewport width");
  const height = positiveInteger(viewport.height, "anchor viewport height");
  if (width > 20_000 || height > 20_000) throw new ContractError("invalid_anchor", "viewport is too large");
  return {
    page,
    originCommit: validateCommitSha(candidate.originCommit),
    stableId,
    selector: string(candidate.selector, "anchor selector", 2_000).trim(),
    textFingerprint: typeof candidate.textFingerprint === "string" && candidate.textFingerprint.length <= 500
      ? candidate.textFingerprint.trim()
      : (() => { throw new ContractError("invalid_anchor", "text fingerprint is invalid"); })(),
    point: { x: ratio(point.x, "point.x"), y: ratio(point.y, "point.y") },
    viewport: { width, height },
  };
}

const VISUAL_PREFIX = "space-station-anchor:v1";
const MAX_VISUAL_METADATA_BYTES = 16 * 1024;
const MAX_COMMENT_BYTES = 60 * 1024;

export function appendVisualMetadata(visibleBody: string, value: unknown): string {
  if (typeof visibleBody !== "string" || !visibleBody.trim()) throw new ContractError("invalid_comment_body", "body must not be empty");
  const anchor = validateVisualAnchorMetadata(value);
  const body = `${visibleBody}\n\n<!-- ${VISUAL_PREFIX} ${encodeCanonicalBase64Url(anchor, MAX_VISUAL_METADATA_BYTES)} -->`;
  if (utf8Bytes(body) > MAX_COMMENT_BYTES) throw new ContractError("comment_body_too_large", "comment body is too large");
  return body;
}

export function parseVisualCommentBody(body: string): { visibleBody: string; anchor: VisualAnchorMetadata | null } {
  const ordinary = () => ({ visibleBody: body, anchor: null });
  const match = exactTrailingMarker(body, "space-station-anchor", 1);
  if (!match) return ordinary();
  const parsed = decodeCanonicalBase64Url(match.payload, MAX_VISUAL_METADATA_BYTES);
  try {
    const anchor = validateVisualAnchorMetadata(parsed);
    if (encodeCanonicalBase64Url(anchor, MAX_VISUAL_METADATA_BYTES) !== match.payload) return ordinary();
    return { visibleBody: match.visibleBody, anchor };
  } catch {
    return ordinary();
  }
}

const PROHIBITED_SUFFIXES = ["localhost", "local", "localdomain", "internal", "intranet", "home", "lan", "test", "invalid"];
function normalizeLiveUrl(value: unknown): string {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 2_048 || value.includes("#") || /[^\x20-\x7e]/.test(value)) {
    throw new ContractError("invalid_live_url", "Live URL is invalid");
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new ContractError("invalid_live_url", "Live URL is invalid"); }
  const hostname = url.hostname.toLowerCase();
  const labels = hostname.split(".");
  if (
    url.protocol !== "https:" || url.username || url.password || url.hash || url.port || labels.length < 2 ||
    hostname.startsWith("[") || hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(hostname) ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    PROHIBITED_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)) ||
    /%(?:2f|5c|00)/i.test(url.pathname)
  ) {
    throw new ContractError("invalid_live_url", "Live URL is invalid");
  }
  return url.href;
}

function validateReviewTargetValue(value: unknown): ReviewTargetValue {
  const candidate = record(value, "review target");
  if (candidate.type === "repository") {
    exactFields(candidate, ["type", "path"], "repository target");
    const path = normalizeRepositoryPath(candidate.path);
    if (!/\.(?:html|md)$/i.test(path) || /[%?#\u0000-\u001f\u007f]/.test(path)) {
      throw new ContractError("invalid_review_target", "repository target is invalid");
    }
    return { type: "repository", path };
  }
  if (candidate.type === "live") {
    exactFields(candidate, ["type", "url"], "Live target");
    return { type: "live", url: normalizeLiveUrl(candidate.url) };
  }
  throw new ContractError("invalid_review_target", "review target type is invalid");
}

function reviewTargetVisibleText(target: ReviewTargetValue): string {
  return target.type === "repository" ? `Repository preview target: ${target.path}` : `Live preview target: ${target.url}`;
}

export function parseReviewTargetCommentBody(bodyValue: unknown): { visibleBody: string; target: ReviewTargetValue | null } {
  const body = typeof bodyValue === "string" ? bodyValue : String(bodyValue);
  const ordinary = () => ({ visibleBody: body, target: null });
  if (utf8Bytes(body) > MAX_COMMENT_BYTES) return ordinary();
  const match = exactTrailingMarker(body, "space-station-preview-target", 1);
  if (!match) return ordinary();
  const parsed = decodeCanonicalBase64Url(match.payload, 8 * 1024);
  try {
    const target = validateReviewTargetValue(parsed);
    if (encodeCanonicalBase64Url(target, 8 * 1024) !== match.payload || match.visibleBody !== reviewTargetVisibleText(target)) return ordinary();
    return { visibleBody: match.visibleBody, target };
  } catch {
    return ordinary();
  }
}

function validateLiveAnchorMetadata(value: unknown): LiveAnchorMetadata {
  const candidate = record(value, "Live anchor");
  exactFields(candidate, ["targetCommentNodeId", "url", "point", "viewport"], "Live anchor");
  const point = record(candidate.point, "Live anchor point");
  const viewport = record(candidate.viewport, "Live anchor viewport");
  exactFields(point, ["xRatio", "yRatio"], "Live anchor point");
  exactFields(viewport, ["width", "height"], "Live anchor viewport");
  const targetCommentNodeId = string(candidate.targetCommentNodeId, "target comment node ID", 500);
  const width = positiveInteger(viewport.width, "viewport.width");
  const height = positiveInteger(viewport.height, "viewport.height");
  if (width > 20_000 || height > 20_000) throw new ContractError("invalid_live_anchor", "viewport is too large");
  return {
    targetCommentNodeId,
    url: normalizeLiveUrl(candidate.url),
    point: { xRatio: ratio(point.xRatio, "point.xRatio"), yRatio: ratio(point.yRatio, "point.yRatio") },
    viewport: { width, height },
  };
}

function liveAnchorVisibleText(anchor: LiveAnchorMetadata): string {
  return `Live preview: ${anchor.url}\nCoordinate: ${anchor.point.xRatio.toFixed(6)}, ${anchor.point.yRatio.toFixed(6)} · ${anchor.viewport.width}×${anchor.viewport.height}`;
}

export function appendLiveAnchorMarker(visibleFeedback: unknown, value: unknown): string {
  const feedback = string(visibleFeedback, "Live feedback body", 50_000).trim();
  const anchor = validateLiveAnchorMetadata(value);
  const payload = encodeCanonicalBase64Url(anchor, 12 * 1024);
  const body = `${feedback}\n\n${liveAnchorVisibleText(anchor)}\n\n<!-- space-station-live-anchor:v1 ${payload} -->`;
  if (utf8Bytes(body) > MAX_COMMENT_BYTES) throw new ContractError("comment_body_too_large", "comment body is too large");
  return body;
}
