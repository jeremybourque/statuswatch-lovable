import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, Trash2, Activity } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBanner } from "@/components/StatusBanner";
import { UptimeBar } from "@/components/UptimeBar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { statusConfig, type ServiceStatus } from "@/lib/statusData";
import { format, parseISO } from "date-fns";

const UPTIME_DAYS_COUNT = 90;

export interface PreviewService {
  name: string;
  status: ServiceStatus;
  uptimeDays?: (boolean | null)[];
  uptime?: number;
}

export interface PreviewUpdate {
  status: "investigating" | "identified" | "monitoring" | "maintenance" | "resolved";
  message: string;
  timestamp: string;
}

export interface PreviewIncident {
  title: string;
  status: "investigating" | "identified" | "monitoring" | "maintenance" | "resolved";
  impact: ServiceStatus;
  services: PreviewService[];
  updates: PreviewUpdate[];
}

interface StatusPagePreviewProps {
  initialServices: PreviewService[];
  initialIncidents: PreviewIncident[];
  initialName?: string;
  initialSlug?: string;
  initialLogoUrl?: string | null;
  navigateTo?: string;
}

const updateStatusColors: Record<string, string> = {
  investigating: "text-status-major",
  identified: "text-status-partial",
  monitoring: "text-status-degraded",
  maintenance: "text-status-maintenance",
  resolved: "text-status-operational",
};

const updateStatusBg: Record<string, string> = {
  investigating: "bg-status-major",
  identified: "bg-status-partial",
  monitoring: "bg-status-degraded",
  maintenance: "bg-status-maintenance",
  resolved: "bg-status-operational",
};

