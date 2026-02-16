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

type ProgressFn = (msg: string) => void;

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

async function tryStatuspageAPI(baseUrl: string, progress: ProgressFn): Promise<ExtractedResult | null> {
  const origin = new URL(baseUrl).origin;

  try {
    progress("Checking for Atlassian Statuspage API...");
    const summaryRes = await fetch(`${origin}/api/v2/summary.json`, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
    });
    if (!summaryRes.ok) return null;
    const summary = await summaryRes.json();

    if (!summary?.components?.length) return null;

    const pageName = summary.page?.name || "Status Page";

    progress("Parsing component list and group structure...");

    const groupInfoMap = new Map<string, { name: string; position: number }>();
    const childComponents: any[] = [];

    for (const c of summary.components) {
      if (c.group) {
        groupInfoMap.set(c.id, { name: c.name, position: c.position ?? 0 });
      } else if (c.name !== pageName) {
        childComponents.push(c);
      }
    }

    childComponents.sort((a: any, b: any) => {
      const aGroupPos = a.group_id ? (groupInfoMap.get(a.group_id)?.position ?? 0) : (a.position ?? 0);
      const bGroupPos = b.group_id ? (groupInfoMap.get(b.group_id)?.position ?? 0) : (b.position ?? 0);
      if (aGroupPos !== bGroupPos) return aGroupPos - bGroupPos;
      return (a.position ?? 0) - (b.position ?? 0);
    });

    const services: ExtractedService[] = childComponents.map((c: any) => ({
      name: c.name,
      status: mapStatuspageStatus(c.status),
      group: c.group_id ? (groupInfoMap.get(c.group_id)?.name || null) : null,
      uptime_pct: null,
      uptime_days: null,
    }));

    progress(`Found ${services.length} components via API`);

    // Scrape the HTML page to extract uptime bar data from SVGs
    let startDate: string | null = null;
    try {
      const apiKey = Deno.env.get("LOVABLE_API_KEY");
      if (apiKey) {
        progress("Using Firecrawl to render page for uptime bar extraction...");
        let rawHtml = await fetchRenderedHTMLForUptime(origin, progress);
        console.log("Fetched HTML for uptime bars, length:", rawHtml.length);

        const sinceMatch = rawHtml.match(/since-value="(\d{4}-\d{2}-\d{2})/);
        startDate = sinceMatch ? sinceMatch[1] : null;
        progress(startDate ? `Chart date anchor: ${startDate}` : "No chart date anchor found, will use relative dates");

        progress("Stripping non-essential markup, keeping SVG data...");
        const uptimeHtml = rawHtml
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
          .replace(/<head[\s\S]*?<\/head>/gi, "")
          .replace(/<footer[\s\S]*?<\/footer>/gi, "")
          .replace(/<nav[\s\S]*?<\/nav>/gi, "")
          .replace(/<!--[\s\S]*?-->/g, "")
          .replace(/\s{2,}/g, " ")
          .replace(/>\s+</g, "><");

        console.log("Stripped HTML for uptime bars, length:", uptimeHtml.length);

        const serviceNames = services.map(s => s.name);
        const uptimeMap = await extractUptimeSingle(apiKey, serviceNames, uptimeHtml, progress);

        let matchedCount = 0;
        for (const svc of services) {
          const uptime = uptimeMap.get(svc.name);
          if (uptime) {
            svc.uptime_pct = uptime.uptime_pct ?? null;
            svc.uptime_days = uptime.uptime_days ?? null;
            if (Array.isArray(svc.uptime_days) && svc.uptime_days.length > 0) matchedCount++;
          }
        }

        progress(`Parsed uptime bars for ${matchedCount}/${services.length} services`);
      }
    } catch (e: any) {
      progress(`Could not scrape uptime bars: ${e.message}`);
      console.log("Could not scrape uptime bars:", e.message);
    }

    return { name: pageName, services, start_date: startDate };
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

const UPTIME_SYSTEM_PROMPT = `You extract uptime bar data from status page HTML. You are given a list of known service names.

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
Match service names EXACTLY as provided.`;

async function extractUptimeSingle(
  apiKey: string,
  serviceNames: string[],
  uptimeHtml: string,
  progress: ProgressFn,
): Promise<Map<string, { uptime_pct?: number | null; uptime_days?: (boolean | null)[] | null }>> {
  progress(`Sending SVG data to AI for color analysis (${serviceNames.length} services)...`);

  const result = await callAI(
    apiKey,
    UPTIME_SYSTEM_PROMPT,
    `Known services: ${JSON.stringify(serviceNames)}\n\nExtract the fill color of each visible SVG rect bar for each service. Map green fills to true, red/orange/yellow to false, gray to null. Skip transparent overlay rects:`,
    uptimeHtml
  );

  progress("Mapping rect fill colors → operational / incident / no-data...");

  const uptimeMap = new Map<string, { uptime_pct?: number | null; uptime_days?: (boolean | null)[] | null }>();
  for (const s of (result.services || [])) {
    uptimeMap.set(s.name, { uptime_pct: s.uptime_pct, uptime_days: s.uptime_days });
    if (Array.isArray(s.uptime_days)) {
      const falseCount = s.uptime_days.filter((d: any) => d === false).length;
      const nullCount = s.uptime_days.filter((d: any) => d === null).length;
      console.log(`  ${s.name}: ${s.uptime_days.length} bars, ${falseCount} incidents, ${nullCount} no-data, uptime: ${s.uptime_pct}%`);
    }
  }

  return uptimeMap;
}

async function callAI(apiKey: string, systemPrompt: string, userPrompt: string, htmlContent: string): Promise<any> {
  const truncated = htmlContent.slice(0, 800000);

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      max_tokens: 65536,
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
  const finishReason = aiData.choices?.[0]?.finish_reason;
  if (finishReason === "length" || finishReason === "MAX_TOKENS") {
    console.warn("AI response was TRUNCATED (finish_reason:", finishReason, ")");
  }
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

async function fetchRenderedHTML(url: string): Promise<string> {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) {
    throw new Error("Firecrawl is not configured. Connect Firecrawl in project settings to scrape JS-rendered pages.");
  }

  console.log("Using Firecrawl to render JS page:", url);
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${firecrawlKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["html"],
      waitFor: 5000,
    }),
  });

  if (!res.ok) {
    const errData = await res.text();
    console.error("Firecrawl error:", errData);
    throw new Error(`Firecrawl failed (${res.status})`);
  }

  const data = await res.json();
  const html = data?.data?.html || data?.html || "";
  console.log("Firecrawl returned HTML length:", html.length);
  return html;
}

