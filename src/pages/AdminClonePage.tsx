import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, ArrowLeft, Loader2, Globe, Plus, Check, ChevronDown } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { statusConfig, type ServiceStatus } from "@/lib/statusData";
import { UptimeBar } from "@/components/UptimeBar";

interface ExtractedService {
  name: string;
  status: ServiceStatus;
  group?: string | null;
  uptime_pct?: number | null;
  uptime_days?: (boolean | null)[] | null;
}

interface ExtractedData {
  name: string;
  services: ExtractedService[];
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getGroupStatus(services: ExtractedService[]): ServiceStatus {
  if (services.some((s) => s.status === "major")) return "major";
  if (services.some((s) => s.status === "partial")) return "partial";
  if (services.some((s) => s.status === "degraded")) return "degraded";
  if (services.some((s) => s.status === "maintenance")) return "maintenance";
  return "operational";
}

function ExtractedStatusDot({ status }: { status: ServiceStatus }) {
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

function ExtractedServiceItem({ service }: { service: ExtractedService }) {
  const [expanded, setExpanded] = useState(false);
  const config = statusConfig[service.status] ?? statusConfig.operational;

  return (
    <div className="bg-card hover:bg-accent/50 transition-colors">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <ExtractedStatusDot status={service.status} />
          <span className="font-medium text-card-foreground truncate">{service.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${config.colorClass}`}>{config.label}</span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 ml-6">
            <div className="flex-1 min-w-0">
              <UptimeBar days={
                service.uptime_days && service.uptime_days.length > 0
                  ? service.uptime_days
                  : Array(90).fill(null)
              } />
            </div>
            {service.uptime_pct != null && (
              <span className="font-mono text-sm text-muted-foreground shrink-0">
                {service.uptime_pct}%
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ExtractedServiceGroup({ groupName, services }: { groupName: string; services: ExtractedService[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const groupStatus = getGroupStatus(services);
  const config = statusConfig[groupStatus] ?? statusConfig.operational;

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between mb-2 group cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <ExtractedStatusDot status={groupStatus} />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {groupName}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${config.colorClass}`}>{config.label}</span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        </div>
      </button>
      {!collapsed && (
        <div className="space-y-0 border border-border rounded-lg overflow-hidden">
          {services.map((s, i) => (
            <div key={i} className={i !== services.length - 1 ? "border-b border-border" : ""}>
              <ExtractedServiceItem service={s} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExtractedServicesList({ services }: { services: ExtractedService[] }) {
  // Build ordered sections preserving source order: groups stay together, ungrouped rendered inline
  type Section = { type: "group"; name: string; services: ExtractedService[] } | { type: "ungrouped"; service: ExtractedService };
  const sections: Section[] = [];
  const groupMap = new Map<string, ExtractedService[]>();

  for (const s of services) {
    if (s.group) {
      if (!groupMap.has(s.group)) {
        const arr: ExtractedService[] = [];
        groupMap.set(s.group, arr);
        sections.push({ type: "group", name: s.group, services: arr });
      }
      groupMap.get(s.group)!.push(s);
    } else {
      sections.push({ type: "ungrouped", service: s });
    }
  }

  return (
    <div className="space-y-6">
      <Label className="text-sm">Services ({services.length})</Label>
      {sections.map((section, i) => {
        if (section.type === "group") {
          return <ExtractedServiceGroup key={`group-${section.name}`} groupName={section.name} services={section.services} />;
        }
        
        return (
          <div key={`svc-${i}`} className="space-y-0 border border-border rounded-lg overflow-hidden">
            <ExtractedServiceItem service={section.service} />
          </div>
        );
      })}
    </div>
  );
}

const AdminClonePage = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleFetch = async () => {
    if (!url.trim()) return;
    setFetching(true);
    setExtracted(null);

    try {
      const { data, error } = await supabase.functions.invoke("clone-status-page", {
        body: { url: url.trim() },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to extract data");

      const result = data.data as ExtractedData;
      setExtracted(result);
      setName(result.name || "");
      if (!slugManual) {
        const baseSlug = slugify(result.name || "");
        const uniqueSlug = await findUniqueSlug(baseSlug);
        setSlug(uniqueSlug);
      }
      toast({ title: "Page analyzed!", description: `Found ${result.services?.length ?? 0} services.` });
    } catch (err: any) {
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

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManual) setSlug(slugify(val));
  };

  const handleCreate = async () => {
    if (!name.trim() || !slug.trim() || !extracted) return;
    setCreating(true);

    try {
      // Create the status page
      const { data: page, error: pageErr } = await supabase
        .from("status_pages")
        .insert({ name: name.trim(), slug: slug.trim() })
        .select("id")
        .single();
      if (pageErr) throw pageErr;

      // Create services
      if (extracted.services?.length > 0) {
        const services = extracted.services.map((s, i) => ({
          name: s.name,
          status: s.status,
          group_name: s.group || null,
          status_page_id: page.id,
          display_order: i,
          uptime: s.uptime_pct ?? 100,
        }));
        const { data: createdServices, error: sErr } = await supabase
          .from("services")
          .insert(services)
          .select("id");
        if (sErr) throw sErr;

        // Insert uptime_days for services that have daily data
        const uptimeRows: { service_id: string; day: string; up: boolean }[] = [];
        extracted.services.forEach((s, i) => {
          if (s.uptime_days && s.uptime_days.length > 0 && createdServices?.[i]) {
            const serviceId = createdServices[i].id;
            const today = new Date();
            s.uptime_days.forEach((up, dayIdx) => {
              if (up === null) return; // Skip days with no data
              const date = new Date(today);
              date.setDate(date.getDate() - (s.uptime_days!.length - 1 - dayIdx));
              uptimeRows.push({
                service_id: serviceId,
                day: date.toISOString().split("T")[0],
                up,
              });
            });
          }
        });
        if (uptimeRows.length > 0) {
          const { error: uErr } = await supabase.from("uptime_days").insert(uptimeRows);
          if (uErr) console.error("Failed to insert uptime days:", uErr);
        }
      }

      toast({ title: "Status page cloned!" });
      navigate("/admin");
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
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center gap-3">
          <Activity className="h-7 w-7 text-primary" />
          <h1 className="text-xl font-bold text-foreground tracking-tight">Clone Status Page</h1>
          <Link to="/admin" className="ml-auto">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* URL input */}
        <section className="border border-border rounded-xl bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Enter Status Page URL
          </h2>
          <div className="flex gap-3">
            <Input
              placeholder="https://status.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
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
        </section>

        {/* Preview extracted data */}
        {extracted && (
          <section className="border border-border rounded-xl bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-card-foreground">Preview</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="clone-name">Name</Label>
                <Input
                  id="clone-name"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clone-slug">Slug</Label>
                <Input
                  id="clone-slug"
                  value={slug}
                  onChange={(e) => {
                    setSlugManual(true);
                    setSlug(slugify(e.target.value));
                  }}
                />
                <p className="text-xs text-muted-foreground">URL path: /{slug || "..."}</p>
              </div>
            </div>

            {extracted.services?.length > 0 && (
              <ExtractedServicesList services={extracted.services} />
            )}

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
          </section>
        )}
      </main>
    </div>
  );
};

export default AdminClonePage;
