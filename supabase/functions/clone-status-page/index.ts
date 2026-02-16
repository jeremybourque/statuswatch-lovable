import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ServiceStatus = "operational" | "degraded" | "partial" | "major" | "maintenance";

interface ExtractedService {
  name: string;
  status: ServiceStatus;
  group?: string | null;
  uptime_pct?: number | null;
  uptime_days?: (boolean | null)[] | null;
}

interface ExtractedResult {
  name: string;
  services: ExtractedService[];
  start_date: string | null;
}

// ── Atlassian Statuspage API approach ──

function mapStatuspageStatus(status: string): ServiceStatus {
  switch (status) {
    case "operational": return "operational";
    case "degraded_performance": return "degraded";
    case "partial_outage": return "partial";
    case "major_outage": return "major";
    case "under_maintenance": return "maintenance";
    default: return "operational";
  }
}

async function tryStatuspageAPI(baseUrl: string): Promise<ExtractedResult | null> {
  const origin = new URL(baseUrl).origin;

  // Try the Atlassian Statuspage v2 API
  try {
    const summaryRes = await fetch(`${origin}/api/v2/summary.json`, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
    });
    if (!summaryRes.ok) return null;
    const summary = await summaryRes.json();

    if (!summary?.components?.length) return null;

    const pageName = summary.page?.name || "Status Page";

    // Filter out the top-level "page" component and build group map
    const groupMap = new Map<string, string>();
    const components = summary.components.filter((c: any) => {
      if (c.group) return false; // this IS a group header
      if (c.group_id) {
        // find the group name
        const parent = summary.components.find((p: any) => p.id === c.group_id);
        if (parent) groupMap.set(c.id, parent.name);
      }
      return true;
    });

    // Also filter out the top-level aggregate component (if name matches page name)
    const services: ExtractedService[] = components
      .filter((c: any) => c.name !== pageName)
      .map((c: any) => ({
        name: c.name,
        status: mapStatuspageStatus(c.status),
        group: groupMap.get(c.id) || null,
        uptime_pct: null,
        uptime_days: null,
      }));

    console.log(`Statuspage API found ${services.length} components`);

    // Try to get uptime data from the undocumented uptime endpoint
    try {
      const uptimeRes = await fetch(`${origin}/uptime.json`, {
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      });
      if (uptimeRes.ok) {
        const uptimeData = await uptimeRes.json();
        // Some statuspage instances expose uptime percentages
        if (uptimeData?.components) {
          for (const svc of services) {
            const match = uptimeData.components.find((u: any) => u.name === svc.name);
            if (match?.uptime_percentage) {
              svc.uptime_pct = parseFloat(match.uptime_percentage);
            }
          }
        }
      }
    } catch { /* uptime endpoint is optional */ }

    return { name: pageName, services, start_date: null };
  } catch (e) {
    console.log("Statuspage API not available:", e.message);
    return null;
  }
}

// ── HTML fetching ──

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

/** Aggressive strip for service/group extraction */
function stripForServices(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+style="[^"]*"/g, "")
    .replace(/\s+class="[^"]*"/g, "")
    .replace(/\s+data-[a-z-]+="[^"]*"/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/>\s+</g, "><");
}

