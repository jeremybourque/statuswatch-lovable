import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface UptimeBarProps {
  days: (boolean | null)[];
}

export function UptimeBar({ days }: UptimeBarProps) {
  return (
    <div className="flex gap-[2px] items-end">
      {days.map((up, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <div
              className={`w-[3px] h-6 rounded-sm transition-colors ${
                up === null ? "bg-muted-foreground/20" : up ? "bg-status-operational" : "bg-status-major"
              } hover:opacity-80`}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {90 - i} days ago — {up === null ? "No data" : up ? "No downtime" : "Downtime recorded"}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
