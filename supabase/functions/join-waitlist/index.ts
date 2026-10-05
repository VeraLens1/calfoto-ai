import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://veralens1.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

const RATE_LIMIT = 8;
const WINDOW_MS = 60 * 60 * 1000;

function json(body: unknown, status: number, origin: string | null): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "content-type";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("missing supabase env");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`calfoto-waitlist:v1:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first || "unknown";
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) return null;
  return name;
}

function cleanSource(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const source = value.toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(source)) return null;
  return source;
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }

  if (req.method === "GET") {
    try {
      const admin = adminClient();
      const { error } = await admin
        .from("waitlist_signups")
        .select("id", { head: true, count: "exact" });
      if (error) throw error;
      return json({ ok: true }, 200, origin);
    } catch {
      return json({ ok: false }, 500, origin);
    }
  }

  if (req.method !== "POST") {
    return json({ error: "method" }, 405, origin);
  }

  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: "origin" }, 403, origin);
  }

  let payload: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 4000) return json({ error: "invalid" }, 400, origin);
    payload = JSON.parse(text);
  } catch {
    return json({ error: "invalid" }, 400, origin);
  }

  if (typeof payload.website === "string" && payload.website.trim() !== "") {
    return json({ status: "accepted" }, 200, origin);
  }

  if (payload.consent !== true) {
    return json({ error: "consent_required" }, 400, origin);
  }

  const locale = payload.locale === "ro" || payload.locale === "en" ? payload.locale : null;
  if (!locale) return json({ error: "invalid_locale" }, 400, origin);

  const email = cleanEmail(payload.email);
  if (!email) return json({ error: "invalid_email" }, 400, origin);

  const firstName = cleanName(payload.first_name);
  if (payload.first_name != null && String(payload.first_name).trim() !== "" && !firstName) {
    return json({ error: "invalid_name" }, 400, origin);
  }

  const source = cleanSource(payload.source);

  try {
    const admin = adminClient();
    const ipHash = await hashIp(clientIp(req));
    const now = new Date();
    const { data: limitRow, error: limitError } = await admin
      .from("waitlist_rate_limits")
      .select("hits, window_start")
      .eq("ip_hash", ipHash)
      .maybeSingle();
    if (limitError) throw limitError;

    if (!limitRow || now.getTime() - new Date(limitRow.window_start).getTime() >= WINDOW_MS) {
      const { error } = await admin.from("waitlist_rate_limits").upsert({
        ip_hash: ipHash,
        window_start: now.toISOString(),
        hits: 1,
      });
      if (error) throw error;
    } else if (limitRow.hits >= RATE_LIMIT) {
      return json({ error: "rate_limited" }, 429, origin);
    } else {
      const { error } = await admin
        .from("waitlist_rate_limits")
        .update({ hits: limitRow.hits + 1 })
        .eq("ip_hash", ipHash);
      if (error) throw error;
    }

    const { data: joined, error: joinError } = await admin.rpc("join_waitlist", {
      p_email: email,
      p_first_name: firstName,
      p_locale: locale,
      p_source: source,
    });
    if (joinError || !joined) throw joinError ?? new Error("empty join result");

    return json(joined, 200, origin);
  } catch {
    return json({ error: "server" }, 500, origin);
  }
});
