export type ServiceStatus = "operational" | "degraded" | "partial" | "major" | "maintenance";

export interface Service {
  id: string;
  name: string;
  status: ServiceStatus;
  uptime: number; // percentage
  uptimeDays: boolean[]; // last 90 days, true = up
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

// Generate random uptime days
const generateUptimeDays = (uptime: number): boolean[] => {
  const days: boolean[] = [];
  for (let i = 0; i < 90; i++) {
    days.push(Math.random() < uptime / 100);
  }
  return days;
};

export const services: Service[] = [
  { id: "1", name: "Website & App", status: "operational", uptime: 99.98, uptimeDays: generateUptimeDays(99.98) },
  { id: "2", name: "API", status: "operational", uptime: 99.95, uptimeDays: generateUptimeDays(99.95) },
  { id: "3", name: "Database", status: "operational", uptime: 99.99, uptimeDays: generateUptimeDays(99.99) },
  { id: "4", name: "CDN / Edge Network", status: "degraded", uptime: 98.5, uptimeDays: generateUptimeDays(98.5) },
  { id: "5", name: "Email Delivery", status: "operational", uptime: 99.92, uptimeDays: generateUptimeDays(99.92) },
  { id: "6", name: "Background Jobs", status: "operational", uptime: 99.87, uptimeDays: generateUptimeDays(99.87) },
  { id: "7", name: "Authentication", status: "operational", uptime: 99.99, uptimeDays: generateUptimeDays(99.99) },
  { id: "8", name: "Payments", status: "operational", uptime: 99.97, uptimeDays: generateUptimeDays(99.97) },
];

export const incidents: Incident[] = [
  {
    id: "inc-1",
    title: "Elevated latency on CDN / Edge Network",
    status: "monitoring",
    impact: "degraded",
    createdAt: "2026-02-15T08:30:00Z",
    updates: [
      {
        status: "monitoring",
        message: "We have deployed a fix and are monitoring the results. Latency has returned to near-normal levels for most regions.",
        timestamp: "2026-02-15T10:15:00Z",
      },
      {
        status: "identified",
        message: "The root cause has been identified as a misconfigured routing rule in the EU-West region. A fix is being deployed.",
        timestamp: "2026-02-15T09:20:00Z",
      },
      {
        status: "investigating",
        message: "We are investigating elevated latency impacting CDN content delivery in certain regions.",
        timestamp: "2026-02-15T08:30:00Z",
      },
    ],
  },
  {
    id: "inc-2",
    title: "API intermittent 503 errors",
    status: "resolved",
    impact: "partial",
    createdAt: "2026-02-13T14:00:00Z",
    updates: [
      {
        status: "resolved",
        message: "This incident has been fully resolved. All API endpoints are responding normally. We will publish a post-mortem within 48 hours.",
        timestamp: "2026-02-13T16:45:00Z",
      },
      {
        status: "monitoring",
        message: "A fix has been deployed. Error rates have dropped to 0%. We are continuing to monitor.",
        timestamp: "2026-02-13T16:00:00Z",
      },
      {
        status: "identified",
        message: "An upstream dependency experienced a connection pool exhaustion. We are scaling up the connection pool and recycling stale connections.",
        timestamp: "2026-02-13T15:10:00Z",
      },
      {
        status: "investigating",
        message: "We are seeing intermittent 503 errors on several API endpoints. Investigating now.",
        timestamp: "2026-02-13T14:00:00Z",
      },
    ],
  },
  {
    id: "inc-3",
    title: "Scheduled maintenance: Database upgrade",
    status: "resolved",
    impact: "maintenance",
    createdAt: "2026-02-10T02:00:00Z",
    updates: [
      {
        status: "resolved",
        message: "Maintenance completed successfully. All database services are operating normally on the upgraded version.",
        timestamp: "2026-02-10T04:30:00Z",
      },
      {
        status: "monitoring",
        message: "Database upgrade is complete. Running post-upgrade validation checks.",
        timestamp: "2026-02-10T04:00:00Z",
      },
      {
        status: "investigating",
        message: "Scheduled maintenance has begun. Database will experience brief periods of read-only access during the upgrade window.",
        timestamp: "2026-02-10T02:00:00Z",
      },
    ],
  },
];

export function getOverallStatus(serviceList: Service[]): ServiceStatus {
  if (serviceList.some((s) => s.status === "major")) return "major";
  if (serviceList.some((s) => s.status === "partial")) return "partial";
  if (serviceList.some((s) => s.status === "degraded")) return "degraded";
  if (serviceList.some((s) => s.status === "maintenance")) return "maintenance";
  return "operational";
}