/** Lighter strip for uptime bar data */
function stripForUptime(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
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

  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch {
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

async function extractViaHTML(url: string, apiKey: string): Promise<ExtractedResult> {
  let rawHtml: string;
  try {
    const pageRes = await fetchWithRetries(url);
    rawHtml = await pageRes.text();
  } catch (fetchErr: any) {
    throw new Error(fetchErr.message);
  }

  console.log("Fetched HTML length:", rawHtml.length);

  const servicesHtml = stripForServices(rawHtml);
  console.log("Pass 1 (services) stripped HTML length:", servicesHtml.length);

  // If stripped HTML is very small, the page is likely JS-rendered
  if (servicesHtml.length < 200) {
    throw new Error("This status page appears to be JavaScript-rendered. The page content could not be extracted with a simple fetch. Try a different status page URL, or one that uses server-side rendering.");
  }

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

  // Extract chart date range
  const sinceMatch = rawHtml.match(/since-value="(\d{4}-\d{2}-\d{2})/);
  const startDate = sinceMatch ? sinceMatch[1] : null;
  console.log("Detected chart start date:", startDate);

  // Pass 2: uptime bars
  const uptimeHtml = stripForUptime(rawHtml);
  console.log("Pass 2 (uptime) stripped HTML length:", uptimeHtml.length);

  const serviceNames = (pass1.services || []).map((s: any) => s.name);

  const pass2 = await callAI(
    apiKey,
    `You extract uptime bar data from status page HTML. You are given a list of known service names.

The uptime bars are typically SVG charts with <rect> elements. Each visible rect has an inline style with a fill color:
- GREEN (#3CB878, #22c55e, #10b981, #4ade80, green shades) → true (operational day)
- RED (#EF4444, #dc2626, #f87171, #E74C3C, red shades) → false (incident/outage day)
- ORANGE/YELLOW (#F59E0B, #f97316, #eab308, orange/yellow shades) → false (degraded/partial day)
- GRAY (#9CA3AF, #6B7280, #d1d5db, gray shades) → null (no data)
- transparent rects are hover overlays — SKIP them entirely

CRITICAL RULES:
1. Only count rects with a visible fill color (NOT transparent, NOT fill-opacity="0"). Skip overlay/hover rects.
2. Carefully check each rect's fill color. Do NOT assume all bars are green.
3. Any fill that is NOT a shade of green MUST be mapped to false (red/orange/yellow) or null (gray).
4. Count the exact number of visible bar rects per service.
5. Order: oldest (leftmost, smallest x) to newest (rightmost, largest x).
6. Also extract "uptime_pct" if a percentage is shown near the service.

Return ONLY valid JSON:
{
  "services": [
    { "name": "Service Name", "uptime_pct": 99.99, "uptime_days": [true, true, false, true, null] }
  ]
}
Match service names EXACTLY as provided.`,
    `Known services: ${JSON.stringify(serviceNames)}\n\nExtract the fill color of each visible SVG rect bar for each service. Map green fills to true, red/orange/yellow to false, gray to null. Skip transparent overlay rects:`,
    uptimeHtml
  );

  for (const s of (pass2.services || [])) {
    const days = s.uptime_days;
    if (Array.isArray(days)) {
      const falseCount = days.filter((d: any) => d === false).length;
      const nullCount = days.filter((d: any) => d === null).length;
      console.log(`  ${s.name}: ${days.length} bars, ${falseCount} incidents, ${nullCount} no-data, uptime: ${s.uptime_pct}%`);
    }
  }
  console.log("Pass 2 found uptime data for", pass2.services?.length ?? 0, "services");

  // Merge passes
  const uptimeMap = new Map<string, { uptime_pct?: number | null; uptime_days?: (boolean | null)[] | null }>();
  for (const s of (pass2.services || [])) {
    uptimeMap.set(s.name, { uptime_pct: s.uptime_pct, uptime_days: s.uptime_days });
  }

  const mergedServices: ExtractedService[] = (pass1.services || []).map((s: any) => {
    const uptime = uptimeMap.get(s.name);
    const days: (boolean | null)[] = uptime?.uptime_days ?? [];
    // Preserve the actual number of bars from the source — no padding/trimming
    return {
      name: s.name,
      status: s.status,
      group: s.group,
      uptime_pct: uptime?.uptime_pct ?? null,
      uptime_days: days,
    };
  });

  return { name: pass1.name, services: mergedServices, start_date: startDate };
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

    // Strategy 1: Try Atlassian Statuspage API (works for JS-rendered pages too)
    let result: ExtractedResult | null = null;
    try {
      result = await tryStatuspageAPI(url);
      if (result) {
        console.log("Successfully extracted via Statuspage API");
      }
    } catch (e) {
      console.log("Statuspage API attempt failed:", e.message);
    }

    // Strategy 2: Fall back to HTML scraping with AI
    if (!result) {
      console.log("Falling back to HTML scraping...");
      result = await extractViaHTML(url, apiKey);
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
