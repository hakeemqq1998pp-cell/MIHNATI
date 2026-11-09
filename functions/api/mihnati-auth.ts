const AUTH_FUNCTION_URL = "https://swjpiukalygwnufogfdl.supabase.co/functions/v1/mihnati-auth";

export async function onRequestPost({ request }: { request: Request }) {
  const apiKey = request.headers.get("apikey");
  const authorization = request.headers.get("authorization");
  if (!apiKey || !authorization) {
    return Response.json({ error: "بيانات الاتصال بخدمة المصادقة غير مكتملة." }, { status: 401 });
  }

  try {
    const upstream = await fetch(AUTH_FUNCTION_URL, {
      method: "POST",
      headers: {
        "apikey": apiKey,
        "Authorization": authorization,
        "Content-Type": "application/json",
      },
      body: await request.text(),
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "تعذر الاتصال بخدمة المصادقة. حاول مجدداً." }, { status: 502 });
  }
}
