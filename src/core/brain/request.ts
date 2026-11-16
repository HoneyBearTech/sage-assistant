import { type FetchLike, isTimeout, readJsonCapped } from "./brain.js";
import {
  failureMessage,
  networkMessage,
  readErrorKinds,
  type ServiceName,
  timeoutMessage,
} from "./errors.js";

/** A service's reply: its parsed JSON body (undefined when too large or not JSON), or a plain message. */
export type ServiceReply = { ok: true; body: unknown } | { ok: false; message: string };

/**
 * Sends one request to an online service and reads its JSON reply, within `timeoutMs` for the whole
 * exchange. Redirects are refused, so a key can never be forwarded to another host. Any failure
 * becomes a plain message; the service's own error text is never read beyond its known type fields.
 */
export async function requestService(
  fetchFn: FetchLike,
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
  service: ServiceName,
  timeoutMs: number,
): Promise<ServiceReply> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, message: networkMessage(service, error) };
  }
  if (!response.ok) {
    return { ok: false, message: failureMessage(service, response.status, await readErrorKinds(response)) };
  }
  try {
    return { ok: true, body: await readJsonCapped(response) };
  } catch (error) {
    // The reply started but its body stalled past the time limit, or the connection dropped.
    if (isTimeout(error)) return { ok: false, message: timeoutMessage(service) };
    return { ok: true, body: undefined };
  }
}
