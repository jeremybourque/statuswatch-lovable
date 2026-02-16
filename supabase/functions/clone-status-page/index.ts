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

// ── Color classification for SVG rect fills ──

function classifyColor(fill: string): boolean | null {
  if (!fill) return null;
  const f = fill.toLowerCase().trim();
  // Skip transparent / invisible
  if (f === "transparent" || f === "none" || f === "rgba(0,0,0,0)" || f === "rgba(0, 0, 0, 0)") return null;

  // Parse hex to RGB
  let r = 0, g = 0, b = 0;
  const hexMatch = f.match(/^#([0-9a-f]{3,8})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (hex.length >= 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
  }
  const rgbMatch = f.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    r = parseInt(rgbMatch[1]); g = parseInt(rgbMatch[2]); b = parseInt(rgbMatch[3]);
  }

  if (!hexMatch && !rgbMatch) return null; // unknown format

  // Green shades (operational): g is dominant
  if (g > 100 && g > r * 1.2 && g > b * 1.2) return true;
  // Gray shades (no data): r≈g≈b, all moderate
  if (Math.abs(r - g) < 30 && Math.abs(g - b) < 30 && r > 80 && r < 220) return null;
  // Red/orange/yellow (incident): r is high
  if (r > 150 && r > b) return false;
  // Fallback: if bright enough and greenish, operational
  if (g > r && g > b) return true;

  return null;
}

/**
 * Parse uptime bars directly from Atlassian Statuspage HTML.
 * Each component section has an SVG with <rect> elements whose fill colors
 * indicate daily status. This avoids an expensive AI call.
 */
