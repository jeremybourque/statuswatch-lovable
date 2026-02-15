import { type Service, statusConfig } from "@/lib/statusData";
import { UptimeBar } from "./UptimeBar";

function StatusDot({ status }: { status: Service["status"] }) {
  const config = statusConfig[status];
  return (
    <span className="relative flex h-3 w-3">
      {status !== "operational" && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.dotClass} opacity-75`} />
      )}
      <span className={`relative inline-flex rounded-full h-3 w-3 ${config.dotClass}`} />
    </span>
  );
}

export function ServiceList({ services }: { services: Service[] }) {
  return (
    <div className="space-y-0 border border-border rounded-lg overflow-hidden">
      {services.map((service, index) => (
        <div
          key={service.id}
          className={`p-4 bg-card ${
            index !== services.length - 1 ? "border-b border-border" : ""
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <StatusDot status={service.status} />
              <span className="font-medium text-card-foreground truncate">{service.name}</span>
            </div>
            <span className={`text-sm font-medium ${statusConfig[service.status].colorClass}`}>
              {statusConfig[service.status].label}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-2 ml-6">
            <UptimeBar days={service.uptimeDays} />
            <span className="font-mono text-sm text-muted-foreground shrink-0">{service.uptime.toFixed(2)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}
