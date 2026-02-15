import { useStatusPages } from "@/hooks/useStatusData";
import { getOverallStatus, statusConfig } from "@/lib/statusData";
import { Activity, Loader2, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import type { ServiceStatus } from "@/lib/statusData";

function usePageOverallStatus(pageId: string) {
  return useQuery({
    queryKey: ["page-status", pageId],
    queryFn: async (): Promise<ServiceStatus> => {
      const { data, error } = await supabase
        .from("services")
        .select("status")
        .eq("status_page_id", pageId);
      if (error) throw error;
      const statuses = (data ?? []).map((s) => s.status as ServiceStatus);
      if (statuses.some((s) => s === "major")) return "major";
      if (statuses.some((s) => s === "partial")) return "partial";
      if (statuses.some((s) => s === "degraded")) return "degraded";
      if (statuses.some((s) => s === "maintenance")) return "maintenance";
      return "operational";
    },
  });
}

function StatusPageCard({ page }: { page: { id: string; name: string; slug: string; description: string | null } }) {
  const { data: status = "operational" } = usePageOverallStatus(page.id);
  const config = statusConfig[status];

  return (
    <Link
      to={`/${page.slug}`}
      className="group block border border-border rounded-lg bg-card p-5 hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <span className="relative flex h-3 w-3 shrink-0">
            {status !== "operational" && (
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.dotClass} opacity-75`} />
            )}
            <span className={`relative inline-flex rounded-full h-3 w-3 ${config.dotClass}`} />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold text-card-foreground truncate">{page.name}</h2>
            {page.description && (
              <p className="text-sm text-muted-foreground mt-0.5 truncate">{page.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-sm font-medium ${config.colorClass}`}>{config.label}</span>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    </Link>
  );
}

const StatusPagesIndex = () => {
  const { data: pages = [], isLoading } = useStatusPages();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-3">
          <Activity className="h-7 w-7 text-primary" />
          <h1 className="text-xl font-bold text-foreground tracking-tight">StatusWatch</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <h2 className="text-xl font-semibold text-foreground">Status Pages</h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : pages.length === 0 ? (
          <p className="text-muted-foreground text-sm">No status pages configured.</p>
        ) : (
          <div className="space-y-3">
            {pages.map((page) => (
              <StatusPageCard key={page.id} page={page} />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-border mt-16">
        <div className="max-w-3xl mx-auto px-4 py-6 text-sm text-muted-foreground">
          <span>© 2026 StatusWatch</span>
        </div>
      </footer>
    </div>
  );
};

export default StatusPagesIndex;
