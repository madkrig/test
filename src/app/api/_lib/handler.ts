import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type z, type ZodTypeAny } from 'zod';
import type { User } from '@/domain/bank-confirmations';
import { DomainError, loadActor, prisma } from '@/services';

export interface HandlerContext<B> {
  actor: User;
  body: B;
  params: Record<string, string>;
  query: URLSearchParams;
  idempotencyKey: string | undefined;
}

type Body<S> = S extends ZodTypeAny ? z.infer<S> : undefined;

/** Prototype-auth: bruger angives med header x-user-id (eller cookie cedra-user). */
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

/**
 * Tynd route-wrapper: auth → validering (Zod) → service → JSON.
 * Al forretningslogik ligger i services og domænelaget.
 */
export function handler<S extends ZodTypeAny | undefined = undefined>(
  schema: S,
  fn: (ctx: HandlerContext<Body<S>>) => Promise<unknown>,
) {
  return async (req: NextRequest, context: { params: Promise<Record<string, string>> }) => {
    try {
      const actor = await loadActor(prisma, userId(req));
      const params = (await context?.params) ?? {};
      let body: unknown = undefined;
      if (schema) {
        const raw = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
        body = schema.parse(raw);
      }
      const data = await fn({
        actor,
        body: body as Body<S>,
        params,
        query: req.nextUrl.searchParams,
        idempotencyKey: req.headers.get('idempotency-key') ?? undefined,
      });
      return NextResponse.json(data);
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}
