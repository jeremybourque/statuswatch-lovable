import { StatusBanner } from "@/components/StatusBanner";
import { ServiceList } from "@/components/ServiceList";
import { IncidentTimeline } from "@/components/IncidentTimeline";
import { services, incidents, getOverallStatus } from "@/lib/statusData";
import { Activity } from "lucide-react";

const Index = () => {
  const overallStatus = getOverallStatus(services);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="h-7 w-7 text-primary" />
            <h1 className="text-xl font-bold text-foreground tracking-tight">StatusWatch</h1>
          </div>
          <span className="text-sm text-muted-foreground font-mono">status.example.com</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <StatusBanner status={overallStatus} />

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-semibold text-foreground">Services</h2>
            <span className="text-xs text-muted-foreground font-mono">90-day uptime</span>
          </div>
          <ServiceList services={services} />
        </div>

        <IncidentTimeline incidents={incidents} />
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-16">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center justify-between text-sm text-muted-foreground">
          <span>© 2026 StatusWatch</span>
          <span className="font-mono text-xs">Updated just now</span>
        </div>
      </footer>
    </div>
  );
};

export default Index;
