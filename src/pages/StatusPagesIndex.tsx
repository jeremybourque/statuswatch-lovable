import { useStatusPages } from "@/hooks/useStatusData";
import { statusConfig } from "@/lib/statusData";
import { Activity, Loader2, ArrowUpRight, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import type { ServiceStatus } from "@/lib/statusData";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

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
  const columns = Math.min(services.length, 12);
  return (
    <div
      className="grid gap-1.5 justify-center"
      style={{ gridTemplateColumns: `repeat(${columns}, min-content)` }}
    >
      {services.map((s, i) => {
        const config = statusConfig[s.status];
        const isOperational = s.status === "operational";
        return (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              {isOperational ? (
                <div
                  className={`w-3 h-3 rounded-sm ${config.bgClass} hover:opacity-80 transition-opacity cursor-default`}
                />
              ) : (
                <svg
                  width="13"
                  height="13"
                  viewBox="-2 -2 16 16"
                  className="hover:opacity-80 transition-opacity cursor-default"
                >
                  <path
                    d="M6 0.5 L11.5 11 L0.5 11 Z"
                    fill="currentColor"
                    stroke="currentColor"
                    strokeWidth="5"
                    strokeLinejoin="round"
                    className={config.colorClass}
                  />
                </svg>
              )}
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

const CARD_HEIGHTS = [120, 252, 384] as const;

function getCardHeight(serviceCount: number): number {
  if (serviceCount <= 24) return 120;
  if (serviceCount <= 96) return 252;
  return 384;
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
  const cardHeight = getCardHeight(services.length);

  return (
    <Link
      to={`/${page.slug}`}
      className="group relative flex flex-col border border-border rounded-xl bg-card p-4 hover:border-primary/30 hover:shadow-lg transition-all duration-200 overflow-hidden break-inside-avoid mb-3"
      style={{ height: `${cardHeight}px` }}
    >
      <div className={`absolute top-0 left-0 right-0 h-1 ${config.bgClass}`} />

      <div className="flex items-start justify-between mb-3">
        <h2 className="text-sm font-bold text-card-foreground leading-tight">{page.name}</h2>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </div>

      <div className="flex-1 flex items-center justify-center py-3">
        <ServiceDots services={services} />
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2 shrink-0">
            {overall !== "operational" && (
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.dotClass} opacity-75`}
              />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${config.dotClass}`} />
          </span>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${config.colorClass}`}>
            {config.label}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          {services.length} service{services.length !== 1 ? "s" : ""}
        </span>
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
          <Link to="/admin" className="ml-auto">
            <Button variant="ghost" size="sm">
              <Settings className="h-4 w-4 mr-1" />
              Admin
            </Button>
          </Link>
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
          <div className="gap-3" style={{ columns: "240px" }}>
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
