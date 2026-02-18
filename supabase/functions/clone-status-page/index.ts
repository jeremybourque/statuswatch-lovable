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

interface ExtractedIncidentUpdate {
  status: "investigating" | "identified" | "monitoring" | "resolved";
  message: string;
  timestamp: string;
}

interface ExtractedIncident {
  title: string;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  impact: ServiceStatus;
  created_at: string;
  detail_url?: string | null;
  api_id?: string | null;
  updates: ExtractedIncidentUpdate[];
}

interface ExtractedResult {
  name: string;
  services: ExtractedService[];
  incidents: ExtractedIncident[];
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

    // Also fetch /api/v2/components.json which may return more components
    // than summary.json (summary can be truncated on some providers)
    let allApiComponents: any[] = [...summary.components];
    try {
      const componentsRes = await fetch(`${origin}/api/v2/components.json`, {
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      });
      if (componentsRes.ok) {
        const componentsData = await componentsRes.json();
        const fullList = componentsData?.components || [];
        if (fullList.length > allApiComponents.length) {
          // Merge: add any components not already in the summary
          const existingIds = new Set(allApiComponents.map((c: any) => c.id));
          for (const c of fullList) {
            if (!existingIds.has(c.id)) {
              allApiComponents.push(c);
            }
          }
          console.log(`Merged components: summary had ${summary.components.length}, components.json had ${fullList.length}, total unique: ${allApiComponents.length}`);
        }
      }
    } catch (_e) {
      // components.json not available, continue with summary data
    }

    progress("Parsing component list and group structure...");

    const groupInfoMap = new Map<string, { name: string; position: number }>();
    const childComponents: any[] = [];

    // Check if the API provides group structure (Atlassian Statuspage standard)
    const hasApiGroups = allApiComponents.some((c: any) => c.group === true || c.group_id);

    if (hasApiGroups) {
      // Standard Atlassian: API provides group_id
      for (const c of allApiComponents) {
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
    } else {
      // No API group structure — include all non-page components (will be reordered by HTML later)
      for (const c of allApiComponents) {
        if (c.name !== pageName) childComponents.push(c);
      }
    }

    let services: ExtractedService[] = childComponents.map((c: any) => ({
      name: c.name,
      status: mapStatuspageStatus(c.status),
      group: c.group_id ? (groupInfoMap.get(c.group_id)?.name || null) : null,
      uptime_pct: null,
      uptime_days: null,
    }));

    if (services.length === 0) {
      progress("No services found via API");
      return { name: pageName, services: [], incidents: [], start_date: null };
    }

    progress(`Found ${services.length} components via API`);

    // Scrape the HTML page to extract uptime bar data from SVGs
    let startDate: string | null = null;
    try {
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

      // If API didn't provide group structure, extract groups AND order from HTML
      if (!hasApiGroups) {
        progress("API has no group info, extracting groups and order from HTML...");
        const { groupMap, orderedNames } = extractGroupsAndOrderFromHtml(rawHtml, services.map(s => s.name));
        
        let groupedCount = 0;
        for (const svc of services) {
          const group = groupMap.get(svc.name);
          if (group) {
            svc.group = group;
            groupedCount++;
          }
        }
        if (groupedCount > 0) {
          progress(`Assigned ${groupedCount} services to groups from HTML`);
        }

        // Reorder services to match HTML visual order
        if (orderedNames.length > 0) {
          const serviceByName = new Map<string, ExtractedService>();
          for (const svc of services) serviceByName.set(svc.name, svc);
          
          const reordered: ExtractedService[] = [];
          for (const name of orderedNames) {
            const svc = serviceByName.get(name);
            if (svc) {
              reordered.push(svc);
              serviceByName.delete(name);
            }
          }
          // Append any services not found in HTML at the end
          for (const svc of serviceByName.values()) reordered.push(svc);
          services = reordered;
          progress(`Reordered ${reordered.length} services to match page layout`);
        }
      }

      const serviceNames = services.map(s => s.name);
      let uptimeMap: Map<string, { uptime_pct?: number | null; uptime_days?: (boolean | null)[] | null }>;

      progress("Parsing uptime bars from SVG rects...");
      uptimeMap = parseSvgDeterministic(uptimeHtml, serviceNames, progress);

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
    } catch (e: any) {
      progress(`Could not scrape uptime bars: ${e.message}`);
      console.log("Could not scrape uptime bars:", e.message);
    }

    // Fetch incidents from API
    let incidents: ExtractedIncident[] = [];
    try {
      progress("Fetching incidents from API...");
      incidents = await fetchIncidentsFromAPI(origin, progress);
      progress(`Found ${incidents.length} incidents via API`);
    } catch (e: any) {
      progress(`Could not fetch incidents: ${e.message}`);
    }

    return { name: pageName, services, incidents, start_date: startDate };
  } catch (e) {
    console.log("Statuspage API not available:", e.message);
    return null;
  }
}

