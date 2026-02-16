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

/** Lighter strip for uptime bar data — keep SVGs, inline styles (colors live in style="fill: #hex"), and data attributes */
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

/** Deterministically extract uptime bar data from SVG rects in the HTML */
function extractBarsFromHtml(html: string, serviceNames: string[]): {
  services: { name: string; uptime_pct: number | null; uptime_days: (boolean | null)[] }[];
  since_value: string | null;
} {
  // Extract since-value from data attributes
  const sinceMatch = html.match(/since-value="(\d{4}-\d{2}-\d{2})/);
  const sinceValue = sinceMatch ? sinceMatch[1] : null;

  // Color classification
  function classifyColor(hex: string): boolean | null {
    const h = hex.toUpperCase().replace("#", "");
    // Green shades → operational (true)
    const greens = ["3CB878", "22C55E", "10B981", "4ADE80", "16A34A", "15803D", "059669", "34D399"];
    if (greens.includes(h)) return true;
    // Red shades → outage (false)
    const reds = ["EF4444", "DC2626", "F87171", "E74C3C", "B91C1C", "FCA5A5", "991B1B"];
    if (reds.includes(h)) return false;
    // Orange/Yellow shades → degraded (false)
    const oranges = ["F59E0B", "F97316", "EAB308", "FB923C", "FBBF24", "D97706", "EA580C"];
    if (oranges.includes(h)) return false;
    // Gray shades → no data (null)
    const grays = ["9CA3AF", "6B7280", "D1D5DB", "E5E7EB", "374151", "4B5563"];
    if (grays.includes(h)) return null;
    // Fallback: if it looks greenish, true; reddish, false; else null
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (g > r && g > b) return true;
    if (r > g && r > b) return false;
    return null;
  }

  const results: { name: string; uptime_pct: number | null; uptime_days: (boolean | null)[] }[] = [];

  // Find all chart SVG blocks with their associated service context
  // Each chart is inside a turbo-frame or div after the service heading
  // Strategy: find all <svg viewBox="0 0 588..."> blocks (chart SVGs have viewBox with width ~588)
  // and associate them with the nearest preceding service name

  // Build a map of service positions in HTML
  // Handle HTML entities: & → &amp;, < → &lt; etc.
  function escapeForHtmlSearch(name: string): string {
    // First escape regex special chars, THEN replace & with entity pattern
    const regexEscaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return regexEscaped.replace(/&/g, "(?:&amp;|&)");
  }

  for (const serviceName of serviceNames) {
    const escaped = escapeForHtmlSearch(serviceName);
    // Find the service name in HTML, then find the FIRST chart SVG after it
    // Chart SVGs have viewBox="0 0 NNN NN" pattern (uptime charts)
    const nameRegex = new RegExp(escaped, "i");
    const nameMatch = html.match(nameRegex);

    if (!nameMatch || nameMatch.index === undefined) {
      console.warn(`Could not find service name in HTML: ${serviceName}`);
      results.push({ name: serviceName, uptime_pct: null, uptime_days: [] });
      continue;
    }

    // Search for the first chart SVG after this service name
    const afterName = html.substring(nameMatch.index);
    // Match chart SVGs specifically (viewBox with large width, containing rect elements)
    const svgMatch = afterName.match(/<svg[^>]*viewBox="0 0 \d[\d.]+ \d+"[^>]*>([\s\S]*?)<\/svg>/);

    if (!svgMatch) {
      console.warn(`Could not find chart SVG for service: ${serviceName}`);
      results.push({ name: serviceName, uptime_pct: null, uptime_days: [] });
      continue;
    }

    const svgContent = svgMatch[1];

    // Extract all visible (non-transparent) rect fill colors
    const rectRegex = /<rect[^>]*style="fill:\s*#([A-Fa-f0-9]{6});?"[^>]*>/g;
    const days: (boolean | null)[] = [];
    let rectMatch;
    while ((rectMatch = rectRegex.exec(svgContent)) !== null) {
      const fullRect = rectMatch[0];
      if (fullRect.includes('fill-opacity="0"') || fullRect.includes("fill: transparent")) continue;
      days.push(classifyColor(rectMatch[1]));
    }

    // Extract uptime percentage from text after the SVG
    const svgEnd = html.indexOf(svgMatch[0], nameMatch.index) + svgMatch[0].length;
    const afterSvg = html.substring(svgEnd, svgEnd + 500);
    const pctMatch = afterSvg.match(/(\d+\.\d+)%/);
    const uptimePct = pctMatch ? parseFloat(pctMatch[1]) : null;

    results.push({ name: serviceName, uptime_pct: uptimePct, uptime_days: days });
  }

  return { services: results, since_value: sinceValue };
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

    // ── PASS 2: Extract uptime bar data deterministically from SVG ──
    const serviceNames = (pass1.services || []).map((s: any) => s.name);
    const barData = extractBarsFromHtml(rawHtml, serviceNames);

    // Use since-value from deterministic extraction
    const startDate = barData.since_value;
    console.log("Detected chart start date (since-value):", startDate);

    // Log summary of extracted bar data for debugging
    const servicesNeedingFallback: string[] = [];
    for (const s of barData.services) {
      const days = s.uptime_days;
      const falseCount = days.filter((d) => d === false).length;
      const nullCount = days.filter((d) => d === null).length;
      console.log(`  ${s.name}: ${days.length} bars, ${falseCount} incidents, ${nullCount} no-data, uptime: ${s.uptime_pct}%`);
      if (days.length === 0) {
        servicesNeedingFallback.push(s.name);
      }
    }
    console.log("Pass 2 (deterministic) found uptime data for", barData.services.length, "services");

    // ── PASS 2b: AI fallback for services with no SVG bar data ──
    const aiFallbackMap = new Map<string, { uptime_pct: number | null; uptime_days: (boolean | null)[] }>();
    if (servicesNeedingFallback.length > 0) {
      console.log("AI fallback needed for", servicesNeedingFallback.length, "services:", servicesNeedingFallback);
      const uptimeHtml = stripForUptime(rawHtml);
      try {
        const pass2ai = await callAI(
          apiKey,
          `You extract uptime bar chart data from status page HTML. Return ONLY valid JSON:
{
  "services": [
    {
      "name": "Service Name",
      "uptime_pct": 99.95,
      "uptime_days": [true, true, false, true, null]
    }
  ]
}
uptime_days: array of 90 booleans (true=up, false=down/degraded, null=no data), oldest first.
uptime_pct: the percentage shown near the bar chart, or null if not visible.
ONLY extract data for these services: ${JSON.stringify(servicesNeedingFallback)}`,
          "Extract uptime bar data for the listed services from this HTML:",
          uptimeHtml
        );
        for (const s of (pass2ai.services || [])) {
          if (servicesNeedingFallback.includes(s.name)) {
            aiFallbackMap.set(s.name, { uptime_pct: s.uptime_pct ?? null, uptime_days: s.uptime_days ?? [] });
            console.log(`  AI fallback for ${s.name}: ${(s.uptime_days || []).length} bars`);
          }
        }
      } catch (e) {
        console.warn("AI fallback for uptime bars failed:", e.message);
      }
    }

    // ── Merge passes ──
    const uptimeMap = new Map<string, { uptime_pct: number | null; uptime_days: (boolean | null)[] }>();
    for (const s of barData.services) {
      if (s.uptime_days.length > 0) {
        uptimeMap.set(s.name, { uptime_pct: s.uptime_pct, uptime_days: s.uptime_days });
      }
    }
    // Layer AI fallback on top for services that had no deterministic data
    for (const [name, data] of aiFallbackMap) {
      if (!uptimeMap.has(name)) {
        uptimeMap.set(name, data);
      }
    }

    const mergedServices = (pass1.services || []).map((s: any) => {
      const uptime = uptimeMap.get(s.name);
      let days: (boolean | null)[] = uptime?.uptime_days ?? [];
      // Always ensure exactly 90 days, padding with null (no data) on the left
      if (days.length < 90) {
        days = [...Array(90 - days.length).fill(null), ...days];
      } else if (days.length > 90) {
        days = days.slice(days.length - 90);
      }
      return {
        name: s.name,
        status: s.status,
        group: s.group,
        uptime_pct: uptime?.uptime_pct ?? null,
        uptime_days: days,
      };
    });

    const result = {
      name: pass1.name,
      services: mergedServices,
      start_date: startDate,
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