function parseUptimeBarsFromHTML(
  html: string,
  serviceNames: string[]
): Map<string, { uptime_pct: number | null; uptime_days: (boolean | null)[] }> {
  const result = new Map<string, { uptime_pct: number | null; uptime_days: (boolean | null)[] }>();

  // Find each component-container div which contains the service name and its SVG bar
  // Atlassian Statuspage structure: <div class="component-container..."> ... <span class="name">ServiceName</span> ... <svg>...<rect fill="..."/></svg> ... <span class="uptime-percent">99.99%</span>
  const containerRegex = /<div[^>]*class="[^"]*component-container[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*component-container|<div[^>]*class="[^"]*components-section|$)/gi;
  let containerMatch;

  while ((containerMatch = containerRegex.exec(html)) !== null) {
    const block = containerMatch[1];

    // Extract service name
    const nameMatch = block.match(/<span[^>]*class="[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (!nameMatch) continue;
    const rawName = nameMatch[1].replace(/<[^>]+>/g, "").trim();

    // Find the best matching service name
    const matchedName = serviceNames.find(n => n === rawName) 
      || serviceNames.find(n => rawName.includes(n) || n.includes(rawName));
    if (!matchedName) continue;

    // Extract uptime percentage
    let uptimePct: number | null = null;
    const pctMatch = block.match(/(\d{1,3}\.\d+)\s*%/);
    if (pctMatch) uptimePct = parseFloat(pctMatch[1]);

    // Extract SVG rect fill colors (the uptime bar)
    const days: (boolean | null)[] = [];
    // Find rects with visible fill, sorted by x position
    const rects: { x: number; fill: string }[] = [];
    const rectRegex = /<rect[^>]*>/gi;
    let rectMatch;
    while ((rectMatch = rectRegex.exec(block)) !== null) {
      const tag = rectMatch[0];
      // Skip if it has fill-opacity="0" or data-html (tooltip overlays)
      if (/fill-opacity\s*=\s*"0"/i.test(tag)) continue;
      if (/data-html/i.test(tag)) continue;
      // Must have a height > 20 (bars are tall, overlays may be full-height but transparent)
      const heightMatch = tag.match(/height\s*=\s*"(\d+(?:\.\d+)?)"/);
      const h = heightMatch ? parseFloat(heightMatch[1]) : 0;
      if (h < 20) continue;

      // Get fill color
      let fill = "";
      const fillAttr = tag.match(/fill\s*=\s*"([^"]+)"/i);
      if (fillAttr) fill = fillAttr[1];
      // Also check inline style
      const styleMatch = tag.match(/style\s*=\s*"([^"]+)"/i);
      if (styleMatch) {
        const styleFill = styleMatch[1].match(/fill\s*:\s*([^;]+)/i);
        if (styleFill) fill = styleFill[1].trim();
      }
      if (!fill || fill === "transparent" || fill === "none") continue;

      const xMatch = tag.match(/\bx\s*=\s*"(\d+(?:\.\d+)?)"/);
      const x = xMatch ? parseFloat(xMatch[1]) : 0;
      rects.push({ x, fill });
    }

    // Sort by x position (left to right = oldest to newest)
    rects.sort((a, b) => a.x - b.x);
    for (const rect of rects) {
      days.push(classifyColor(rect.fill));
    }

    if (days.length > 0) {
      result.set(matchedName, { uptime_pct: uptimePct, uptime_days: days });
    }
  }

  return result;
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

    // Build group info map (id -> { name, position })
    const groupInfoMap = new Map<string, { name: string; position: number }>();
    const childComponents: any[] = [];

    for (const c of summary.components) {
      if (c.group) {
        // This IS a group header
        groupInfoMap.set(c.id, { name: c.name, position: c.position ?? 0 });
      } else if (c.name !== pageName) {
        childComponents.push(c);
      }
    }

    // Sort: group position first (ungrouped use their own position), then component position within group
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

    console.log(`Statuspage API found ${services.length} components`);

    // Scrape the HTML page to extract uptime bar data from SVGs — programmatically, no AI needed
    let startDate: string | null = null;
    try {
      const pageRes = await fetch(origin, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html" },
      });
      const rawHtml = await pageRes.text();
      console.log("Fetched HTML for uptime bars, length:", rawHtml.length);

      // Extract chart date range
      const sinceMatch = rawHtml.match(/since-value="(\d{4}-\d{2}-\d{2})/);
      startDate = sinceMatch ? sinceMatch[1] : null;
      console.log("Detected chart start date:", startDate);

      // Parse uptime bars directly from SVG rects — no AI call needed
      const uptimeData = parseUptimeBarsFromHTML(rawHtml, services.map(s => s.name));

      for (const svc of services) {
        const uptime = uptimeData.get(svc.name);
        if (uptime) {
          svc.uptime_pct = uptime.uptime_pct ?? null;
          svc.uptime_days = uptime.uptime_days ?? null;
        }
      }

      const matched = [...uptimeData.entries()].filter(([_, v]) => v.uptime_days && v.uptime_days.length > 0).length;
      console.log(`Parsed uptime bars for ${matched}/${services.length} services`);
    } catch (e: any) {
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

async function extractViaHTML(url: string, apiKey: string): Promise<ExtractedResult> {
  let rawHtml: string;
  try {
    const pageRes = await fetchWithRetries(url);
    rawHtml = await pageRes.text();
  } catch (fetchErr: any) {
    throw new Error(fetchErr.message);
  }

  console.log("Fetched HTML length:", rawHtml.length);

  let servicesHtml = stripForServices(rawHtml);
  console.log("Pass 1 (services) stripped HTML length:", servicesHtml.length);

  // If stripped HTML is very small, the page is likely JS-rendered — try Firecrawl
  if (servicesHtml.length < 200) {
    console.log("Page appears JS-rendered, trying Firecrawl...");
    rawHtml = await fetchRenderedHTML(url);
    servicesHtml = stripForServices(rawHtml);
    console.log("Firecrawl stripped HTML length:", servicesHtml.length);
    if (servicesHtml.length < 200) {
      throw new Error("Could not extract content from this status page, even with JavaScript rendering.");
    }
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