// ── Extract group structure AND visual order from HTML ──
// Uses "N components" markers for groups, and service name positions for ordering.
function extractGroupsAndOrderFromHtml(
  html: string,
  serviceNames: string[]
): { groupMap: Map<string, string>; orderedNames: string[] } {
  const groupMap = new Map<string, string>();

  // Step 1: Find group markers
  const componentMarkerRegex = /(\d+)\s*components?/gi;
  const groupEntries: { name: string; pos: number; count: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = componentMarkerRegex.exec(html)) !== null) {
    const markerPos = match.index;
    const componentCount = parseInt(match[1], 10);
    if (componentCount < 1 || componentCount > 200) continue;

    const lookback = html.slice(Math.max(0, markerPos - 500), markerPos);
    const textMatches = [...lookback.matchAll(/>([^<]{2,80}?)</g)];
    if (textMatches.length === 0) continue;

    let groupName: string | null = null;
    for (let i = textMatches.length - 1; i >= 0; i--) {
      const candidate = textMatches[i][1].replace(/\s+/g, " ").trim();
      if (
        candidate.length < 2 ||
        /^\d+$/.test(candidate) ||
        /^\d+%/.test(candidate) ||
        /^(operational|degraded|partial|major|maintenance|uptime|subscribe|100%|99)/i.test(candidate) ||
        /components?$/i.test(candidate)
      ) continue;
      if (serviceNames.some(s => s.toLowerCase() === candidate.toLowerCase())) continue;
      groupName = candidate;
      break;
    }

    if (groupName && !groupEntries.some(g => g.name === groupName)) {
      groupEntries.push({ name: groupName, pos: markerPos, count: componentCount });
    }
  }

  // Step 2: Find ALL occurrences of each service name, pick the one that best
  // represents its visual position (the one nearest an uptime bar / SVG).
  const servicePositions: { name: string; pos: number }[] = [];
  for (const name of serviceNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const svcRegex = new RegExp(`>\\s*${escaped}\\s*<`, "gi");
    let bestPos = -1;
    let svcMatch: RegExpExecArray | null;
    while ((svcMatch = svcRegex.exec(html)) !== null) {
      // Prefer occurrences NOT inside an expanded group section
      // Use the first occurrence as default
      if (bestPos === -1) bestPos = svcMatch.index;
    }
    if (bestPos >= 0) {
      servicePositions.push({ name, pos: bestPos });
    }
  }

  // Sort by HTML position for visual order
  servicePositions.sort((a, b) => a.pos - b.pos);
  const orderedNames = servicePositions.map(sp => sp.name);

  // Step 3: Assign groups using count-based limiting
  if (groupEntries.length > 0) {
    groupEntries.sort((a, b) => a.pos - b.pos);

    for (let gi = 0; gi < groupEntries.length; gi++) {
      const groupStart = groupEntries[gi].pos;
      const groupEnd = gi + 1 < groupEntries.length ? groupEntries[gi + 1].pos : html.length;
      const groupName = groupEntries[gi].name;
      const maxCount = groupEntries[gi].count;

      const candidates = servicePositions
        .filter(sp => sp.pos > groupStart && sp.pos < groupEnd)
        .sort((a, b) => a.pos - b.pos);

      for (let i = 0; i < Math.min(candidates.length, maxCount); i++) {
        groupMap.set(candidates[i].name, groupName);
      }
    }

    console.log(`extractGroupsAndOrderFromHtml: ${groupEntries.length} groups (${groupEntries.map(g => g.name).join(", ")}), mapped ${groupMap.size} services, ordered ${orderedNames.length}`);
  }

  return { groupMap, orderedNames };
}

// ── Incident extraction via Atlassian API ──

function mapIncidentStatus(status: string): ExtractedIncident["status"] {
  switch (status) {
    case "investigating": return "investigating";
    case "identified": return "identified";
    case "monitoring": return "monitoring";
    case "resolved": return "resolved";
    case "postmortem": return "resolved";
    default: return "investigating";
  }
}

function mapIncidentImpact(impact: string): ServiceStatus {
  switch (impact) {
    case "none": return "operational";
    case "minor": return "degraded";
    case "major": return "partial";
    case "critical": return "major";
    case "maintenance": return "maintenance";
    default: return "major";
  }
}

