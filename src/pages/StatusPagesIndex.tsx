import { useStatusPages } from "@/hooks/useStatusData";
import { statusConfig } from "@/lib/statusData";
import { Activity, Loader2, ArrowUpRight, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import type { ServiceStatus } from "@/lib/statusData";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useRef, useState, useEffect, useMemo, type ReactNode } from "react";

function useColumnCount(containerRef: React.RefObject<HTMLElement | null>, columnWidth: number, gap: number) {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setCols(Math.max(1, Math.floor((w + gap) / (columnWidth + gap))));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, columnWidth, gap]);
  return cols;
}

/** Distribute items into `cols` buckets to minimize the max bucket weight (service count as proxy for height). */
function balanceColumns<T>(items: T[], cols: number, weight: (item: T) => number): T[][] {
  const buckets: T[][] = Array.from({ length: cols }, () => []);
  const heights = new Array(cols).fill(0);

  // Sort heaviest first for better greedy packing
  const sorted = [...items].sort((a, b) => weight(b) - weight(a));
  for (const item of sorted) {
    const min = Math.min(...heights);
    // Pick the last column with the minimum height (fills right-to-left)
    const shortest = heights.lastIndexOf(min);
    buckets[shortest].push(item);
    heights[shortest] += weight(item);
  }
  return buckets;
}

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
    <div className="grid gap-1.5 justify-center" style={{ gridTemplateColumns: `repeat(${columns}, min-content)` }}>
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
      className="group relative flex flex-col border border-border rounded-xl bg-card p-4 hover:border-primary/30 hover:shadow-lg transition-all duration-200 overflow-hidden"
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

function BalancedStatusGrid({
  pages,
}: {
  pages: { id: string; name: string; slug: string; description: string | null }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cols = useColumnCount(containerRef, 240, 12);

  const { data: serviceCounts } = useQuery({
    queryKey: ["all-page-service-counts", pages.map((p) => p.id)],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("status_page_id")
        .in(
          "status_page_id",
          pages.map((p) => p.id),
        );
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        counts[row.status_page_id] = (counts[row.status_page_id] || 0) + 1;
      }
      return counts;
    },
    enabled: pages.length > 0,
  });

  const columns = useMemo(() => {
    if (!serviceCounts) {
      // Before counts load, distribute round-robin to avoid all-in-one-column
      const buckets: (typeof pages)[] = Array.from({ length: cols }, () => []);
      pages.forEach((p, i) => buckets[i % cols].push(p));
      return buckets;
    }
    // Service dots wrap at 12 columns, so height ≈ ceil(count/12) rows of dots + base
    const weight = (p: (typeof pages)[0]) => {
      const count = serviceCounts[p.id] ?? 0;
      return Math.ceil(count / 12) + 4;
    };
    return balanceColumns(pages, cols, weight);
  }, [pages, cols, serviceCounts]);

  return (
    <div ref={containerRef} className="flex gap-3">
      {columns.map((col, ci) => (
        <div key={ci} className="flex-1 min-w-0 flex flex-col gap-3">
          {col.map((page) => (
            <StatusPageCard key={page.id} page={page} />
          ))}
        </div>
      ))}
    </div>
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
          <BalancedStatusGrid pages={pages} />
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
