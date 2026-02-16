export type ServiceStatus = "operational" | "degraded" | "partial" | "major" | "maintenance";

export interface Service {
  id: string;
  name: string;
  status: ServiceStatus;
  uptime: number;
  uptimeDays: (boolean | null)[];
  group_name?: string | null;
}

export interface IncidentUpdate {
  status: "investigating" | "identified" | "monitoring" | "resolved";
  message: string;
  timestamp: string;
}

export interface Incident {
  id: string;
  title: string;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  impact: ServiceStatus;
  createdAt: string;
  updates: IncidentUpdate[];
}

export const statusConfig: Record<ServiceStatus, { label: string; colorClass: string; bgClass: string; dotClass: string }> = {
  operational: {
    label: "Operational",
    colorClass: "text-status-operational",
    bgClass: "bg-status-operational",
    dotClass: "bg-status-operational",
  },
  degraded: {
    label: "Degraded Performance",
    colorClass: "text-status-degraded",
    bgClass: "bg-status-degraded",
    dotClass: "bg-status-degraded",
  },
  partial: {
    label: "Partial Outage",
    colorClass: "text-status-partial",
    bgClass: "bg-status-partial",
    dotClass: "bg-status-partial",
  },
  major: {
    label: "Major Outage",
    colorClass: "text-status-major",
    bgClass: "bg-status-major",
    dotClass: "bg-status-major",
  },
  maintenance: {
    label: "Under Maintenance",
    colorClass: "text-status-maintenance",
    bgClass: "bg-status-maintenance",
    dotClass: "bg-status-maintenance",
  },
};

export function getOverallStatus(serviceList: Service[]): ServiceStatus {
  if (serviceList.some((s) => s.status === "major")) return "major";
  if (serviceList.some((s) => s.status === "partial")) return "partial";
  if (serviceList.some((s) => s.status === "degraded")) return "degraded";
  if (serviceList.some((s) => s.status === "maintenance")) return "maintenance";
  return "operational";
}
