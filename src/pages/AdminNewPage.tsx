import { useState, useRef, useLayoutEffect, useCallback } from "react";
import { Activity, ArrowLeft, FileText, AlertTriangle, Network, PenLine } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ClonePageContent } from "@/pages/AdminClonePage";
import { IncidentPageContent } from "@/components/IncidentPageContent";

type Choice = "incident" | "clone" | "diagram" | "manual";

const GAP = 16;

const choices = [
  {
    id: "incident" as Choice,
    icon: AlertTriangle,
    iconClass: "text-destructive",
    label: <span>Active incident—need a page <em>fast!</em></span>,
  },
  {
    id: "clone" as Choice,
    icon: FileText,
    iconClass: "text-primary",
    label: "Clone my existing status page",
  },
  {
    id: "diagram" as Choice,
    icon: Network,
    iconClass: "text-primary",
    label: "Start with my system diagram",
  },
  {
    id: "manual" as Choice,
    icon: PenLine,
    iconClass: "text-muted-foreground",
    label: "Do it the old fashioned way",
  },
];

const AdminNewPage = () => {
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from");
  const backTo = from === "admin" ? "/admin" : "/";

  const [selected, setSelected] = useState<Choice | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [offsets, setOffsets] = useState<number[]>([]);

  const measure = useCallback(() => {
    const tops: number[] = [];
    let cumulative = 0;
    itemRefs.current.forEach((el, i) => {
      tops.push(cumulative);
      if (el) {
        cumulative += el.getBoundingClientRect().height + GAP;
      }
    });
    setOffsets(tops);
  }, []);

  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const handleBack = () => {
    setSelected(null);
  };

  const selectedIndex = selected ? choices.findIndex((c) => c.id === selected) : -1;
  const totalHeight = offsets.length > 0 && itemRefs.current[choices.length - 1]
    ? offsets[choices.length - 1] + (itemRefs.current[choices.length - 1]?.getBoundingClientRect().height ?? 0)
    : 0;
  const selectedButtonHeight = selectedIndex >= 0
    ? itemRefs.current[selectedIndex]?.getBoundingClientRect().height ?? 0
    : 0;
  const contentPullUp = selected ? totalHeight - selectedButtonHeight - GAP : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center gap-3">
          <Activity className="h-7 w-7 text-primary" />
          <h1 className="text-xl font-bold text-foreground tracking-tight">What do you need?</h1>
          {selected ? (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          ) : (
            <Link to={backTo} className="ml-auto">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            </Link>
          )}
        </div>
      </header>

      <main className={`max-w-4xl mx-auto px-4 transition-all duration-500 ease-in-out ${selected ? "pt-6" : "py-16"}`}>
        <div className="max-w-2xl mx-auto">
          {/* Button list */}
          <div className="relative">
            {choices.map((choice, index) => {
              const Icon = choice.icon;
              const isSelected = selected === choice.id;
              const isHidden = selected !== null && !isSelected;
              const translateY = isSelected && offsets[index] ? -offsets[index] : 0;

              return (
                <div
                  key={choice.id}
                  ref={(el) => { itemRefs.current[index] = el; }}
                  className="transition-all duration-500 ease-in-out"
                  style={{
                    transform: `translateY(${translateY}px)`,
                    opacity: isHidden ? 0 : 1,
                    pointerEvents: isHidden ? "none" : "auto",
                    marginBottom: GAP,
                  }}
                >
                  <Button
                    variant="outline"
                    className={`w-full h-auto py-5 flex items-center gap-4 text-base font-medium justify-center px-6 whitespace-normal transition-colors duration-300 ${
                      isSelected ? "border-primary bg-accent" : ""
                    }`}
                    onClick={() => setSelected(isSelected ? null : choice.id)}
                  >
                    <Icon className={`h-10 w-10 shrink-0 ${choice.iconClass}`} />
                    {choice.label}
                  </Button>
                </div>
              );
            })}
          </div>

          {/* Expanded section */}
          <div
            className="transition-all duration-500 ease-in-out overflow-hidden"
            style={{
              maxHeight: selected ? "none" : 0,
              opacity: selected ? 1 : 0,
              transform: `translateY(-${contentPullUp}px)`,
              marginTop: selected ? GAP : 0,
            }}
          >
            {selected === "clone" && <ClonePageContent />}
            {selected === "incident" && <IncidentPageContent />}
            {selected && selected !== "clone" && selected !== "incident" && (
              <div className="border border-border rounded-lg p-8 bg-card">
                <p className="text-muted-foreground text-center">
                  This section is under construction. Coming soon!
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminNewPage;
