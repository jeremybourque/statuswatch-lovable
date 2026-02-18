import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Globe, ChevronDown, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { type ServiceStatus } from "@/lib/statusData";
import { StatusPagePreview, type PreviewService, type PreviewIncident } from "@/components/StatusPagePreview";

interface ExtractedService {
  name: string;
  status: ServiceStatus;
  group?: string | null;
  uptime_pct?: number | null;
  uptime_days?: (boolean | null)[] | null;
}

interface ExtractedIncident {
  title: string;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  impact: ServiceStatus;
  created_at: string;
  updates: { status: string; message: string; timestamp: string }[];
}

interface ExtractedData {
  name: string;
  services: ExtractedService[];
  incidents: ExtractedIncident[];
  start_date: string | null;
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface LogEntry {
  message: string;
  status: "pending" | "done" | "error";
  timestamp: Date;
}

function ActivityLog({ entries, isComplete }: { entries: LogEntry[]; isComplete: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [entries.length]);

  if (entries.length === 0) return null;

  return (
    <div className="border border-border rounded-lg bg-muted/30 overflow-hidden">
      <div className="px-4 py-2 border-b border-border bg-muted/50">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {isComplete ? "Completed" : "Processing..."}
        </span>
      </div>
      <div className="max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent">
        <div className="p-3 space-y-1.5">
          {entries.map((entry, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              {entry.status === "done" && <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />}
              {entry.status === "pending" && <Loader2 className="h-4 w-4 text-muted-foreground animate-spin mt-0.5 shrink-0" />}
              {entry.status === "error" && <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />}
              <span className={entry.status === "error" ? "text-destructive" : entry.status === "pending" ? "text-muted-foreground" : "text-foreground"}>
                {entry.message}
              </span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

export function ClonePageContent() {
  const { toast } = useToast();

  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [previewName, setPreviewName] = useState("");
  const [previewSlug, setPreviewSlug] = useState("");
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [urlCardExpanded, setUrlCardExpanded] = useState(false);

  const addLog = (message: string, status: LogEntry["status"] = "pending") => {
    setLogEntries((prev) => [...prev, { message, status, timestamp: new Date() }]);
  };

  const completeLastLog = (status: "done" | "error" = "done") => {
    setLogEntries((prev) => {
      const updated = [...prev];
      const lastPending = [...updated].reverse().findIndex((e) => e.status === "pending");
      if (lastPending >= 0) {
        updated[updated.length - 1 - lastPending] = { ...updated[updated.length - 1 - lastPending], status };
      }
      return updated;
    });
  };

  const handleFetch = async () => {
    if (!url.trim()) return;
    setFetching(true);
    setExtracted(null);
    setLogEntries([]);

    addLog("Starting analysis...");

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/clone-status-page`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: ExtractedData | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 2);

          if (!chunk.startsWith("data: ")) continue;
          const jsonStr = chunk.slice(6);

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === "progress") {
              completeLastLog("done");
              addLog(event.message);
            } else if (event.type === "result" && event.success) {
              result = event.data as ExtractedData;
            } else if (event.type === "error") {
              throw new Error(event.message);
            }
          } catch (parseErr: any) {
            if (parseErr.message && !parseErr.message.includes("JSON")) {
              throw parseErr;
            }
          }
        }
      }

      completeLastLog("done");

      if (!result) throw new Error("No result received from analysis");

      setExtracted(result);
      const baseSlug = slugify(result.name || "");
      const uniqueSlug = await findUniqueSlug(baseSlug);
      setPreviewName(result.name || "");
      setPreviewSlug(uniqueSlug);
      const incidentCount = result.incidents?.length ?? 0;
      toast({ title: "Page analyzed!", description: `Found ${result.services?.length ?? 0} services and ${incidentCount} incidents.` });
    } catch (err: any) {
      setLogEntries((prev) => prev.map((e) => (e.status === "pending" ? { ...e, status: "done" as const } : e)));
      addLog(err.message || "Analysis failed", "error");
      toast({ title: "Failed to analyze page", description: err.message, variant: "destructive" });
    } finally {
      setFetching(false);
    }
  };

  async function findUniqueSlug(base: string): Promise<string> {
    let candidate = base;
    let suffix = 1;
    while (true) {
      const { data } = await supabase
        .from("status_pages")
        .select("id")
        .eq("slug", candidate)
        .maybeSingle();
      if (!data) return candidate;
      candidate = `${base}-${suffix}`;
      suffix++;
    }
  }

  // Convert extracted data to preview format
  const previewServices: PreviewService[] = extracted?.services?.map((s) => ({
    name: s.name,
    status: s.status,
  })) ?? [];

  const previewIncidents: PreviewIncident[] = extracted?.incidents?.map((inc) => ({
    title: inc.title,
    status: inc.status as PreviewIncident["status"],
    impact: inc.impact,
    services: [],
    updates: inc.updates.map((u) => ({
      status: u.status as PreviewIncident["status"],
      message: u.message,
      timestamp: u.timestamp,
    })),
  })) ?? [];

  return (
    <div className="space-y-6">
      {/* URL input */}
      <section className="border border-border rounded-xl bg-card p-6 space-y-4">
        {extracted && !fetching ? (
          <>
            <button
              onClick={() => setUrlCardExpanded(!urlCardExpanded)}
              className="w-full flex items-center justify-between cursor-pointer"
            >
              <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
                <Globe className="h-5 w-5" />
                <span className="truncate">{urlCardExpanded ? "Enter Status Page URL" : url}</span>
              </h2>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${urlCardExpanded ? "" : "-rotate-90"}`} />
            </button>
            {urlCardExpanded && (
              <>
                <div className="flex gap-3">
                  <Input
                    placeholder="https://status.example.com"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && url.trim() && !fetching) handleFetch(); }}
                    className="flex-1"
                  />
                  <Button onClick={handleFetch} disabled={fetching || !url.trim()}>
                    <Globe className="h-4 w-4 mr-1" />
                    Analyze
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Paste a public status page URL to extract its services and create a copy.
                </p>
                {logEntries.length > 0 && <ActivityLog entries={logEntries} isComplete={!fetching} />}
              </>
            )}
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Enter Status Page URL
            </h2>
            <div className="flex gap-3">
              <Input
                placeholder="https://status.example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && url.trim() && !fetching) handleFetch(); }}
                className="flex-1"
              />
              <Button onClick={handleFetch} disabled={fetching || !url.trim()}>
                {fetching ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Globe className="h-4 w-4 mr-1" />}
                {fetching ? "Analyzing..." : "Analyze"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste a public status page URL to extract its services and create a copy.
            </p>
            {logEntries.length > 0 && <ActivityLog entries={logEntries} isComplete={!fetching} />}
          </>
        )}
      </section>

      {extracted && (
        <StatusPagePreview
          initialServices={previewServices}
          initialIncidents={previewIncidents}
          initialName={previewName}
          initialSlug={previewSlug}
          navigateTo="/"
        />
      )}
    </div>
  );
}