async function fetchIncidentsFromAPI(origin: string, progress: ProgressFn): Promise<ExtractedIncident[]> {
  // Fetch both unresolved and recent resolved incidents
  const [unresolvedRes, resolvedRes] = await Promise.all([
    fetch(`${origin}/api/v2/incidents/unresolved.json`, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
    }),
    fetch(`${origin}/api/v2/incidents.json`, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
    }),
  ]);

  const allIncidents: ExtractedIncident[] = [];
  const seenIds = new Set<string>();
  const incidentApiIds: string[] = [];

  const parseIncidents = (data: any) => {
    for (const inc of (data?.incidents || [])) {
      if (seenIds.has(inc.id)) continue;
      seenIds.add(inc.id);
      incidentApiIds.push(inc.id);
      const updates: ExtractedIncidentUpdate[] = (inc.incident_updates || []).map((u: any) => ({
        status: mapIncidentStatus(u.status),
        message: u.body || "",
        timestamp: u.created_at || u.updated_at || inc.created_at,
      }));
      allIncidents.push({
        title: inc.name,
        status: mapIncidentStatus(inc.status),
        impact: mapIncidentImpact(inc.impact),
        created_at: inc.created_at,
        detail_url: inc.shortlink || null,
        api_id: inc.id,
        updates,
      });
    }
  };

  if (unresolvedRes.ok) parseIncidents(await unresolvedRes.json());
  if (resolvedRes.ok) parseIncidents(await resolvedRes.json());

  // Sort newest first
  allIncidents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // For incidents with empty update messages, scrape the incident HTML pages
  const incidentsNeedingDetail = allIncidents.filter(
    (inc) => inc.updates.some(u => !u.message.trim())
  );

  if (incidentsNeedingDetail.length > 0) {
    progress(`Fetching details for ${incidentsNeedingDetail.length} incidents with missing update content...`);
    
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");

    // Process in batches of 5
    for (let i = 0; i < incidentsNeedingDetail.length; i += 5) {
      const batch = incidentsNeedingDetail.slice(i, i + 5);
      await Promise.allSettled(
        batch.map(async (inc) => {
          const apiId = inc.api_id;
          if (!apiId) return;
          
          // Try scraping the incident page for update content
          const incidentUrl = `${origin}/incidents/${apiId}`;
          try {
            let markdown = "";
            
            if (firecrawlKey) {
              // Use Firecrawl for JS-rendered pages
              const fcRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${firecrawlKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  url: incidentUrl,
                  formats: ["markdown"],
                  onlyMainContent: true,
                }),
              });
              if (fcRes.ok) {
                const fcData = await fcRes.json();
                markdown = fcData?.data?.markdown || fcData?.markdown || "";
              }
            } else {
              // Fallback: plain fetch
              const htmlRes = await fetch(incidentUrl, {
                headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
              });
              if (htmlRes.ok) {
                markdown = await htmlRes.text();
              }
            }
            
            if (!markdown) return;
            
            // Parse updates from markdown
            // incident.io format: "Resolved\n\nMessage text\n\nTimestamp\n\nIdentified\n\nMessage text\n\nTimestamp"
            const updateStatuses = ["resolved", "monitoring", "identified", "investigating", "update"];
            const parsedUpdates: ExtractedIncidentUpdate[] = [];
            
            // Find the "Updates" section
            const updatesIdx = markdown.indexOf("Updates");
            if (updatesIdx === -1) return;
            const updatesSection = markdown.slice(updatesIdx);
            
            // Split by status headers - look for lines that are just a status word
            const lines = updatesSection.split("\n");
            let currentStatus = "";
            let currentMessage: string[] = [];
            let currentTimestamp = "";
            
            for (const line of lines) {
              const trimmed = line.trim().toLowerCase();
              const isStatusLine = updateStatuses.includes(trimmed);
              
              if (isStatusLine) {
                // Save previous update if we have one
                if (currentStatus && currentMessage.length > 0) {
                  parsedUpdates.push({
                    status: mapIncidentStatus(currentStatus),
                    message: currentMessage.join("\n").trim(),
                    timestamp: currentTimestamp || inc.created_at,
                  });
                }
                currentStatus = trimmed;
                currentMessage = [];
                currentTimestamp = "";
              } else if (currentStatus) {
                // Try to detect timestamp lines (e.g., "Thu, Nov 20, 2025, 07:14 AM")
                const isTimestamp = /\b\d{4}\b/.test(line) && /\b(AM|PM|ago)\b/i.test(line);
                if (isTimestamp) {
                  // Clean raw timestamp: remove "(X minutes earlier)" suffix and try to parse
                  let rawTs = line.trim().replace(/\s*\(.*?\)\s*$/, "");
                  try {
                    const parsed = new Date(rawTs);
                    currentTimestamp = isNaN(parsed.getTime()) ? "" : parsed.toISOString();
                  } catch {
                    currentTimestamp = "";
                  }
                } else if (trimmed && !trimmed.startsWith("powered by") && !trimmed.startsWith("privacy") && trimmed !== "updates") {
                  // Skip navigation/footer content
                  if (!trimmed.includes("earlier)") || trimmed.length > 20) {
                    currentMessage.push(line.trim());
                  }
                }
              }
            }
            // Save last update
            if (currentStatus && currentMessage.length > 0) {
              parsedUpdates.push({
                status: mapIncidentStatus(currentStatus),
                message: currentMessage.join("\n").trim(),
                timestamp: currentTimestamp || inc.created_at,
              });
            }
            
            if (parsedUpdates.length > 0) {
              // Match timestamps from API updates to parsed updates
              const apiUpdates = inc.updates;
              for (let j = 0; j < parsedUpdates.length && j < apiUpdates.length; j++) {
                parsedUpdates[j].timestamp = apiUpdates[j].timestamp;
                parsedUpdates[j].status = apiUpdates[j].status;
              }
              inc.updates = parsedUpdates;
              console.log(`Scraped ${parsedUpdates.length} updates for "${inc.title}"`);
            }
          } catch (e: any) {
            console.warn(`Could not scrape incident "${inc.title}":`, e.message);
          }
        })
      );
    }
  }

  return allIncidents;
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

