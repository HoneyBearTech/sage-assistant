import { type FetchLike, isTimeout, readJsonCapped, requestSignal, STOPPED_MESSAGE } from "./brain.js";
import {
  failureMessage,
  networkMessage,
  readErrorKinds,
  type ServiceName,
  timeoutMessage,
} from "./errors.js";

/**
 * A service's reply: its parsed JSON body (undefined when too large or not JSON), or a plain message.
 * A refusal also carries its HTTP status and known error kinds, for a brain that can recover from
 * one; they are only compared, never shown.
 */
export type ServiceReply =
  | { ok: true; body: unknown }
  | { ok: false; message: string; status?: number; kinds?: Set<string> };

/**
 * Sends one request to an online service and reads its JSON reply, within `timeoutMs` for the whole
 * exchange. Redirects are refused, so a key can never be forwarded to another host. Any failure
 * becomes a plain message; the service's own error text is never read beyond its known type fields.
 */
export async function requestService(
  fetchFn: FetchLike,
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; signal?: AbortSignal },
  service: ServiceName,
  timeoutMs: number,
  /** Makes the time limit's signal; tests pass one they fire themselves. */
  timeoutSignal: (ms: number) => AbortSignal = (ms) => AbortSignal.timeout(ms),
): Promise<ServiceReply> {
  const { signal: turn, ...request } = init;
  // A stopped turn sends nothing more.
  if (turn?.aborted) return { ok: false, message: STOPPED_MESSAGE };
  let response: Response;
  try {
    response = await fetchFn(url, {
      ...request,
      redirect: "error",
      signal: requestSignal(timeoutSignal(timeoutMs), turn),
    });
  } catch (error) {
    if (turn?.aborted) return { ok: false, message: STOPPED_MESSAGE };
    return { ok: false, message: networkMessage(service, error) };
  }
  if (!response.ok) {
    const kinds = await readErrorKinds(response);
    return {
      ok: false,
      message: failureMessage(service, response.status, kinds),
      status: response.status,
      kinds,
    };
  }
  try {
    return { ok: true, body: await readJsonCapped(response) };
  } catch (error) {
    if (turn?.aborted) return { ok: false, message: STOPPED_MESSAGE };
    // The reply started but its body stalled past the time limit, or the connection dropped.
    if (isTimeout(error)) return { ok: false, message: timeoutMessage(service) };
    return { ok: true, body: undefined };
  }
}
