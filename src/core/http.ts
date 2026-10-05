// Polite fetching. The free endpoints rate-limit, so each source gets its own pacer: calls are spaced
// out, the spacing doubles whenever the server answers 429 (too many requests), and it eases back down
// while calls succeed.

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface Pacer {
  wait(): Promise<void>;
  /** When the next call may start (ms since epoch). */
  readyAt(): number;
  slowDown(): void;
  speedUp(): void;
}

export function pacer(minGapMs: number, maxGapMs = 30_000): Pacer {
  let gap = minGapMs;
  let next = 0;
  return {
    async wait() {
      const now = Date.now();
      const at = Math.max(now, next);
      next = at + gap;
      if (at > now) await sleep(at - now);
    },
    readyAt: () => next,
    slowDown() { gap = Math.min(maxGapMs, gap * 2); },
    speedUp() { gap = Math.max(minGapMs, gap * 0.95); },
  };
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, source: string) {
    super(`HTTP ${status} from ${source}`);
    this.status = status;
  }
}

const DEFAULT_RETRIES = 6;

interface GetOptions {
  init?: RequestInit;
  pace?: Pacer;
  label?: string; // what to call the source in errors; never the URL, which may carry a key
  retries?: number;
}

/** How long a 429 or 503 asks us to wait (Retry-After: seconds or an HTTP date), in ms; 0 if it doesn't say. */
function retryAfterMs(res: Response): number {
  const value = res.headers.get("retry-after");
  if (!value) return 0;
  const ms = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

export async function getJSON<T>(url: string, { init, pace, label = new URL(url).host, retries = DEFAULT_RETRIES }: GetOptions = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await pace?.wait();
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      if (res.ok) {
        // inside the try: a body cut off mid-transfer, or an HTML error page sent with 200, is retried too
        const body = (await res.json()) as T;
        pace?.speedUp();
        return body;
      }
    } catch (err) {
      if (attempt >= retries) throw new Error(`${label}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    await res.body?.cancel(); // never read: release the connection
    if (res.status === 429) pace?.slowDown();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) throw new HttpError(res.status, label);
    await sleep(Math.min(60_000, Math.max(retryAfterMs(res), Math.min(30_000, 1500 * 2 ** attempt))));
  }
}

/**
 * Runs `fn` over `items` with at most `limit` calls in flight. Results keep the input order.
 * Once a call fails no new ones start; the first error is thrown after the calls already in flight finish,
 * so nothing keeps running (or spending metered RPC credits) after this returns.
 */
export async function mapConcurrent<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  const errors: unknown[] = [];
  let next = 0;
  const worker = async () => {
    while (!errors.length && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i] as T, i);
      } catch (err) {
        errors.push(err);
      }
    }
  };
  // at least one worker: a limit of 0 (or a typo like 0.5) must not quietly return an empty result
  await Promise.all(Array.from({ length: Math.max(1, Math.floor(Math.min(limit, items.length))) }, worker));
  if (errors.length) throw errors[0];
  return results;
}