// ── Deterministic SVG rect parser ──

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function classifyFillColor(fill: string): boolean | null {
  const f = fill.trim().toLowerCase();
  if (!f || f === 'transparent' || f === 'none') return undefined as any; // skip

  // Named colors
  if (/^(green|limegreen|lime|forestgreen|seagreen|mediumseagreen)$/.test(f)) return true;
  if (/^(red|orangered|tomato|crimson|firebrick|darkred)$/.test(f)) return false;
  if (/^(orange|darkorange|gold|yellow|goldenrod)$/.test(f)) return false;
  if (/^(gray|grey|lightgray|lightgrey|darkgray|darkgrey|silver|gainsboro)$/.test(f)) return null;

  let r: number, g: number, b: number;

  // Hex
  if (f.startsWith('#')) {
    const rgb = hexToRgb(f);
    if (!rgb) return null;
    [r, g, b] = rgb;
  }
  // rgb()/rgba()
  else {
    const rgbMatch = f.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!rgbMatch) return null;
    r = parseInt(rgbMatch[1]); g = parseInt(rgbMatch[2]); b = parseInt(rgbMatch[3]);
  }

  // Classify by RGB heuristics
  // Green: dominant green channel
  if (g > 130 && g > r * 1.2 && g > b) return true;
  // Red: dominant red, low green
  if (r > 180 && g < 120 && r > b) return false;
  // Orange: high red, medium green, low blue
  if (r > 180 && g > 80 && g < 200 && b < 100) return false;
  // Yellow: high red and green, low blue
  if (r > 200 && g > 180 && b < 100) return false;
  // Gray: channels are close together
  if (Math.abs(r - g) < 40 && Math.abs(g - b) < 40 && Math.abs(r - b) < 40) return null;

  return null;
}
// Classify uptime bar by CSS class name (e.g. incident.io uses UptimeChart_pillOperational__xxx)
function classifyUptimeClass(className: string): boolean | null | undefined {
  const cl = className.toLowerCase();
  // Operational / up = green → true
  if (/operational|success|up\b|healthy|available|active/.test(cl)) return true;
  // Degraded / partial / warning → false
  if (/degraded|partial|warning|impaired|limited/.test(cl)) return false;
  // Major / outage / down / critical / error → false
  if (/major|outage|down|critical|error|incident|disruption/.test(cl)) return false;
  // Maintenance → false
  if (/maintenance|scheduled/.test(cl)) return false;
  // No data / empty / unknown → null
  if (/nodata|no-data|empty|unknown|none|placeholder/.test(cl)) return null;
  // If it contains "pill" or "bar" but no status keyword, it's likely a bar element — default to null
  if (/pill|bar|uptime|chart/.test(cl)) return null;
  return undefined; // unrecognized
}
function parseSvgDeterministic(
  html: string,
  serviceNames: string[],
  progress: ProgressFn,
): Map<string, { uptime_pct?: number | null; uptime_days?: (boolean | null)[] | null }> {
  const result = new Map<string, { uptime_pct?: number | null; uptime_days?: (boolean | null)[] | null }>();

  // Find all component-inner-container or similar sections
  // Strategy: locate each service name, then find the nearest SVG after it and parse rects
  for (const name of serviceNames) {
    // Try both raw name and HTML-encoded version (& → &amp; etc.)
    const htmlName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let nameIdx = html.indexOf(name);
    if (nameIdx === -1) nameIdx = html.indexOf(htmlName);
    if (nameIdx === -1) {
      console.log(`  Deterministic: service "${name}" not found in HTML`);
      continue;
    }

    // Bound the search: don't go past the next service name or too far
    let boundIdx = html.length;
    for (const other of serviceNames) {
      if (other === name) continue;
      const otherIdx = html.indexOf(other, nameIdx + name.length);
      if (otherIdx !== -1 && otherIdx < boundIdx) boundIdx = otherIdx;
    }

    // Find the next <svg after this name
    // Skip small icon SVGs — find the SVG that contains <rect elements (the uptime chart)
    let svgContent = '';
    let svgSearchStart = nameIdx;
    while (true) {
      const svgStartIdx = html.indexOf('<svg', svgSearchStart);
      if (svgStartIdx === -1 || svgStartIdx > boundIdx) break;

      const svgEndIdx = html.indexOf('</svg>', svgStartIdx);
      if (svgEndIdx === -1 || svgEndIdx > boundIdx + 500) break;

      const candidate = html.slice(svgStartIdx, svgEndIdx + 6);
      if (candidate.includes('<rect')) {
        svgContent = candidate;
        break;
      }
      svgSearchStart = svgEndIdx + 6;
    }

    if (!svgContent) {
      console.log(`  Deterministic: no SVG with <rect> found after "${name}"`);
      continue;
    }

    // Extract all rect elements with fill colors or CSS classes
    const rects: { color: boolean | null; x: number }[] = [];
    const rectRegex = /<rect[^>]*>/gi;
    let match;
    while ((match = rectRegex.exec(svgContent)) !== null) {
      const rectStr = match[0];

      // Skip rects with zero opacity (overlay/hover rects)
      const opacityMatch = rectStr.match(/(?:fill-)?opacity="([^"]+)"/i);
      if (opacityMatch && parseFloat(opacityMatch[1]) === 0) continue;

      // Extract fill from attribute or inline style
      let fill = '';
      const fillAttr = rectStr.match(/fill="([^"]+)"/i);
      if (fillAttr) fill = fillAttr[1];
      if (!fill || fill === 'transparent' || fill === 'none') {
        const styleFill = rectStr.match(/style="[^"]*fill:\s*([^;"]+)/i);
        if (styleFill) fill = styleFill[1];
      }

      let classified: boolean | null | undefined;

      if (fill && fill !== 'transparent' && fill !== 'none') {
        classified = classifyFillColor(fill);
      } else {
        // Try CSS class-based classification (e.g. incident.io uses UptimeChart_pillOperational__xxx)
        const classAttr = rectStr.match(/class="([^"]+)"/i);
        if (classAttr) {
          classified = classifyUptimeClass(classAttr[1]);
        }
      }

      if (classified === undefined) continue; // skip unclassifiable

      // Extract x position for ordering
      const xMatch = rectStr.match(/\bx="([^"]+)"/i);
      const x = xMatch ? parseFloat(xMatch[1]) : 0;

      rects.push({ color: classified, x });
    }

    // Sort by x position (left to right = oldest to newest)
    rects.sort((a, b) => a.x - b.x);

    const days = rects.map(r => r.color);

    // Try to find uptime percentage near the service name
    const nearbyText = html.slice(nameIdx, Math.min(nameIdx + 800, boundIdx));
    const pctMatch = nearbyText.match(/(\d{1,3}(?:\.\d{1,4})?)\s*%/);
    const uptime_pct = pctMatch ? parseFloat(pctMatch[1]) : null;

    console.log(`  Deterministic: ${name}: ${days.length} bars, ${days.filter(d => d === false).length} incidents, uptime: ${uptime_pct}%`);
    result.set(name, { uptime_pct, uptime_days: days.length > 0 ? days : null });
  }

  progress(`Deterministic parse: matched ${result.size}/${serviceNames.length} services`);
  return result;
}


