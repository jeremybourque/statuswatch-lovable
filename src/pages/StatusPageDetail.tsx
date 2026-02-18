import { StatusBanner } from "@/components/StatusBanner";
import { ServiceList } from "@/components/ServiceList";
import { IncidentTimeline } from "@/components/IncidentTimeline";
import { getOverallStatus } from "@/lib/statusData";
import { useServices, useIncidents, useStatusPage } from "@/hooks/useStatusData";
import { Activity, Loader2, ArrowLeft } from "lucide-react";
import { useParams, Link } from "react-router-dom";
import NotFound from "./NotFound";

const StatusPageDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: page, isLoading: loadingPage } = useStatusPage(slug ?? "");
  const { data: services = [], isLoading: loadingServices } = useServices(page?.id);
  const { data: incidents = [], isLoading: loadingIncidents } = useIncidents(page?.id);
  const overallStatus = getOverallStatus(services);

  if (loadingPage) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!page) return <NotFound />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <Activity className="h-7 w-7 text-primary" />
            <h1 className="text-xl font-bold text-foreground tracking-tight">{page.name}</h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {loadingServices ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <StatusBanner status={overallStatus} />
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xl font-semibold text-foreground">Services</h2>
                <span className="text-xs text-muted-foreground font-mono">90-day uptime</span>
              </div>
              <ServiceList services={services} />
            </div>
          </>
        )}

        {loadingIncidents ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <IncidentTimeline incidents={incidents} />
        )}
      </main>

      <footer className="border-t border-border mt-16">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center justify-between text-sm text-muted-foreground">
          <span>© 2026 StatusWatch</span>
          <span className="font-mono text-xs">Updated just now</span>
        </div>
      </footer>
    </div>
  );
};

export default StatusPageDetail;
