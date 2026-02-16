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
      // Consume body to free resources
      await res.text();
    } catch (e) {
      console.warn(`Fetch attempt failed:`, e.message);
    }
  }

  throw new Error("All fetch attempts were blocked by the target site. Try a different URL.");
}

function stripHtml(html: string): string {
  // Remove script, style, noscript, head tags and their contents
  // NOTE: Keep SVGs — they often encode uptime bar data
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, "")
    // Remove style attributes but keep class and data attributes (they encode status info for uptime bars)
    .replace(/\s+style="[^"]*"/g, "")
    // Collapse whitespace
    .replace(/\s{2,}/g, " ")
    .replace(/>\s+</g, "><");
  
  return cleaned;
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

    console.log("Fetching URL:", url);
    
    let html: string;
    try {
      const pageRes = await fetchWithRetries(url);
      html = await pageRes.text();
    } catch (fetchErr) {
      return new Response(
        JSON.stringify({ success: false, error: fetchErr.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Fetched HTML length:", html.length);

    // Use AI to extract structured data
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "AI not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Truncate HTML to avoid token limits
    // Strip non-content HTML to maximize useful content within token limits
    const strippedHtml = stripHtml(html);
    console.log("Stripped HTML length:", strippedHtml.length);
    const truncatedHtml = strippedHtml.slice(0, 500000);

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You extract status page data from HTML. Return ONLY valid JSON with this structure:
{
  "name": "Page name/title",
  "services": [
    { "name": "Service Name", "status": "operational|degraded|partial|major|maintenance", "group": "Group Name or null", "uptime_pct": 99.99, "uptime_days": [true, true, false, true] }
  ]
}
IMPORTANT: Extract ALL services listed on the page, not just the first one. Look for every component/service entry.
If services are organized into groups/categories, include the group name in each service's "group" field. If a service has no group, set "group" to null.
CRITICAL: Group/category headers are NOT services. Do NOT include group names as separate service entries. Only include actual services/components that have their own status.
Map statuses: green/up/operational -> "operational", yellow/degraded/slow -> "degraded", orange/partial -> "partial", red/down/major -> "major", blue/maintenance/scheduled -> "maintenance". If unsure, use "operational". For the "name" field, remove any trailing suffixes like "| Status", "Status", "- Status Page", etc. Return just the clean company/product name.

UPTIME DATA: If the page shows uptime percentage for a service, include it as "uptime_pct" (a number like 99.99). If not available, set to null.
If the page shows a daily uptime bar/chart (colored bars indicating up/down for each day), extract it as "uptime_days": an array of booleans (true=up, false=down) ordered from oldest to newest (left to right as displayed). Look for colored bars, dots, or segments that represent daily status - green/gray segments typically mean "up" (true), and red/orange/yellow segments mean "down" (false). If no daily data is visible, set "uptime_days" to null.`,
          },
          {
            role: "user",
            content: `Extract the status page name and all services with their current statuses from this HTML:\n\n${truncatedHtml}`,
          },
        ],
        temperature: 0,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI error:", errText);
      return new Response(
        JSON.stringify({ success: false, error: "AI extraction failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content ?? "";

    // Extract JSON from the response (handle markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Attempt to repair truncated JSON
      try {
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
        parsed = JSON.parse(repaired);
        console.warn("Repaired truncated JSON response");
      } catch {
        console.error("Failed to parse AI response:", content);
        return new Response(
          JSON.stringify({ success: false, error: "Could not parse status page data" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ success: true, data: parsed }),
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
