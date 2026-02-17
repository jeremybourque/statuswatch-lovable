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
  // Anchor dates to startDate if provided; otherwise use UTC today as the last bar
  const anchorDate = startDate
    ? parseLocalDate(startDate)
    : (() => {
        const now = new Date();
        // Use UTC "today" since source pages use UTC dates
        const utcToday = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        return addLocalDays(utcToday, -(days.length - 1));
      })();

  return (
    <div className="flex gap-[2px] items-end">
      {days.map((up, i) => {
        const date = addLocalDays(anchorDate, i);
        return (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <div
                className={`flex-1 min-w-[4px] h-6 rounded-sm transition-colors ${
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
