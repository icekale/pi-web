import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { readUiLocale, writeUiLocale } from "@/lib/ui-locale";


export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return Response.json({ error: "Untrusted API request" }, { status: 403 });
  }
  return Response.json({ locale: readUiLocale() });
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return Response.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await req.json() as { locale?: unknown };
    const locale = writeUiLocale(body.locale);
    if (!locale) return Response.json({ error: "locale must be en, zh-CN, or zh-TW" }, { status: 400 });
    return Response.json({ locale });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
