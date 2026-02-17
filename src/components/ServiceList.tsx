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
          <div className="flex items-center gap-2 ml-6">
            <div className="flex-1 min-w-0 overflow-hidden">
              <UptimeBar days={service.uptimeDays} />
            </div>
            <span className="text-xs font-medium font-mono text-muted-foreground shrink-0 w-16 text-right">{service.uptime.toFixed(2)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceGroup({ parent }: { parent: Service }) {
  const [collapsed, setCollapsed] = useState(false);
  const children = parent.children ?? [];
  const groupStatus = children.length > 0 ? getOverallStatus(children) : parent.status;

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between mb-2 group cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <StatusDot status={groupStatus} />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {parent.name}
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
          {children.map((service, index) => (
            <div
              key={service.id}
              className={index !== children.length - 1 ? "border-b border-border" : ""}
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
  return (
    <div className="space-y-6">
      {services.map((service) => {
        if (service.children && service.children.length > 0) {
          return <ServiceGroup key={service.id} parent={service} />;
        }
        return (
          <div key={service.id} className="space-y-0 border border-border rounded-lg overflow-hidden">
            <ServiceCard service={service} />
          </div>
        );
      })}
    </div>
  );
}