const updateStatuses = ["investigating", "identified", "monitoring", "maintenance", "resolved"] as const;

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getOverallStatus(services: PreviewService[]): ServiceStatus {
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

export function StatusPagePreview({
  initialServices,
  initialIncidents,
  initialName = "",
  initialSlug = "",
  initialLogoUrl = null,
  navigateTo = "/",
}: StatusPagePreviewProps) {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [services, setServices] = useState<PreviewService[]>(initialServices);
  const [incidents, setIncidents] = useState<PreviewIncident[]>(initialIncidents);
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [slugManual, setSlugManual] = useState(false);
  const [creating, setCreating] = useState(false);

  // Sync when initial data changes (e.g. after re-analyze)
  useEffect(() => {
    setServices(initialServices);
  }, [initialServices]);

  useEffect(() => {
    setIncidents(initialIncidents);
  }, [initialIncidents]);

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  useEffect(() => {
    if (!slugManual) setSlug(initialSlug);
  }, [initialSlug, slugManual]);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManual) setSlug(slugify(val));
  };

  const updateIncident = (index: number, updater: (prev: PreviewIncident) => PreviewIncident) => {
    setIncidents((prev) => {
      const updated = [...prev];
      updated[index] = updater(updated[index]);
      return updated;
    });
  };

  const removeIncident = (index: number) => {
    setIncidents((prev) => prev.filter((_, i) => i !== index));
  };

  const addBlankIncident = () => {
    const blank: PreviewIncident = {
      title: "New Incident",
      status: "investigating",
      impact: "major",
      services: [],
      updates: [],
    };
    setIncidents((prev) => [...prev, blank]);
  };

  const handleCreate = async () => {
    if (!name.trim() || !slug.trim()) return;
    setCreating(true);

    try {
      const { data: page, error: pageErr } = await supabase
        .from("status_pages")
        .insert({ name: name.trim(), slug: slug.trim() })
        .select("id")
        .single();
      if (pageErr) throw pageErr;

      // Collect all services (top-level + from incidents)
      const allServices = [
        ...services,
        ...incidents.flatMap((inc) => inc.services),
      ];
      if (allServices.length > 0) {
        const serviceRows = allServices.map((s, i) => ({
          name: s.name,
          status: s.status,
          status_page_id: page.id,
          display_order: i,
          uptime: s.uptime ?? (s.status === "operational" ? 99.99 : s.status === "degraded" ? 99.5 : 99.0),
        }));
        const { data: createdServices, error: sErr } = await supabase
          .from("services")
          .insert(serviceRows)
          .select("id");
        if (sErr) throw sErr;

        // Save uptime_days for each service
        const uptimeRows: { service_id: string; day: string; up: boolean }[] = [];
        if (createdServices) {
          allServices.forEach((s, i) => {
            const serviceId = createdServices[i]?.id;
            if (!serviceId || !s.uptimeDays) return;
            const today = new Date();
            const days = s.uptimeDays;
            // uptimeDays is ordered oldest→newest, padded to 90 days
            days.forEach((up, dayIdx) => {
              if (up === null || up === undefined) return;
              const daysAgo = days.length - 1 - dayIdx;
              const d = new Date(today);
              d.setDate(d.getDate() - daysAgo);
              const dayStr = d.toISOString().slice(0, 10);
              uptimeRows.push({ service_id: serviceId, day: dayStr, up });
            });
          });
        }
        if (uptimeRows.length > 0) {
          const { error: udErr } = await supabase.from("uptime_days").insert(uptimeRows);
          if (udErr) console.error("Failed to insert uptime_days:", udErr);
        }
      }

      for (const inc of incidents) {
        const now = new Date().toISOString();
        const incidentCreatedAt = inc.updates.length > 0
          ? inc.updates[inc.updates.length - 1].timestamp
          : now;

        const { data: createdInc, error: incErr } = await supabase
          .from("incidents")
          .insert({
            status_page_id: page.id,
            title: inc.title,
            status: inc.status,
            impact: inc.impact,
            created_at: incidentCreatedAt,
          })
          .select("id")
          .single();
        if (incErr) throw incErr;

        if (inc.updates.length > 0) {
          const updateRows = inc.updates.map((u) => ({
            incident_id: createdInc.id,
            status: u.status,
            message: u.message,
            created_at: u.timestamp,
          }));
          const { error: uErr } = await supabase.from("incident_updates").insert(updateRows);
          if (uErr) console.error("Failed to insert incident updates:", uErr);
        }
      }

      toast({ title: "Status page created!" });
      navigate(navigateTo);
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
    <section className="border border-border rounded-xl bg-card p-6 space-y-4">
      <div className="flex items-center gap-3">
        {initialLogoUrl ? (
          <img src={initialLogoUrl} alt="" className="h-8 w-8 rounded object-contain shrink-0" />
        ) : (
          <Activity className="h-8 w-8 text-primary shrink-0" />
        )}
        <input
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Page Name"
          className="text-2xl font-bold text-card-foreground bg-transparent border-none outline-none focus:ring-0 flex-1 min-w-0 hover:bg-accent focus:bg-accent rounded px-1 -mx-1 transition-colors"
        />
        <div className="flex items-center gap-0 shrink-0">
          <span className="text-sm text-muted-foreground">/</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlugManual(true);
              setSlug(slugify(e.target.value));
            }}
            placeholder="slug"
            className="font-mono text-sm text-muted-foreground bg-transparent border-none outline-none focus:ring-0 hover:bg-accent focus:bg-accent rounded px-1 transition-colors w-40"
          />
        </div>
      </div>

      <StatusBanner status={getOverallStatus(services)} />

      {/* Services */}
      <div className="space-y-3">
        <h3 className="text-xl font-semibold text-foreground">Services</h3>
        {services.length > 0 && (
          <div className="border border-border rounded-lg divide-y divide-border">
            {services.map((service, i) => (
              <div key={i} className="p-4 bg-card hover:bg-accent/50 transition-colors space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
                    <StatusDot status={service.status} />
                    <input
                      type="text"
                      value={service.name}
                      onChange={(e) => {
                        setServices((prev) => {
                          const updated = [...prev];
                          updated[i] = { ...updated[i], name: e.target.value };
                          return updated;
                        });
                      }}
                      className="font-medium text-card-foreground bg-transparent border-none outline-none focus:ring-0 w-full hover:bg-accent focus:bg-accent rounded px-1 -mx-1 transition-colors"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Select
                      value={service.status}
                      onValueChange={(val) => {
                        setServices((prev) => {
                          const updated = [...prev];
                          updated[i] = { ...updated[i], status: val as ServiceStatus };
                          return updated;
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
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => {
                        setServices((prev) => prev.filter((_, idx) => idx !== i));
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-6">
                  <TooltipProvider>
                    <div className="flex-1 min-w-0">
                      <UptimeBar days={(() => {
                        const raw = service.uptimeDays ?? [];
                        if (raw.length >= UPTIME_DAYS_COUNT) return raw.slice(-UPTIME_DAYS_COUNT);
                        return [...Array(UPTIME_DAYS_COUNT - raw.length).fill(null), ...raw];
                      })()} />
                    </div>
                  </TooltipProvider>
                  <span className="text-xs font-medium font-mono text-muted-foreground shrink-0 w-16 text-right">
                    {(service.uptime ?? 100).toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setServices((prev) => [...prev, { name: "New Service", status: "operational" }]);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Service
        </Button>
      </div>

      {/* Incidents */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Incidents</h2>
        {incidents.map((incident, incIndex) => (
          <div key={incIndex} className="border border-border rounded-lg bg-card overflow-hidden">
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className={`w-1.5 h-8 rounded-full ${updateStatusBg[incident.status]}`} />
                <input
                  type="text"
                  value={incident.title}
                  onFocus={(e) => { const el = e.target; if (el.value === "New Incident") requestAnimationFrame(() => el.select()); }}
                  onChange={(e) => updateIncident(incIndex, (prev) => ({ ...prev, title: e.target.value }))}
                  className="font-semibold text-card-foreground bg-transparent border-none outline-none focus:ring-0 w-full hover:bg-accent focus:bg-accent rounded px-1 -mx-1 transition-colors"
                />
                {incidents.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => removeIncident(incIndex)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-4 ml-5">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Status:</Label>
                  <span className={`text-xs font-medium capitalize ${updateStatusColors[incident.status]}`}>{incident.status}</span>
                </div>
              </div>
            </div>

            <div className="px-4 pb-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  updateIncident(incIndex, (prev) => {
                    const latestStatus = prev.updates.length > 0 ? prev.updates[0].status : "investigating";
                    const newUpdate: PreviewUpdate = {
                      status: latestStatus,
                      message: "New update...",
                      timestamp: new Date().toISOString(),
                    };
                    const updates = [newUpdate, ...prev.updates];
                    return { ...prev, updates, status: newUpdate.status };
                  });
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Update
              </Button>
            </div>

            {incident.updates.length > 0 && (
              <div className="px-4 pb-4">
                <div className="ml-5 border-l-2 border-border pl-6 space-y-4">
                  {incident.updates.map((update, i) => (
                    <div key={i} className="relative">
                      <div className="absolute -left-[31px] top-1 w-3 h-3 rounded-full bg-border border-2 border-card" />
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Select
                              value={update.status}
                              onValueChange={(val) => {
                                updateIncident(incIndex, (prev) => {
                                  const updates = [...prev.updates];
                                  updates[i] = { ...updates[i], status: val as PreviewUpdate["status"] };
                                  const newStatus = i === 0 ? val as PreviewIncident["status"] : prev.status;
                                  return { ...prev, updates, status: newStatus };
                                });
                              }}
                            >
                              <SelectTrigger className="h-6 text-sm border-none bg-transparent hover:bg-accent/50 focus:ring-0 focus:ring-offset-0 w-auto gap-1 px-1">
                                <span className={`font-semibold capitalize ${updateStatusColors[update.status]}`}>
                                  {update.status}
                                </span>
                              </SelectTrigger>
                              <SelectContent>
                                {updateStatuses.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    <span className={`font-medium capitalize ${updateStatusColors[s]}`}>{s}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <span className="text-sm text-muted-foreground">—</span>
                            <input
                              type="datetime-local"
                              value={(() => { try { return format(parseISO(update.timestamp), "yyyy-MM-dd'T'HH:mm"); } catch { return ""; } })()}
                              onChange={(e) => {
                                updateIncident(incIndex, (prev) => {
                                  const updates = [...prev.updates];
                                  updates[i] = { ...updates[i], timestamp: new Date(e.target.value).toISOString() };
                                  return { ...prev, updates };
                                });
                              }}
                              className="text-sm text-muted-foreground bg-transparent border-none outline-none focus:ring-0 hover:bg-accent focus:bg-accent rounded px-1 transition-colors"
                            />
                          </div>
                          <textarea
                            value={update.message}
                            onFocus={(e) => { const el = e.target; if (el.value === "New update...") requestAnimationFrame(() => el.select()); }}
                            onChange={(e) => {
                              updateIncident(incIndex, (prev) => {
                                const updates = [...prev.updates];
                                updates[i] = { ...updates[i], message: e.target.value };
                                return { ...prev, updates };
                              });
                            }}
                            className="text-sm text-card-foreground mt-1 leading-relaxed w-full bg-transparent border-none outline-none focus:ring-0 hover:bg-accent focus:bg-accent rounded px-1 -mx-1 transition-colors resize-none"
                            rows={2}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0 mr-6"
                          onClick={() => {
                            updateIncident(incIndex, (prev) => {
                              const updates = prev.updates.filter((_, idx) => idx !== i);
                              const newStatus = updates.length > 0 ? updates[0].status : prev.status;
                              return { ...prev, updates, status: newStatus };
                            });
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={addBlankIncident}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Incident
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        {!creating && (!name.trim() || !slug.trim()) && (
          <p className="text-sm text-muted-foreground">
            {!name.trim() && !slug.trim()
              ? "Enter a page name and slug above to continue."
              : !name.trim()
                ? "Enter a page name above to continue."
                : "Enter a slug above to continue."}
          </p>
        )}
        <Button
          onClick={handleCreate}
          disabled={creating || !name.trim() || !slug.trim()}
          className="ml-auto shrink-0"
        >
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <Plus className="h-4 w-4 mr-1" />
          )}
          Create Status Page
        </Button>
      </div>
    </section>
  );
}
