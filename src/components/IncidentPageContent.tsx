import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, Zap, PenLine, ChevronDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBanner } from "@/components/StatusBanner";
import { IncidentTimeline } from "@/components/IncidentTimeline";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { statusConfig, type ServiceStatus } from "@/lib/statusData";
import type { Incident } from "@/lib/statusData";

interface AnalyzedService {
  name: string;
  status: ServiceStatus;
}

interface AnalyzedUpdate {
  status: "investigating" | "identified" | "monitoring" | "resolved";
  message: string;
  timestamp: string;
}

interface AnalyzedIncident {
  title: string;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  impact: ServiceStatus;
  services: AnalyzedService[];
  updates: AnalyzedUpdate[];
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getOverallStatus(services: AnalyzedService[]): ServiceStatus {
  if (services.some((s) => s.status === "major")) return "major";
  if (services.some((s) => s.status === "partial")) return "partial";
  if (services.some((s) => s.status === "degraded")) return "degraded";
  if (services.some((s) => s.status === "maintenance")) return "maintenance";
  return "operational";
}

function StatusDot({ status }: { status: ServiceStatus }) {
  const config = statusConfig[status] ?? statusConfig.operational;
  return (
    <span className="relative flex h-3 w-3">
      {status !== "operational" && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.dotClass} opacity-75`} />
      )}
      <span className={`relative inline-flex rounded-full h-3 w-3 ${config.dotClass}`} />
    </span>
  );
}

export function IncidentPageContent() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [text, setText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState<AnalyzedIncident | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setAnalyzing(true);
    setAnalyzed(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/analyze-incident`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ text: text.trim() }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(err.error || `Request failed (${response.status})`);
      }

      const result = await response.json();
      if (!result.success || !result.data) throw new Error("No data returned");

      const data = result.data as AnalyzedIncident & { organization?: string };
      setAnalyzed(data);

      // Auto-fill name/slug only if organization is mentioned
      const org = data.organization?.trim();
      if (org) {
        const pageName = `${org} Status`;
        setName(pageName);
        if (!slugManual) {
          const baseSlug = slugify(pageName);
          const uniqueSlug = await findUniqueSlug(baseSlug);
          setSlug(uniqueSlug);
        }
      } else {
        setName("");
        setSlug("");
      }

