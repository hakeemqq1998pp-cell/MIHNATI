import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = "6894752913"; // fixed private recipient only
  if (!url || !anonKey || !serviceKey) return reply({ error: "Server configuration missing" }, 500);
  if (!botToken) return reply({ error: "Telegram is not configured yet" }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt || jwt === authHeader) return reply({ error: "Unauthorized" }, 401);
  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(jwt);
  if (authError || !authData.user) return reply({ error: "Unauthorized" }, 401);

  let payload: { booking_id?: string };
  try { payload = await req.json(); } catch { return reply({ error: "Invalid JSON" }, 400); }
  const bookingId = payload.booking_id;
  if (!bookingId || !/^[0-9a-f-]{36}$/i.test(bookingId)) return reply({ error: "Invalid booking" }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: booking, error: bookingError } = await admin.from("mihnati_bookings")
    .select("id,job_id,worker_id,owner_id,status,arrived_at").eq("id", bookingId).maybeSingle();
  if (bookingError || !booking) return reply({ error: "Booking not found" }, 404);
  if (authData.user.id !== booking.worker_id) return reply({ error: "Only the booked worker can report arrival" }, 403);
  if (booking.status !== "agreed" || !booking.arrived_at) return reply({ error: "Arrival is not confirmed" }, 403);

  const [{ data: job, error: jobError }, { data: worker, error: workerError }, { data: owner, error: ownerError }] = await Promise.all([
    admin.from("mihnati_jobs").select("business_type,business_name,job_title,location_text").eq("id", booking.job_id).single(),
    admin.from("mihnati_profiles").select("full_name,phone").eq("id", booking.worker_id).single(),
    admin.from("mihnati_profiles").select("full_name,phone").eq("id", booking.owner_id).single(),
  ]);
  if (jobError || workerError || ownerError || !job || !worker || !owner) {
    return reply({ error: "Booking contact details unavailable" }, 500);
  }

  const { data: existing, error: eventReadError } = await admin.from("mihnati_notification_events")
    .select("id,status").eq("booking_id", bookingId).eq("event_type", "arrived").maybeSingle();
  if (eventReadError) return reply({ error: "Notification log unavailable" }, 500);
  if (existing?.status === "sent") return reply({ ok: true, already_sent: true });

  const { data: inserted, error: insertError } = await admin.from("mihnati_notification_events")
    .upsert({ booking_id: bookingId, event_type: "arrived", status: "pending", attempts: 1 },
      { onConflict: "booking_id,event_type", ignoreDuplicates: true })
    .select("id").maybeSingle();
  if (insertError) return reply({ error: "Could not record notification" }, 500);
  const eventId = inserted?.id ?? existing?.id;
  if (!eventId) return reply({ error: "Notification record unavailable" }, 500);

  const placeLabel = job.business_type === "bakery" ? "المخبز" : job.business_type === "oven" ? "الفرن" : "المطعم";
  const message = [
    `رقم هاتف العامل: ${worker.phone ?? "غير متوفر"}`,
    `اسم العامل: ${worker.full_name}`,
    `رقم هاتف صاحب العمل: ${owner.phone ?? "غير متوفر"}`,
    `اسم صاحب العمل: ${owner.full_name}`,
    `لقد وصل إلى ${placeLabel}: ${job.business_name}`,
  ].join("\n");
  try {
    const telegram = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
    });
    const result = await telegram.json();
    if (!telegram.ok || !result.ok) throw new Error("Telegram API rejected the message");
    await admin.from("mihnati_notification_events").update({
      status: "sent", attempts: 1, last_error: null, sent_at: new Date().toISOString()
    }).eq("id", eventId);
    return reply({ ok: true });
  } catch {
    await admin.from("mihnati_notification_events").update({
      status: "failed", attempts: 1, last_error: "Telegram delivery failed"
    }).eq("id", eventId);
    return reply({ error: "Telegram delivery failed" }, 502);
  }
});
