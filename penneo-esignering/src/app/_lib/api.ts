/** Klientside-hjælper til prototypens API. Brugeren følger med som cookie. */
export const USER_COOKIE = 'cedra-user';
const DEFAULT_USER = 'u-sofie';

export function currentUserId(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${USER_COOKIE}=([^;]*)`));
  if (match?.[1]) return decodeURIComponent(match[1]);
  setCurrentUser(DEFAULT_USER);
  return DEFAULT_USER;
}

export function setCurrentUser(id: string): void {
  document.cookie = `${USER_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  reasons?: string[];
  recovery?: string;
}

export class ApiError extends Error {
  constructor(readonly body: ApiErrorBody) {
    super(body.message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  currentUserId();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers,
    cache: 'no-store',
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? { code: 'INTERNAL', message: `Fejl ${res.status}` });
  return json as T;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const [date, time] = iso.split('T');
  const [y, m, d] = (date ?? '').split('-');
  return `${d}.${m}.${y}${time ? ` ${time.slice(0, 5)}` : ''}`;
}

export function errorBody(e: unknown): ApiErrorBody {
  return e instanceof ApiError ? e.body : { code: 'INTERNAL', message: 'Uventet fejl. Prøv igen.' };
}