async function callAI(apiKey: string, systemPrompt: string, userPrompt: string, htmlContent: string, timeoutMs = 120000): Promise<any> {
  const truncated = htmlContent.slice(0, 800000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let aiRes: Response;
  try {
    aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error("AI request timed out");
    throw e;
  }
  clearTimeout(timer);

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

function expandAllScript(): string {
  return [
    // Aria-expanded elements
    `document.querySelectorAll('[aria-expanded="false"]').forEach(el => el.click());`,
    // Atlassian collapsed components
    `document.querySelectorAll('.component-container.collapsed, details:not([open])').forEach(el => { if (el.tagName === 'DETAILS') el.setAttribute('open',''); else el.click(); });`,
    // MUI accordions
    `document.querySelectorAll('.MuiAccordionSummary-root, .MuiButtonBase-root[aria-expanded="false"], [class*="collapsed"], [class*="Collapsed"], [class*="expandable"], [class*="Expandable"]').forEach(el => el.click());`,
    `document.querySelectorAll('.MuiCollapse-hidden, .MuiCollapse-wrapper').forEach(el => { el.style.height = 'auto'; el.style.visibility = 'visible'; });`,
    // incident.io & Radix: click "N components" buttons
    `document.querySelectorAll('button, [role="button"], [class*="cursor-pointer"], div[class*="cursor-pointer"]').forEach(el => { if (/\\d+\\s*components?/i.test(el.textContent || '')) el.click(); });`,
    // Radix data-state
    `document.querySelectorAll('[data-state="closed"]').forEach(el => { if (el.click) el.click(); });`,
    // incident.io specific: expand group containers by clicking any chevron/caret SVGs inside group headers
    `document.querySelectorAll('svg[class*="chevron"], svg[class*="caret"], svg[class*="arrow"]').forEach(svg => { const btn = svg.closest('button, [role="button"], [class*="cursor-pointer"]'); if (btn) btn.click(); });`,
    // Force open any hidden content containers
    `document.querySelectorAll('[class*="hidden"], [class*="collapse"]:not(.show)').forEach(el => { if (el.classList.contains('hidden')) el.classList.remove('hidden'); el.style.display = 'block'; el.style.height = 'auto'; el.style.overflow = 'visible'; });`,
  ].join(' ');
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
      onlyMainContent: false,
      waitFor: 5000,
      actions: [
        // First scroll to bottom to trigger any lazy-loaded content
        { type: "scroll", direction: "down", amount: 9999 },
        { type: "wait", milliseconds: 2000 },
        { type: "scroll", direction: "up", amount: 9999 },
        { type: "wait", milliseconds: 1000 },
        // First expansion pass - click everything expandable
        { type: "executeJavascript", script: expandAllScript() },
        { type: "wait", milliseconds: 3000 },
        // Second pass to catch nested or delayed expansions
        { type: "executeJavascript", script: expandAllScript() },
        { type: "wait", milliseconds: 3000 },
        // Third pass for deeply nested
        { type: "executeJavascript", script: expandAllScript() },
        { type: "wait", milliseconds: 2000 },
      ],
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
  console.log("Firecrawl HTML preview (first 3000 chars):", html.slice(0, 3000));
  console.log("Firecrawl HTML preview (last 2000 chars):", html.slice(-2000));
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
      onlyMainContent: false,
      waitFor: 5000,
      actions: [
        { type: "scroll", direction: "down", amount: 9999 },
        { type: "wait", milliseconds: 2000 },
        { type: "scroll", direction: "up", amount: 9999 },
        { type: "wait", milliseconds: 1000 },
        { type: "executeJavascript", script: expandAllScript() },
        { type: "wait", milliseconds: 3000 },
        { type: "executeJavascript", script: expandAllScript() },
        { type: "wait", milliseconds: 3000 },
        { type: "executeJavascript", script: expandAllScript() },
        { type: "wait", milliseconds: 2000 },
      ],
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
  console.log("Firecrawl uptime HTML preview (first 3000 chars):", html.slice(0, 3000));
  return html;
}

const INCIDENT_SYSTEM_PROMPT = `You extract incident data from a status page HTML. Look for incident history, past incidents, and any current ongoing incidents.

Return ONLY valid JSON:
{
  "incidents": [
    {
      "title": "Incident title",
      "status": "investigating|identified|monitoring|resolved",
      "impact": "operational|degraded|partial|major|maintenance",
      "created_at": "ISO 8601 timestamp or date string",
      "detail_url": "URL to the incident detail page if the title is a link, otherwise null",
      "updates": [
        { "status": "investigating|identified|monitoring|resolved", "message": "Update text", "timestamp": "ISO 8601 timestamp" }
      ]
    }
  ]
}

CRITICAL RULES:
1. Extract ALL incidents shown on the page, both current/ongoing and historical/past.
2. Each incident should have all its timeline updates in chronological order (newest first).
3. Map impact: minor/degraded → "degraded", major/partial → "partial", critical/outage → "major", maintenance → "maintenance".
4. If no timestamp is available for an update, use the incident's created_at.
5. If you cannot determine exact timestamps, use reasonable ISO 8601 dates based on relative text like "2 days ago".
6. Return an empty incidents array if no incidents are found.
7. IMPORTANT: If the incident title is wrapped in an <a> tag (a link), extract the full href URL into "detail_url". This is critical for fetching additional updates.`;

function findIncidentHistoryUrl(html: string, baseUrl: string): string | null {
  // Look for links to incident history pages
  const patterns = [
    /href="([^"]*(?:incident[s\-_]*histor|histor[y\-_]*incident|past[_\-]*incident|incident[s]?\/?\?|\/history)[^"]*)"/gi,
    /href="([^"]*\/incidents?\/?[^"]*)"/gi,
  ];

  const origin = new URL(baseUrl).origin;
  const seen = new Set<string>();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      let href = match[1].trim();
      // Skip anchors, javascript, and the current page
      if (href.startsWith('#') || href.startsWith('javascript:') || href === '/') continue;
      // Resolve relative URLs
      if (href.startsWith('/')) href = origin + href;
      else if (!href.startsWith('http')) href = origin + '/' + href;
      // Skip if it's the same as the base URL
      try {
        const parsed = new URL(href);
        const base = new URL(baseUrl);
        if (parsed.pathname === base.pathname || parsed.pathname === '/') continue;
        if (seen.has(parsed.href)) continue;
        seen.add(parsed.href);
        // Prefer URLs with "history" or "incidents" in them
        if (/histor|incident/i.test(parsed.pathname)) {
          return parsed.href;
        }
      } catch { continue; }
    }
  }

  return null;
}