      toast({
        title: "Incident analyzed!",
        description: `Found ${data.services.length} affected services.`,
      });
    } catch (err: any) {
      toast({
        title: "Analysis failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
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

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManual) setSlug(slugify(val));
  };

  const handleCreate = async () => {
    if (!name.trim() || !slug.trim() || !analyzed) return;
    setCreating(true);

    try {
      // Create status page
      const { data: page, error: pageErr } = await supabase
        .from("status_pages")
        .insert({ name: name.trim(), slug: slug.trim() })
        .select("id")
        .single();
      if (pageErr) throw pageErr;

      // Create services
      if (analyzed.services.length > 0) {
        const serviceRows = analyzed.services.map((s, i) => ({
          name: s.name,
          status: s.status,
          status_page_id: page.id,
          display_order: i,
          uptime: s.status === "operational" ? 99.99 : s.status === "degraded" ? 99.5 : 99.0,
        }));
        const { error: sErr } = await supabase.from("services").insert(serviceRows);
        if (sErr) throw sErr;
      }

      // Create incident
      const now = new Date().toISOString();
      const incidentCreatedAt = analyzed.updates.length > 0
        ? analyzed.updates[analyzed.updates.length - 1].timestamp
        : now;

      const { data: createdInc, error: incErr } = await supabase
        .from("incidents")
        .insert({
          status_page_id: page.id,
          title: analyzed.title,
          status: analyzed.status,
          impact: analyzed.impact,
          created_at: incidentCreatedAt,
        })
        .select("id")
        .single();
      if (incErr) throw incErr;

      // Create incident updates
      if (analyzed.updates.length > 0) {
        const updateRows = analyzed.updates.map((u) => ({
          incident_id: createdInc.id,
          status: u.status,
          message: u.message,
          created_at: u.timestamp,
        }));
        const { error: uErr } = await supabase.from("incident_updates").insert(updateRows);
        if (uErr) console.error("Failed to insert incident updates:", uErr);
      }

      toast({ title: "Status page created!" });
      navigate(`/${slug}`);
    } catch (err: any) {
      toast({
        title: "Failed to create",
        description: err.message.includes("duplicate")
          ? "A page with that slug already exists."
          : err.message,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Input section */}
      <section className="border border-border rounded-xl bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
          <PenLine className="h-5 w-5" />
          Describe the Incident
        </h2>
        <Textarea
          placeholder={"Paste your incident status updates here, or describe what's happening...\n\nExample:\n\"Our API is experiencing elevated error rates. Database connections are timing out. The web dashboard is loading slowly. We identified the issue as a failed database migration and are rolling it back.\""}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-[160px] font-mono text-sm"
          disabled={analyzing}
        />
        <div className="flex items-center gap-3">
          <Button onClick={handleAnalyze} disabled={analyzing || !text.trim()}>
            {analyzing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Zap className="h-4 w-4 mr-1" />
            )}
            {analyzing ? "Analyzing..." : "Analyze Incident"}
          </Button>
          <p className="text-xs text-muted-foreground">
            AI will identify affected services and create a status page preview.
          </p>
        </div>
      </section>

      {/* Preview */}
      {analyzed && (
        <section className="border border-border rounded-xl bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-card-foreground">Preview</h2>

          <StatusBanner status={getOverallStatus(analyzed.services)} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="incident-name">Page Name</Label>
              <Input
                id="incident-name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="incident-slug">Slug</Label>
              <Input
                id="incident-slug"
                value={slug}
                onChange={(e) => {
                  setSlugManual(true);
                  setSlug(slugify(e.target.value));
                }}
              />
              <p className="text-xs text-muted-foreground">URL path: /{slug || "..."}</p>
            </div>
          </div>

          {/* Services */}
          {analyzed.services.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xl font-semibold text-foreground">Affected Services</h3>
              <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                {analyzed.services.map((service, i) => {
                  return (
                    <div key={i} className="flex items-center justify-between p-4 bg-card hover:bg-accent/50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
                        <StatusDot status={service.status} />
                        <input
                          type="text"
                          value={service.name}
                          onChange={(e) => {
                            setAnalyzed((prev) => {
                              if (!prev) return prev;
                              const updated = [...prev.services];
                              updated[i] = { ...updated[i], name: e.target.value };
                              return { ...prev, services: updated };
                            });
                          }}
                          className="font-medium text-card-foreground bg-transparent border-none outline-none focus:ring-0 w-full hover:bg-accent focus:bg-accent rounded px-1 -mx-1 transition-colors"
                        />
                      </div>
                      <Select
                        value={service.status}
                        onValueChange={(val) => {
                          setAnalyzed((prev) => {
                            if (!prev) return prev;
                            const updated = [...prev.services];
                            updated[i] = { ...updated[i], status: val as ServiceStatus };
                            return { ...prev, services: updated };
                          });
                        }}
                      >
                        <SelectTrigger className="w-[200px] h-9 text-sm border-none bg-transparent hover:bg-accent/50 focus:ring-0 focus:ring-offset-0">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${statusConfig[service.status]?.colorClass}`}>
                              {statusConfig[service.status]?.label}
                            </span>
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(statusConfig) as ServiceStatus[]).map((s) => (
                            <SelectItem key={s} value={s}>
                              <div className="flex items-center gap-2">
                                <span className={`font-medium ${statusConfig[s].colorClass}`}>{statusConfig[s].label}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Incident timeline */}
          {analyzed.updates.length > 0 && (
            <IncidentTimeline
              incidents={[
                {
                  id: "preview",
                  title: analyzed.title,
                  status: analyzed.status,
                  impact: analyzed.impact,
                  createdAt: analyzed.updates[analyzed.updates.length - 1]?.timestamp || new Date().toISOString(),
                  updates: analyzed.updates.map((u) => ({
                    status: u.status,
                    message: u.message,
                    timestamp: u.timestamp,
                  })),
                },
              ]}
            />
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={handleCreate}
              disabled={creating || !name.trim() || !slug.trim()}
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Plus className="h-4 w-4 mr-1" />
              )}
              Create Status Page
            </Button>
            {!creating && (!name.trim() || !slug.trim()) && (
              <p className="text-sm text-muted-foreground">
                {!name.trim() && !slug.trim()
                  ? "Enter a page name and slug above to continue."
                  : !name.trim()
                    ? "Enter a page name above to continue."
                    : "Enter a slug above to continue."}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
