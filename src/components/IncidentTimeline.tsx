import { type Incident, statusConfig } from "@/lib/statusData";
import { format, parseISO } from "date-fns";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

const updateStatusColors: Record<string, string> = {
  investigating: "text-status-major",
  identified: "text-status-partial",
  monitoring: "text-status-degraded",
  resolved: "text-status-operational",
};

const updateStatusBg: Record<string, string> = {
  investigating: "bg-status-major",
  identified: "bg-status-partial",
  monitoring: "bg-status-degraded",
  resolved: "bg-status-operational",
};

function IncidentCard({ incident }: { incident: Incident }) {
  const [expanded, setExpanded] = useState(incident.status !== "resolved");
  const latestStatus = incident.updates.length > 0 ? incident.updates[0].status : incident.status;

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-1.5 h-8 rounded-full ${updateStatusBg[latestStatus]}`} />
          <div>
            <h3 className="font-semibold text-card-foreground">{incident.title}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {format(parseISO(incident.createdAt), "MMM d, yyyy · h:mm a")}
            </p>
          </div>
        </div>
        <ChevronDown
          className={`h-5 w-5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          <div className="ml-5 border-l-2 border-border pl-6 space-y-4">
            {incident.updates.map((update, i) => (
              <div key={i} className="relative">
                <div className="absolute -left-[31px] top-1 w-3 h-3 rounded-full bg-border border-2 border-card" />
                <div>
                  <span className={`text-sm font-semibold capitalize ${updateStatusColors[update.status]}`}>
                    {update.status}
                  </span>
                  <span className="text-sm text-muted-foreground ml-2">
                    — {format(parseISO(update.timestamp), "MMM d, h:mm a")}
                  </span>
                </div>
                <p className="text-sm text-card-foreground mt-1 leading-relaxed">{update.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function IncidentTimeline({ incidents }: { incidents: Incident[] }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-foreground">Incident History</h2>
      {incidents.length === 0 ? (
        <p className="text-muted-foreground text-sm">No recent incidents.</p>
      ) : (
        <div className="space-y-3">
          {incidents.map((incident) => (
            <IncidentCard key={incident.id} incident={incident} />
          ))}
        </div>
      )}
    </div>
  );
}
