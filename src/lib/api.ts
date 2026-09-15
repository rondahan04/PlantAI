/*
 * One place that knows how to reach the PlantAI backend.
 *
 * Before A3 the app held provider keys and talked to PlantNet, OpenAI and
 * Firecrawl directly. It no longer holds any provider key: it talks only to our
 * server, which holds them.
 *
 * `EXPO_PUBLIC_API_SECRET` is the one value still compiled into the bundle. It
 * is a speed bump against casual abuse, NOT authentication - anyone with the
 * app can extract it. What actually bounds the bill is the server's hard daily
 * cap (see server/gate.ts). Do not treat this value as a secret in any design
 * decision that follows.
 */
const RAW_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const API_BASE = RAW_BASE.replace(/\/+$/, '');

const API_SECRET = process.env.EXPO_PUBLIC_API_SECRET ?? '';

export const apiHeaders = (extra?: Record<string, string>): Record<string, string> => ({
  'x-plantai-key': API_SECRET,
  ...extra,
});

/*
 * Shape of every error body the server returns: a stable machine `error` code
 * plus neutral user-facing prose. Provider text never appears in either - that
 * is deliberate and enforced server-side in `fail()` (TODOS H3).
 */
export interface ApiError {
  error: string;
  message: string;
}

export async function readApiError(res: Response): Promise<ApiError> {
  try {
    /* Annotated rather than inferred: this module is now also compiled under
     * the node config for `node --test`, where `Response.json()` resolves to
     * `{}` instead of `any`. */
    const body = (await res.json()) as { error?: unknown; message?: unknown } | null;
    if (typeof body?.error === 'string') {
      return { error: body.error, message: typeof body.message === 'string' ? body.message : '' };
    }
  } catch {
    /* non-JSON body - fall through to the status-only shape */
  }
  return { error: `http_${res.status}`, message: '' };
}

/*
 * An HTTP answer that was not ok, carrying the status the caller needs to
 * decide whether it is worth trying again.
 *
 * A plain field rather than a parameter property, matching TranslateError and
 * CarePlanError: node's type-stripping test runner cannot parse those.
 */
export class ApiHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(`${status} ${code}${message ? `: ${message}` : ''}`);
    this.name = 'ApiHttpError';
    this.status = status;
    this.code = code;
  }
}

/*
 * Will this failure repeat no matter how many times we ask?
 *
 * The question a caller asks before writing a plant off. Only a 4xx that is
 * about the REQUEST qualifies - a malformed body, a bad key, a payload over
 * the cap - because none of those change by waiting.
 *
 * Everything else is about the moment: 429 is this minute's budget, 408 is a
 * slow answer, a 5xx is the server's problem, and no status at all is an
 * aborted or dropped fetch. Those must never be remembered as verdicts. The
 * app's API sleeps when idle and takes half a minute to wake; treating that
 * cold start as permanent is how the same plants failed to translate on every
 * single launch.
 */
export function isPermanentStatus(status: number | undefined): boolean {
  if (!status) return false;
  if (status === 429 || status === 408) return false;
  return status >= 400 && status < 500;
}

/*
 * Wake the server before spending anything on it.
 *
 * The API is hosted somewhere that spins down when idle - a measured cold
 * start is over thirty seconds. Without this the FIRST billable call of a
 * session pays for that wait out of its own timeout budget and frequently
 * loses, which looks to the user like a feature that does not work rather than
 * a server that was asleep.
 *
 * `/health` is neither gated nor billed, so this costs nothing but the wait,
 * and every call queued behind it meets a server already up.
 *
 * One shared promise: a whole batch warms once. A FAILED warm-up is forgotten
 * rather than cached, so a later attempt tries again instead of assuming the
 * server is still down - and it never rejects, because nothing here is worth
 * failing a caller over. If the server really is unreachable, the real call
 * behind it will say so with a real error.
 */
let warming: Promise<void> | null = null;
const WARM_TIMEOUT_MS = 60_000;

export function warmUp(): Promise<void> {
  if (warming) return warming;
  warming = apiFetch('/health', { method: 'GET', timeoutMs: WARM_TIMEOUT_MS })
    .then(() => undefined)
    .catch(() => {
      warming = null;
    });
  return warming;
}

/* fetch with a hard timeout. Every call in the app goes through this. */
export async function apiFetch(
  path: string,
  init: RequestInit & { timeoutMs: number }
): Promise<Response> {
  const { timeoutMs, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${API_BASE}${path}`, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