function parseIncidentsFromAIResult(result: any): ExtractedIncident[] {
  return (result.incidents || []).map((inc: any) => ({
    title: inc.title || "Untitled Incident",
    status: inc.status || "resolved",
    impact: inc.impact || "major",
    created_at: inc.created_at || new Date().toISOString(),
    detail_url: inc.detail_url || null,
    updates: (inc.updates || []).map((u: any) => ({
      status: u.status || "investigating",
      message: u.message || "",
      timestamp: u.timestamp || inc.created_at || new Date().toISOString(),
    })),
  }));
}

const INCIDENT_DETAIL_SYSTEM_PROMPT = `You extract incident timeline updates from an incident detail page HTML.

Return ONLY valid JSON:
{
  "updates": [
    { "status": "investigating|identified|monitoring|maintenance|resolved", "message": "Update text", "timestamp": "ISO 8601 timestamp" }
  ]
}

CRITICAL RULES:
1. Extract ALL timeline updates/entries shown on the page, in chronological order (newest first).
2. Each update has a status, a message body, and a timestamp.
3. Map statuses: investigating, identified, monitoring, maintenance, resolved. If unclear, use "investigating".
4. Include the full message text for each update.
5. Use ISO 8601 timestamps. If only a date is shown, use midnight UTC.`;

