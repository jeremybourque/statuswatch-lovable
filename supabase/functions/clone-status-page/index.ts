import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchWithRetries(url: string): Promise<Response> {
  const attempts = [
    {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "Cache-Control": "max-age=0",
    },
    {
      "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Accept": "text/html",
    },
    {
      "User-Agent": "facebookexternalhit/1.1",
      "Accept": "text/html",
    },
  ];

  for (const headers of attempts) {
    try {
      const res = await fetch(url, { headers, redirect: "follow" });
      if (res.ok) return res;
      console.warn(`Attempt failed with status ${res.status}, trying next...`);
      await res.text();
    } catch (e) {
      console.warn(`Fetch attempt failed:`, e.message);
    }
  }

  throw new Error("All fetch attempts were blocked by the target site. Try a different URL.");
}

/** Aggressive strip for service/group extraction — remove everything non-content */
function stripForServices(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "") // Remove SVGs to save tokens
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+style="[^"]*"/g, "")
    .replace(/\s+class="[^"]*"/g, "") // Remove classes too — not needed for names
    .replace(/\s+data-[a-z-]+="[^"]*"/gi, "") // Remove data attributes
    .replace(/\s{2,}/g, " ")
    .replace(/>\s+</g, "><");
}

/** Lighter strip for uptime bar data — keep SVGs and data attributes */
function stripForUptime(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+style="[^"]*"/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/>\s+</g, "><");
}

async function callAI(apiKey: string, systemPrompt: string, userPrompt: string, htmlContent: string): Promise<any> {
  const truncated = htmlContent.slice(0, 500000);

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${userPrompt}\n\n${truncated}` },
      ],
      temperature: 0,
    }),
  });

  if (!aiRes.ok) {
    const errText = await aiRes.text();
    console.error("AI error:", errText);
    throw new Error("AI extraction failed");
  }

  const aiData = await aiRes.json();
  const content = aiData.choices?.[0]?.message?.content ?? "";

  // Extract JSON from response
  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch {
    // Attempt to repair truncated JSON
    let repaired = jsonStr;
    let braces = 0, brackets = 0;
    for (const char of repaired) {
      if (char === '{') braces++;
      if (char === '}') braces--;
      if (char === '[') brackets++;
      if (char === ']') brackets--;
    }
    while (brackets > 0) { repaired += ']'; brackets--; }
    while (braces > 0) { repaired += '}'; braces--; }
    try {
      const result = JSON.parse(repaired);
      console.warn("Repaired truncated JSON response");
      return result;
    } catch {
      console.error("Failed to parse AI response:", content);
      throw new Error("Could not parse AI response");
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "AI not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Fetching URL:", url);

    let rawHtml: string;
    try {
      const pageRes = await fetchWithRetries(url);
      rawHtml = await pageRes.text();
    } catch (fetchErr) {
      return new Response(
        JSON.stringify({ success: false, error: fetchErr.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Fetched HTML length:", rawHtml.length);

    // ── PASS 1: Extract services and groups ──
    const servicesHtml = stripForServices(rawHtml);
    console.log("Pass 1 (services) stripped HTML length:", servicesHtml.length);

    const pass1 = await callAI(
      apiKey,
      `You extract status page data from HTML. Return ONLY valid JSON with this structure:
{
  "name": "Page name/title",
  "services": [
    { "name": "Service Name", "status": "operational|degraded|partial|major|maintenance", "group": "Group Name or null" }
  ]
}
IMPORTANT: Extract ALL services listed on the page. Look for every component/service entry.
If services are organized into groups/categories, include the group name. If no group, set "group" to null.
CRITICAL: Group/category headers are NOT services. Do NOT include group names as separate service entries.
Map statuses: green/up/operational -> "operational", yellow/degraded/slow -> "degraded", orange/partial -> "partial", red/down/major -> "major", blue/maintenance/scheduled -> "maintenance". If unsure, use "operational".
For the "name" field, remove trailing suffixes like "| Status", "Status", "- Status Page". Return just the clean company/product name.`,
      "Extract the status page name and ALL services with their current statuses from this HTML:",
      servicesHtml
    );

    console.log("Pass 1 found", pass1.services?.length ?? 0, "services");

    // ── PASS 2: Extract uptime bar data ──
    const uptimeHtml = stripForUptime(rawHtml);
    console.log("Pass 2 (uptime) stripped HTML length:", uptimeHtml.length);

    // Build service name list for the AI to match against
    const serviceNames = (pass1.services || []).map((s: any) => s.name);

    const pass2 = await callAI(
      apiKey,
      `You extract uptime data from status page HTML. You are given a list of known service names. For each service, extract:
- "uptime_pct": the uptime percentage shown (a number like 99.99), or null if not visible
- "uptime_days": an array of daily up/down data from the uptime bar/chart. Each element: true (up/green), false (down/red/orange), or null (no data/gray). Ordered oldest to newest (left to right). If no daily bar is visible for that service, set to null.

Return ONLY valid JSON:
{
  "services": [
    { "name": "Service Name", "uptime_pct": 99.99, "uptime_days": [true, true, null, false] }
  ]
}
Match service names EXACTLY as provided. Only include services from the provided list.`,
      `Known services: ${JSON.stringify(serviceNames)}\n\nExtract uptime percentage and daily uptime bar data for each service from this HTML:`,
      uptimeHtml
    );

    console.log("Pass 2 found uptime data for", pass2.services?.length ?? 0, "services");

    // ── Merge passes ──
    const uptimeMap = new Map<string, { uptime_pct?: number | null; uptime_days?: (boolean | null)[] | null }>();
    for (const s of (pass2.services || [])) {
      uptimeMap.set(s.name, { uptime_pct: s.uptime_pct, uptime_days: s.uptime_days });
    }

    const mergedServices = (pass1.services || []).map((s: any) => {
      const uptime = uptimeMap.get(s.name);
      return {
        name: s.name,
        status: s.status,
        group: s.group,
        uptime_pct: uptime?.uptime_pct ?? null,
        uptime_days: uptime?.uptime_days ?? null,
      };
    });

    const result = {
      name: pass1.name,
      services: mergedServices,
    };

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
