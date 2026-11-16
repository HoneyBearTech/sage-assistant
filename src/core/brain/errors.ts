import { isConnectionRefused, isTimeout, readTextCapped } from "./brain.js";

/**
 * Plain messages for an online service that couldn't answer. A service's own error text, and every
 * header, is never shown or logged (some services echo the request, key and all): the message is
 * chosen from the HTTP status and a few known error-type fields only.
 */

/** How messages name the service: "Claude" for a ready-made one, "The online service" otherwise. */
export interface ServiceName {
  /** At the start of a sentence. */
  subject: string;
  /** In the middle of one. */
  ref: string;
  /** "other": a 404 may also mean a wrong address, and a refused connection points at the address. */
  other?: boolean;
}

export const OTHER_SERVICE: ServiceName = {
  subject: "The online service",
  ref: "the online service",
  other: true,
};

export function serviceName(name: string): ServiceName {
  return { subject: name, ref: name };
}

/**
 * Kinds Sage adds itself from what an error says, not from a type field (see `readErrorKinds`).
 * `CREDIT_TOO_LOW`: prepaid credit used up (Anthropic answers this with a plain 400).
 * `QUOTA_PER_DAY`: a daily quota used up (Google's 429 with a per-day QuotaFailure), so waiting a
 * minute won't help. `THINKING_SIGNATURE`: the service refused a thinking block it sent earlier.
 */
export const CREDIT_TOO_LOW = "sage:credit_too_low";
export const QUOTA_PER_DAY = "sage:quota_per_day";
export const THINKING_SIGNATURE = "sage:thinking_signature";

/**
 * Fixed, lower-case phrases looked for in an error's message, and the kind each one means. The
 * message itself is only searched for these: never shown, logged or kept.
 */
const MESSAGE_PHRASES: readonly [phrase: string, kind: string][] = [
  ["credit balance", CREDIT_TOO_LOW],
  ["invalid `signature` in `thinking` block", THINKING_SIGNATURE],
  ["invalid signature in thinking block", THINKING_SIGNATURE],
];

/** Error types and codes that mean the credit, quota or spending limit is used up. */
const QUOTA_KINDS = new Set([
  CREDIT_TOO_LOW,
  QUOTA_PER_DAY,
  "quota_exceeded",
  "billing_error",
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
]);
/** Error types and codes that mean the key itself was refused. */
const KEY_KINDS = new Set(["authentication_error", "invalid_api_key", "api_key_invalid", "permission_error"]);
/** Error types and codes that mean the model doesn't exist (or no longer does). */
const MODEL_KINDS = new Set(["model_not_found"]);
/** Error codes that mean a rate limit was reached. */
const RATE_KINDS = new Set(["rate_limit_exceeded"]);
/** HTTP statuses, and error codes, that mean the service is having trouble or is overloaded. */
const BUSY_STATUSES = new Set([500, 502, 503, 504, 529]);
const BUSY_KINDS = new Set(["server_error"]);

/** The largest error body Sage looks at for its type fields. */
const MAX_ERROR_BYTES = 64 * 1024;

/**
 * Reads only the known type fields of an error reply (error.type, error.code, error.status, the
 * top-level type, and error.details[].reason), lower-cased, and only if they look like identifiers.
 * Two more things are only checked, never kept: whether error.message contains one of the fixed
 * phrases above, and whether a QuotaFailure's quotaId names a per-day quota. Nothing else in the
 * body is kept, and none of it is ever shown or logged.
 */
export async function readErrorKinds(response: Response): Promise<Set<string>> {
  const kinds = new Set<string>();
  let body: unknown;
  try {
    const text = await readTextCapped(response, MAX_ERROR_BYTES);
    body = text === null ? undefined : JSON.parse(text);
  } catch {
    return kinds;
  }
  const add = (value: unknown) => {
    if (typeof value === "string" && /^[A-Za-z0-9_.]{1,64}$/.test(value)) kinds.add(value.toLowerCase());
  };
  // Some services wrap the error in a one-item list.
  const top = Array.isArray(body) ? body[0] : body;
  if (!top || typeof top !== "object") return kinds;
  const { type, error } = top as { type?: unknown; error?: unknown };
  add(type);
  if (error && typeof error === "object") {
    const { type: errorType, code, status, details, message } = error as Record<string, unknown>;
    add(errorType);
    add(code);
    add(status);
    if (typeof message === "string") {
      const lower = message.slice(0, 2000).toLowerCase();
      for (const [phrase, kind] of MESSAGE_PHRASES) if (lower.includes(phrase)) kinds.add(kind);
    }
    if (Array.isArray(details)) {
      for (const detail of details.slice(0, 10)) {
        if (!detail || typeof detail !== "object") continue;
        const { reason, violations } = detail as { reason?: unknown; violations?: unknown };
        add(reason);
        // google.rpc.QuotaFailure: a per-day quota is used up until the next day, not a minute.
        if (Array.isArray(violations)) {
          for (const violation of violations.slice(0, 10)) {
            const quotaId = (violation as { quotaId?: unknown } | null)?.quotaId;
            if (typeof quotaId === "string" && /perday/i.test(quotaId)) kinds.add(QUOTA_PER_DAY);
          }
        }
      }
    }
  }
  return kinds;
}

const has = (kinds: Set<string>, known: Set<string>) => [...kinds].some((kind) => known.has(kind));

/**
 * The message for an error reply, from its status and its known type fields only. `status` is null
 * for a reply that arrived as a success but says the service couldn't finish (a failed response).
 */
export function failureMessage(service: ServiceName, status: number | null, kinds: Set<string>): string {
  if (status === 402 || has(kinds, QUOTA_KINDS)) {
    return `${service.subject} says your credit or quota is used up. Check your plan and spending limits on its website, then try again.`;
  }
  if (status === 401 || status === 403 || has(kinds, KEY_KINDS)) {
    return `${service.subject} didn't accept the key: it may be wrong, or it was revoked. Check it in Settings, or create a new one.`;
  }
  if (status === 404 || has(kinds, MODEL_KINDS)) {
    return service.other
      ? `${service.subject} didn't recognise the address or the model name. Check Settings.`
      : `${service.subject} doesn't know that model, or it was retired. Choose another in Settings (Load models shows the current ones).`;
  }
  if (status === 429 || has(kinds, RATE_KINDS)) {
    return `${service.subject} is busy, or you've reached its rate limit. Wait a minute and try again.`;
  }
  if ((status !== null && BUSY_STATUSES.has(status)) || has(kinds, BUSY_KINDS)) {
    return `${service.subject} is busy or overloaded right now. Wait a minute and try again.`;
  }
  if (status === null) return `${service.subject} couldn't finish its reply. Try again later.`;
  return `${service.subject} returned an error (HTTP ${status}). Try again later.`;
}

export function timeoutMessage(service: ServiceName): string {
  return `${service.subject} took too long to answer. Try again.`;
}

export function unreadableMessage(service: ServiceName): string {
  return `${service.subject} sent a reply Sage couldn't read.`;
}

/** The message when a request couldn't be sent at all: a time-out, a refused connection, no network. */
export function networkMessage(service: ServiceName, error: unknown): string {
  if (isTimeout(error)) return timeoutMessage(service);
  if (service.other && isConnectionRefused(error)) {
    return `Sage can't reach ${service.ref}. Check the address.`;
  }
  return `Sage can't reach ${service.ref}. Check your internet connection.`;
}
