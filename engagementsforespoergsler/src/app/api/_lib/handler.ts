import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodTypeAny } from 'zod';
import { DomainError, loadActor, prisma, transaction, type Actor, type Db } from '@/services';

export interface RouteContext {
  actor: Actor;
  db: Db;
  params: Record<string, string>;
  query: URLSearchParams;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- valideret af routens Zod-skema
  body: any;
  idempotencyKey: string | undefined;
}

export interface RawResponse {
  raw: string;
  contentType: string;
  fileName?: string;
}

export interface RouteDef {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  schema?: ZodTypeAny;
  /** Mutationer kører i én transaktion, så objekt og hændelseslog følges ad. Lange demo-kørsler slår det fra. */
  transactional?: boolean;
  run: (ctx: RouteContext) => Promise<unknown>;
}

/** Prototype-auth: bruger angives med header x-user-id (eller cookie cedra-user). I drift: Entra ID. */
function userId(req: NextRequest): string | null {
  return req.headers.get('x-user-id') ?? req.cookies.get('cedra-user')?.value ?? null;
}

export function toErrorResponse(e: unknown) {
  if (e instanceof DomainError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, ...e.details } }, { status: e.httpStatus });
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'Ugyldige data.', reasons: e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`) } },
      { status: 400 },
    );
  }
  console.error(e);
  return NextResponse.json({ error: { code: 'INTERNAL', message: 'Uventet fejl.' } }, { status: 500 });
}

function match(route: RouteDef, method: string, segments: string[]): Record<string, string> | null {
  if (route.method !== method) return null;
  const parts = route.path.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segments[i]!);
    else if (p !== segments[i]) return null;
  }
  return params;
}

/**
 * Tynd router: auth → validering (Zod) → service → JSON. Al forretningslogik
 * ligger i services og domænelaget; ruterne er kontrakten (GET /api viser den).
 */
export function createRouter(routes: RouteDef[]) {
  return async (req: NextRequest, context: { params: Promise<{ path?: string[] }> }) => {
    try {
      const segments = (await context.params).path ?? [];
      const found = routes.map((r) => ({ r, params: match(r, req.method, segments) })).find((x) => x.params);
      if (!found) {
        const known = routes.some((r) => match({ ...r, method: req.method as RouteDef['method'] }, req.method, segments));
        throw new DomainError(known ? 'VALIDATION' : 'NOT_FOUND', known ? `Metoden ${req.method} understøttes ikke her.` : 'Ukendt API-sti.', { recovery: 'Se GET /api for kontrakten.' });
      }
      const actor = await loadActor(prisma, userId(req));
      const raw = req.method === 'GET' || req.method === 'DELETE' ? {} : await req.json().catch(() => ({}));
      const body = found.r.schema ? found.r.schema.parse(raw) : raw;
      const base = { actor, params: found.params!, query: req.nextUrl.searchParams, body, idempotencyKey: req.headers.get('idempotency-key') ?? undefined };
      const transactional = found.r.transactional ?? req.method !== 'GET';
      const data = transactional ? await transaction((tx) => found.r.run({ ...base, db: tx })) : await found.r.run({ ...base, db: prisma });
      if (data && typeof data === 'object' && 'raw' in data && 'contentType' in data) {
        const file = data as RawResponse;
        return new NextResponse(file.raw, {
          headers: { 'content-type': file.contentType, ...(file.fileName ? { 'content-disposition': `attachment; filename="${file.fileName}"` } : {}) },
        });
      }
      return NextResponse.json(data ?? { ok: true });
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}
