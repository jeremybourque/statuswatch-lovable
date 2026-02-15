import { CheckCircle2, AlertTriangle, XCircle, Wrench, AlertCircle } from "lucide-react";
import { type ServiceStatus, statusConfig } from "@/lib/statusData";

const icons: Record<ServiceStatus, React.ReactNode> = {
  operational: <CheckCircle2 className="h-6 w-6" />,
  degraded: <AlertCircle className="h-6 w-6" />,
  partial: <AlertTriangle className="h-6 w-6" />,
  major: <XCircle className="h-6 w-6" />,
  maintenance: <Wrench className="h-6 w-6" />,
};

const bannerMessages: Record<ServiceStatus, string> = {
  operational: "All Systems Operational",
  degraded: "Some Systems Experiencing Degraded Performance",
  partial: "Partial System Outage",
  major: "Major System Outage",
  maintenance: "Scheduled Maintenance In Progress",
};

export function StatusBanner({ status }: { status: ServiceStatus }) {
  const config = statusConfig[status];

  return (
    <div className={`${config.bgClass} rounded-lg p-4 flex items-center gap-3 text-primary-foreground`}>
      {icons[status]}
      <span className="text-lg font-semibold">{bannerMessages[status]}</span>
    </div>
  );
}
