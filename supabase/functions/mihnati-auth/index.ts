import { createClient } from "npm:@supabase/supabase-js@2";

const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ENCRYPTION_SECRET = Deno.env.get("NATIONAL_ID_ENCRYPTION_KEY") ?? "";
const LOOKUP_PEPPER = Deno.env.get("NATIONAL_ID_LOOKUP_PEPPER") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_CHAT_ID = "6894752913";
const ALLOWED_ORIGINS = new Set(["https://mihnati1.netlify.app", "https://mihnati.pages.dev", "https://mihnati1.pages.dev", "http://localhost:5173", "http://127.0.0.1:5173"]);

const originAllowed = (origin: string | null) => !origin || ALLOWED_ORIGINS.has(origin);
const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://mihnati1.netlify.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const reply = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });

function normalizeNationalId(value: unknown): string {
  if (typeof value !== "string") throw new Error("INVALID_ID");
  const normalized = value.trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[\s-]/g, "");
  if (!/^\d{5,24}$/.test(normalized)) throw new Error("INVALID_ID");
  return normalized;
}

function encryptionKeyBytes(secret: string): Uint8Array {
  if (!secret) throw new Error("MISSING_SECRET");
  if (/^[0-9a-fA-F]{64}$/.test(secret)) return new Uint8Array(secret.match(/.{2}/g)!.map((x) => parseInt(x, 16)));
  try {
    const decoded = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
    if (decoded.length === 32) return decoded;
  } catch { /* try raw UTF-8 */ }
  const raw = new TextEncoder().encode(secret);
  if (raw.length !== 32) throw new Error("BAD_KEY_LENGTH");
  return raw;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

async function encryptNationalId(value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encryptionKeyBytes(ENCRYPTION_SECRET), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)));
  return "v1." + b64url(iv) + "." + b64url(encrypted);
}

async function consumeAttempt(admin: ReturnType<typeof createClient>, bucket: string): Promise<boolean> {
  const { data, error } = await admin.rpc("mihnati_consume_auth_attempt", { p_ip_hash: bucket, p_limit: 8, p_window_seconds: 900 });
  if (error) throw new Error("RATE_LIMIT_UNAVAILABLE");
  return data === true;
}

async function notifyNewMember(accountType: string, name: string, ciphertext: string): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  const label = accountType === "worker" ? "حساب عامل" : "حساب تجاري";
  const text = ["عضو جديد", "نوع الحساب: " + label, "الاسم الثلاثي: " + name, "الرقم الوطني (مشفر AES-GCM):", ciphertext].join("\n");
  try {
    const response = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
    const result = await response.json();
    return response.ok && result.ok === true;
  } catch { return false; }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (!originAllowed(origin)) return reply({ error: "Origin not allowed" }, 403, origin);
  if (!PROJECT_URL || !ANON_KEY || !SERVICE_KEY || !LOOKUP_PEPPER || !ENCRYPTION_SECRET) {
    return reply({ error: "إعدادات المصادقة على الخادم غير مكتملة." }, 503, origin);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: "بيانات الطلب غير صالحة." }, 400, origin); }
  const action = body.action;
  if (action !== "signup" && action !== "login") return reply({ error: "طلب غير صالح." }, 400, origin);

  let nationalId: string;
  try { nationalId = normalizeNationalId(body.national_id); } catch {
    return reply({ error: "تحقق من الرقم الوطني المدخل." }, 400, origin);
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8 || password.length > 72) return reply({ error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل." }, 400, origin);

  const admin = createClient(PROJECT_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const nationalHash = await hmacHex(LOOKUP_PEPPER, "national-id:" + nationalId);
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipHash = await hmacHex(LOOKUP_PEPPER, "ip:" + ip);
  try {
    const [ipAllowed, idAllowed] = await Promise.all([consumeAttempt(admin, ipHash), consumeAttempt(admin, nationalHash)]);
    if (!ipAllowed || !idAllowed) return reply({ error: "محاولات كثيرة. انتظر 15 دقيقة ثم حاول مجدداً." }, 429, origin);
  } catch { return reply({ error: "تعذر التحقق الآمن حالياً. حاول لاحقاً." }, 503, origin); }

  const email = "u_" + nationalHash + "@id.mihnati.invalid";
  if (action === "login") {
    const client = createClient(PROJECT_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) return reply({ error: "الرقم الوطني أو كلمة المرور غير صحيحة." }, 401, origin);
    return reply({ ok: true, session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } }, 200, origin);
  }

  const fullName = typeof body.full_name === "string" ? body.full_name.trim().replace(/\s+/g, " ") : "";
  if (fullName.length > 120 || fullName.split(" ").filter(Boolean).length < 3) return reply({ error: "أدخل الاسم الثلاثي كاملاً." }, 400, origin);
  const accountType = body.account_type;
  if (accountType !== "worker" && accountType !== "business") return reply({ error: "اختر نوع الحساب." }, 400, origin);
  const businessType = body.business_type;
  const businessName = typeof body.business_name === "string" ? body.business_name.trim() : "";
  if (accountType === "business" && (!["oven", "bakery", "restaurant"].includes(String(businessType)) || !businessName || businessName.length > 160)) {
    return reply({ error: "أدخل نوع النشاط واسم المنشأة للحساب التجاري." }, 400, origin);
  }

  let ciphertext: string;
  try { ciphertext = await encryptNationalId(nationalId); } catch {
    return reply({ error: "تعذر تجهيز تشفير الهوية. راجع مفاتيح الخادم." }, 503, origin);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName, account_type: accountType },
  });
  if (createError || !created.user) return reply({ error: "تعذر إنشاء الحساب. قد يكون الرقم الوطني مستخدماً من قبل." }, 409, origin);

  const { error: profileError } = await admin.from("mihnati_profiles").insert({
    id: created.user.id, account_type: accountType, full_name: fullName, phone: null, location_text: null,
    business_type: accountType === "business" ? businessType : null,
    business_name: accountType === "business" ? businessName : null,
    national_id_ciphertext: ciphertext, national_id_hash: nationalHash,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return reply({ error: "تعذر حفظ ملف الحساب. لم يتم إكمال التسجيل." }, 500, origin);
  }

  const telegramSent = await notifyNewMember(accountType, fullName, ciphertext);
  const client = createClient(PROJECT_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !signedIn.session) {
    return reply({ ok: true, telegram_sent: telegramSent, message: "تم إنشاء الحساب. سجّل الدخول بالرقم الوطني وكلمة المرور." }, 200, origin);
  }
  return reply({ ok: true, telegram_sent: telegramSent, session: { access_token: signedIn.session.access_token, refresh_token: signedIn.session.refresh_token } }, 200, origin);
});