async function scrapeIncidentDetailPage(
  apiKey: string,
  url: string,
  progress: ProgressFn,
): Promise<ExtractedIncidentUpdate[]> {
  let html: string;
  try {
    const res = await fetchWithRetries(url);
    html = await res.text();
  } catch {
    html = await fetchRenderedHTML(url);
  }

  const stripped = stripForServices(html);
  if (stripped.length < 100) return [];

  const result = await callAI(
    apiKey,
    INCIDENT_DETAIL_SYSTEM_PROMPT,
    "Extract all incident timeline updates from this incident detail page:",
    stripped
  );

  return (result.updates || []).map((u: any) => ({
    status: u.status || "investigating",
    message: u.message || "",
    timestamp: u.timestamp || new Date().toISOString(),
  }));
}

async function extractIncidentsViaAI(
  apiKey: string,
  html: string,
  baseUrl: string,
  progress: ProgressFn,
): Promise<ExtractedIncident[]> {
  progress("Sending HTML to AI for incident extraction...");

  const result = await callAI(
    apiKey,
    INCIDENT_SYSTEM_PROMPT,
    "Extract all incidents (current and historical) from this status page HTML:",
    html
  );

  let incidents = parseIncidentsFromAIResult(result);
  progress(`Found ${incidents.length} incidents on main page`);

  // Check for incident history link
  const historyUrl = findIncidentHistoryUrl(html, baseUrl);
  if (historyUrl) {
    progress(`Found incident history link: ${historyUrl}`);
    try {
      let historyHtml: string;
      try {
        const res = await fetchWithRetries(historyUrl);
        historyHtml = await res.text();
      } catch {
        historyHtml = await fetchRenderedHTML(historyUrl);
      }

      const strippedHistory = stripForServices(historyHtml);
      if (strippedHistory.length > 200) {
        progress("Extracting incidents from history page...");
        const historyResult = await callAI(
          apiKey,
          INCIDENT_SYSTEM_PROMPT,
          "Extract all incidents (current and historical) from this incident history page HTML:",
          strippedHistory
        );
        const historyIncidents = parseIncidentsFromAIResult(historyResult);
        progress(`Found ${historyIncidents.length} incidents on history page`);

        // Merge, dedup by title
        const seen = new Set(incidents.map(i => i.title));
        for (const inc of historyIncidents) {
          if (!seen.has(inc.title)) {
            seen.add(inc.title);
            incidents.push(inc);
          }
        }
        // Re-sort newest first
        incidents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        progress(`Total unique incidents after merge: ${incidents.length}`);
      }
    } catch (e: any) {
      progress(`Could not fetch incident history page: ${e.message}`);
    }
  }

  // Scrape individual incident detail pages for incidents with few updates
  const origin = new URL(baseUrl).origin;
  const incidentsToScrape = incidents.filter(
    (inc) => inc.detail_url && inc.updates.length <= 1
  );

  if (incidentsToScrape.length > 0) {
    progress(`Scraping ${incidentsToScrape.length} incident detail pages for additional updates...`);

    // Process up to 5 detail pages in parallel to avoid excessive load
    const batches: ExtractedIncident[][] = [];
    for (let i = 0; i < incidentsToScrape.length; i += 5) {
      batches.push(incidentsToScrape.slice(i, i + 5));
    }

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(async (inc) => {
          let detailUrl = inc.detail_url!;
          // Resolve relative URLs
          if (detailUrl.startsWith('/')) detailUrl = origin + detailUrl;
          else if (!detailUrl.startsWith('http')) detailUrl = origin + '/' + detailUrl;

          try {
            const updates = await scrapeIncidentDetailPage(apiKey, detailUrl, progress);
            if (updates.length > inc.updates.length) {
              progress(`  ${inc.title}: found ${updates.length} updates (was ${inc.updates.length})`);
              inc.updates = updates;
              // Update incident status from the newest update
              if (updates.length > 0) {
                inc.status = updates[0].status as ExtractedIncident["status"];
              }
            }
          } catch (e: any) {
            console.warn(`Could not scrape detail page for "${inc.title}":`, e.message);
          }
        })
      );
    }
  }

  // Remove detail_url from final output (not needed downstream)
  for (const inc of incidents) {
    delete inc.detail_url;
  }

  return incidents;
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

  if (servicesHtml.length < 500) {
    progress("Page appears JS-rendered, using Firecrawl...");
    rawHtml = await fetchRenderedHTML(url);
    servicesHtml = stripForServices(rawHtml);
    console.log("Firecrawl stripped HTML length:", servicesHtml.length);
    if (servicesHtml.length < 500) {
      throw new Error("Could not extract content from this status page, even with JavaScript rendering.");
    }
  }

  progress("Sending HTML to AI for service extraction...");
  const pass1 = await callAI(
    apiKey,
    `You extract status page data from HTML. The page has a HIERARCHICAL structure with parent services that contain child services.

Return ONLY valid JSON with this structure:
{
  "name": "Page name/title",
  "services": [
    { "name": "Parent Service Name", "status": "operational|degraded|partial|major|maintenance", "group": null, "children": [
      { "name": "Child Service Name", "status": "operational|degraded|partial|major|maintenance" }
    ]},
    { "name": "Standalone Service", "status": "operational", "group": null, "children": [] }
  ]
}

CRITICAL RULES:
1. Look for COLLAPSIBLE SECTIONS, ACCORDION PANELS, or NESTED LISTS. Parent services contain child services within them.
2. If a service like "Integrations" contains sub-services like "JIRA", "Slack", "PagerDuty", then "Integrations" is a PARENT and those are its CHILDREN.
3. Parent services should have a "children" array with their nested sub-services.
4. Services with NO children should have an empty "children" array.
5. Do NOT use the "group" field — use "children" for hierarchy instead. Set "group" to null for all services.
6. Extract ALL services, including those inside collapsed/hidden sections.
7. Map statuses: green/up/operational -> "operational", yellow/degraded/slow -> "degraded", orange/partial -> "partial", red/down/major -> "major", blue/maintenance/scheduled -> "maintenance". If unsure, use "operational".
8. For the "name" field, remove trailing suffixes like "| Status", "Status", "- Status Page". Return just the clean company/product name.`,
    "Extract the status page name and ALL services (including nested/child services within parent categories) from this HTML:",
    servicesHtml
  );

  // Flatten hierarchical AI response into flat services with group field
  const flatServices: { name: string; status: string; group: string | null }[] = [];
  for (const s of (pass1.services || [])) {
    if (s.children && s.children.length > 0) {
      // This is a parent — don't add it as a service, use its name as group for children
      for (const child of s.children) {
        flatServices.push({ name: child.name, status: child.status, group: s.name });
      }
    } else {
      flatServices.push({ name: s.name, status: s.status, group: s.group || null });
    }
  }

  const totalChildren = flatServices.length;
  const totalParents = (pass1.services || []).filter((s: any) => s.children?.length > 0).length;
  progress(`AI found ${totalChildren} services under ${totalParents} parent groups`);

  if (totalChildren === 0) {
    return { name: pass1.name, services: [], incidents: [], start_date: null };
  }

  const sinceMatch = rawHtml.match(/since-value="(\d{4}-\d{2}-\d{2})/);
  let startDate: string | null = sinceMatch ? sinceMatch[1] : null;
  progress(startDate ? `Chart date anchor: ${startDate}` : "No chart date anchor found");

  const serviceNames = flatServices.map((s) => s.name);
  let uptimeMap: Map<string, { uptime_pct?: number | null; uptime_days?: (boolean | null)[] | null }> = new Map();
  try {
    progress("Using Firecrawl for uptime bar HTML...");
    const uptimeRawHtml = await fetchRenderedHTMLForUptime(url, progress);
    const uptimeHtml = stripForUptime(uptimeRawHtml);
    console.log("Pass 2 (uptime) stripped HTML length:", uptimeHtml.length);

    // Try to find date anchor in the rendered HTML
    const sinceMatch2 = uptimeRawHtml.match(/since-value="(\d{4}-\d{2}-\d{2})/);
    startDate = sinceMatch2 ? sinceMatch2[1] : startDate;

    if (startDate) {
      progress("Date anchor found — using deterministic SVG rect parsing...");
      uptimeMap = parseSvgDeterministic(uptimeHtml, serviceNames, progress);
    } else {
      uptimeMap = await extractUptimeSingle(apiKey, serviceNames, uptimeHtml, progress);
    }
  } catch (e: any) {
    progress(`Could not extract uptime data: ${e.message}. Proceeding without uptime bars.`);
    console.log("Uptime extraction error:", e.message);
  }

  const mergedServices: ExtractedService[] = flatServices.map((s) => {
    const uptime = uptimeMap.get(s.name);
    return {
      name: s.name,
      status: s.status as ServiceStatus,
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

  // Extract incidents via AI
  let incidents: ExtractedIncident[] = [];
  try {
    progress("Extracting incidents from page...");
    incidents = await extractIncidentsViaAI(apiKey, servicesHtml, url, progress);
    progress(`Found ${incidents.length} incidents`);
  } catch (e: any) {
    progress(`Could not extract incidents: ${e.message}`);
  }

  return { name: pass1.name, services: mergedServices, incidents, start_date: startDate };
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

          if (!result.services || result.services.length === 0) {
            progress("No services found. Aborting import.");
            sendEvent("error", { message: "No services found on the provided page. Import aborted." });
          } else {
            progress(`Analysis complete — found ${result.services.length} services`);
            sendEvent("result", { success: true, data: result });
          }
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
