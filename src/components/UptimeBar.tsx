import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format, subDays } from "date-fns";

interface UptimeBarProps {
  days: (boolean | null)[];
}

export function UptimeBar({ days }: UptimeBarProps) {
  const today = new Date();

  return (
    <div className="flex gap-[2px] items-end">
      {days.map((up, i) => {
        const date = subDays(today, days.length - 1 - i);
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
