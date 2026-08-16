/*
 * One place that knows how to reach the PlantAI backend.
 *
 * Before A3 the app held provider keys and talked to PlantNet, OpenAI and
 * Firecrawl directly. It no longer holds any provider key: it talks only to our
 * server, which holds them.
 *
 * `EXPO_PUBLIC_API_SECRET` is the one value still compiled into the bundle. It
 * is a speed bump against casual abuse, NOT authentication — anyone with the
 * app can extract it. What actually bounds the bill is the server's hard daily
 * cap (see server/gate.ts). Do not treat this value as a secret in any design
 * decision that follows.
 */
const RAW_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
export const API_BASE = RAW_BASE.replace(/\/+$/, '');

const API_SECRET = process.env.EXPO_PUBLIC_API_SECRET ?? '';

export const apiHeaders = (extra?: Record<string, string>): Record<string, string> => ({
  'x-plantai-key': API_SECRET,
  ...extra,
});

/*
 * Shape of every error body the server returns: a stable machine `error` code
 * plus neutral user-facing prose. Provider text never appears in either — that
 * is deliberate and enforced server-side in `fail()` (TODOS H3).
 */
export interface ApiError {
  error: string;
  message: string;
}

export async function readApiError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string') {
      return { error: body.error, message: typeof body.message === 'string' ? body.message : '' };
    }
  } catch {
    /* non-JSON body — fall through to the status-only shape */
  }
  return { error: `http_${res.status}`, message: '' };
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
