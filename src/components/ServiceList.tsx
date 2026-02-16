import { type Service, type ServiceStatus, statusConfig, getOverallStatus } from "@/lib/statusData";
import { UptimeBar } from "./UptimeBar";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

function StatusDot({ status }: { status: ServiceStatus }) {
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

function ServiceCard({ service }: { service: Service }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card hover:bg-accent/50 transition-colors">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <StatusDot status={service.status} />
          <span className="font-medium text-card-foreground truncate">{service.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${statusConfig[service.status].colorClass}`}>
            {statusConfig[service.status].label}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-3 ml-6">
            <UptimeBar days={service.uptimeDays} />
            <span className="font-mono text-sm text-muted-foreground shrink-0">{service.uptime.toFixed(2)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceGroup({ groupName, services }: { groupName: string; services: Service[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const groupStatus = getOverallStatus(services);

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between mb-2 group cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <StatusDot status={groupStatus} />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {groupName}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${statusConfig[groupStatus].colorClass}`}>
            {statusConfig[groupStatus].label}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
        </div>
      </button>
      {!collapsed && (
        <div className="space-y-0 border border-border rounded-lg overflow-hidden">
          {services.map((service, index) => (
            <div
              key={service.id}
              className={index !== services.length - 1 ? "border-b border-border" : ""}
            >
              <ServiceCard service={service} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ServiceList({ services }: { services: Service[] }) {
  const groups = new Map<string, Service[]>();
  services.forEach((s) => {
    const key = s.group_name || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  });
  const hasGroups = groups.size > 1 || (groups.size === 1 && !groups.has(""));

  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([groupName, groupServices]) => (
        <div key={groupName || "__ungrouped"}>
          {hasGroups && groupName ? (
            <ServiceGroup groupName={groupName} services={groupServices} />
          ) : (
            <div className="space-y-0 border border-border rounded-lg overflow-hidden">
              {groupServices.map((service, index) => (
                <div
                  key={service.id}
                  className={index !== groupServices.length - 1 ? "border-b border-border" : ""}
                >
                  <ServiceCard service={service} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