async function fetchRenderedHTMLForUptime(url: string, progress: ProgressFn): Promise<string> {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) {
    progress("Firecrawl not configured, falling back to plain fetch...");
    const pageRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html" },
    });
    return await pageRes.text();
  }

  console.log("Using Firecrawl for uptime HTML:", url);
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${firecrawlKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["rawHtml"],
      waitFor: 5000,
    }),
  });

  if (!res.ok) {
    const errData = await res.text();
    console.error("Firecrawl uptime error:", errData);
    progress("Firecrawl failed, falling back to plain fetch...");
    const pageRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html" },
    });
    return await pageRes.text();
  }

  const data = await res.json();
  const html = data?.data?.rawHtml || data?.rawHtml || data?.data?.html || data?.html || "";
  console.log("Firecrawl uptime HTML length:", html.length);
  return html;
}

async function extractViaHTML(url: string, apiKey: string, progress: ProgressFn): Promise<ExtractedResult> {
  progress("Fetching page HTML...");
  let rawHtml: string;
  try {
    const pageRes = await fetchWithRetries(url);
    rawHtml = await pageRes.text();
  } catch (fetchErr: any) {
    throw new Error(fetchErr.message);
  }

  console.log("Fetched HTML length:", rawHtml.length);

  progress("Stripping non-essential markup for service extraction...");
  let servicesHtml = stripForServices(rawHtml);
  console.log("Pass 1 (services) stripped HTML length:", servicesHtml.length);

  if (servicesHtml.length < 200) {
    progress("Page appears JS-rendered, using Firecrawl...");
    rawHtml = await fetchRenderedHTML(url);
    servicesHtml = stripForServices(rawHtml);
    console.log("Firecrawl stripped HTML length:", servicesHtml.length);
    if (servicesHtml.length < 200) {
      throw new Error("Could not extract content from this status page, even with JavaScript rendering.");
    }
  }

  progress("Sending HTML to AI for service extraction...");
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

  progress(`AI found ${pass1.services?.length ?? 0} services`);

  const sinceMatch = rawHtml.match(/since-value="(\d{4}-\d{2}-\d{2})/);
  const startDate = sinceMatch ? sinceMatch[1] : null;
  progress(startDate ? `Chart date anchor: ${startDate}` : "No chart date anchor found");

  progress("Using Firecrawl for uptime bar HTML...");
  const uptimeRawHtml = await fetchRenderedHTMLForUptime(url, progress);
  const uptimeHtml = stripForUptime(uptimeRawHtml);
  console.log("Pass 2 (uptime) stripped HTML length:", uptimeHtml.length);

  // Try to find date anchor in the rendered HTML
  const sinceMatch2 = uptimeRawHtml.match(/since-value="(\d{4}-\d{2}-\d{2})/);
  const startDate2 = sinceMatch2 ? sinceMatch2[1] : startDate;

  const serviceNames = (pass1.services || []).map((s: any) => s.name);

  const uptimeMap = await extractUptimeSingle(apiKey, serviceNames, uptimeHtml, progress);

  const mergedServices: ExtractedService[] = (pass1.services || []).map((s: any) => {
    const uptime = uptimeMap.get(s.name);
    return {
      name: s.name,
      status: s.status,
      group: s.group,
      uptime_pct: uptime?.uptime_pct ?? null,
      uptime_days: uptime?.uptime_days ?? [],
    };
  });

  let matchedCount = 0;
  for (const s of mergedServices) {
    if (s.uptime_days && s.uptime_days.length > 0) matchedCount++;
  }
  progress(`Parsed uptime bars for ${matchedCount}/${mergedServices.length} services`);

  return { name: pass1.name, services: mergedServices, start_date: startDate2 };
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

    // SSE streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (type: string, data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
        };

        const progress: ProgressFn = (msg: string) => {
          console.log(msg);
          sendEvent("progress", { message: msg });
        };

        try {
          progress(`Connecting to ${new URL(url).hostname}...`);

          let result: ExtractedResult | null = null;
          try {
            result = await tryStatuspageAPI(url, progress);
          } catch (e) {
            progress(`Statuspage API attempt failed: ${e.message}`);
          }

          if (!result) {
            progress("Falling back to HTML scraping with AI...");
            result = await extractViaHTML(url, apiKey, progress);
          }

          progress(`Analysis complete — found ${result.services?.length ?? 0} services`);
          sendEvent("result", { success: true, data: result });
        } catch (error: any) {
          console.error("Error:", error);
          sendEvent("error", { message: error.message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
