import { NextResponse, type NextRequest } from 'next/server';
import { toErrorResponse } from '@/app/api/_lib/handler';
import { penneoWebhookSchema } from '@/app/api/_lib/schemas';
import { signing } from '@/services';

/**
 * POST /api/webhooks/penneo – Modtager Penneos webhooks (kaldes af Penneo, ikke af en bruger).
 * Prototypen beskytter endpointet med et delt token i URL'en, hvis PENNEO_WEBHOOK_TOKEN er sat.
 * Produktion skal i stedet verificere headeren x-event-signature efter Penneos dokumentation.
 */
export async function POST(req: NextRequest) {
  try {
    const token = process.env.PENNEO_WEBHOOK_TOKEN;
    if (token && req.nextUrl.searchParams.get('token') !== token) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Ugyldigt webhook-token.' } }, { status: 401 });
    }
    const event = penneoWebhookSchema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(await signing.handlePenneoWebhook(event, req.headers.get('x-event-id') ?? undefined));
  } catch (e) {
    return toErrorResponse(e);
  }
}
