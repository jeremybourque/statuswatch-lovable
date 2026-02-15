import { useStatusPages } from "@/hooks/useStatusData";
import { statusConfig } from "@/lib/statusData";
import { Activity, Loader2, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import type { ServiceStatus } from "@/lib/statusData";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function usePageServices(pageId: string) {
  return useQuery({
    queryKey: ["page-services", pageId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("name, status")
        .eq("status_page_id", pageId)
        .order("display_order");
      if (error) throw error;
      return (data ?? []).map((s) => ({ name: s.name, status: s.status as ServiceStatus }));
    },
  });
}

function ServiceDots({ services }: { services: { name: string; status: ServiceStatus }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 justify-center">
      {services.map((s, i) => {
        const config = statusConfig[s.status];
        return (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <div className={`w-3 h-3 rounded-sm ${config.bgClass} hover:opacity-80 transition-opacity cursor-default`} />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {s.name} — {config.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function StatusPageCard({ page }: { page: { id: string; name: string; slug: string; description: string | null } }) {
  const { data: services = [] } = usePageServices(page.id);
  const statuses = services.map((s) => s.status);
  let overall: ServiceStatus = "operational";
  if (statuses.some((s) => s === "major")) overall = "major";
  else if (statuses.some((s) => s === "partial")) overall = "partial";
  else if (statuses.some((s) => s === "degraded")) overall = "degraded";
  else if (statuses.some((s) => s === "maintenance")) overall = "maintenance";
  const config = statusConfig[overall];

  return (
    <Link
      to={`/${page.slug}`}
      className="group relative flex flex-col justify-between aspect-square border border-border rounded-xl bg-card p-6 hover:border-primary/30 hover:shadow-lg transition-all duration-200 overflow-hidden"
    >
      <div className={`absolute top-0 left-0 right-0 h-1 ${config.bgClass}`} />

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {overall !== "operational" && (
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.dotClass} opacity-75`} />
            )}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${config.dotClass}`} />
          </span>
          <span className={`text-xs font-semibold uppercase tracking-wider ${config.colorClass}`}>
            {config.label}
          </span>
        </div>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      <div className="flex items-center justify-center py-2">
        <ServiceDots services={services} />
      </div>

      <div>
        <h2 className="text-lg font-bold text-card-foreground">{page.name}</h2>
        {page.description && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{page.description}</p>
        )}
        <p className="text-xs text-muted-foreground mt-3 font-mono">
          {services.length} service{services.length !== 1 ? "s" : ""} monitored
        </p>
      </div>
    </Link>
  );
}

const StatusPagesIndex = () => {
  const { data: pages = [], isLoading } = useStatusPages();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center gap-3">
          <Activity className="h-7 w-7 text-primary" />
          <h1 className="text-xl font-bold text-foreground tracking-tight">StatusWatch</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <h2 className="text-xl font-semibold text-foreground">Status Pages</h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : pages.length === 0 ? (
          <p className="text-muted-foreground text-sm">No status pages configured.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pages.map((page) => (
              <StatusPageCard key={page.id} page={page} />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-border mt-16">
        <div className="max-w-4xl mx-auto px-4 py-6 text-sm text-muted-foreground">
          <span>© 2026 StatusWatch</span>
        </div>
      </footer>
    </div>
  );
};

export default StatusPagesIndex;
