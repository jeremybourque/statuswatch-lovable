import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";

interface UptimeBarProps {
  days: (boolean | null)[];
  startDate?: string | null; // YYYY-MM-DD anchor for the first bar
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addLocalDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function UptimeBar({ days, startDate }: UptimeBarProps) {
  // If startDate provided, anchor dates to it; otherwise fall back to today-based
  const anchorDate = startDate
    ? parseLocalDate(startDate)
    : addLocalDays(new Date(), -(days.length - 1));

  return (
    <div className="flex gap-[2px] items-end w-full min-w-0">
      {days.map((up, i) => {
        const date = addLocalDays(anchorDate, i);
        return (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <div
                className={`flex-1 min-w-0 h-6 rounded-sm transition-colors ${
                  up === null ? "bg-muted-foreground/20" : up ? "bg-status-operational" : "bg-status-major"
                } hover:opacity-80`}
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {format(date, "MMM d, yyyy")} — {up === null ? "No data" : up ? "No downtime" : "Downtime recorded"}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
