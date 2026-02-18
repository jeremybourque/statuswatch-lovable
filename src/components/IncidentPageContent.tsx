import { useState } from "react";
import { Loader2, Zap, PenLine, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { StatusPagePreview, type PreviewIncident, type PreviewService } from "@/components/StatusPagePreview";

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function IncidentPageContent({ navigateTo = "/" }: { navigateTo?: string }) {
  const { toast } = useToast();

  const [text, setText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [previewData, setPreviewData] = useState<{
    services: PreviewService[];
    incidents: PreviewIncident[];
    name: string;
    slug: string;
  } | null>(null);

  async function findUniqueSlug(base: string): Promise<string> {
    let candidate = base;
    let suffix = 1;
    while (true) {
      const { data } = await supabase
        .from("status_pages")
        .select("id")
        .eq("slug", candidate)
        .maybeSingle();
      if (!data) return candidate;
      candidate = `${base}-${suffix}`;
      suffix++;
    }
  }

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    if (previewData) {
      const confirmed = window.confirm("This will clear the current preview. Continue?");
      if (!confirmed) return;
    }
    setAnalyzing(true);
    setPreviewData(null);
    setCollapsed(false);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/analyze-incident`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ text: text.trim() }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(err.error || `Request failed (${response.status})`);
      }

      const result = await response.json();
      if (!result.success || !result.data) throw new Error("No data returned");

      const data = result.data as PreviewIncident & { organization?: string };
      if (data.updates.length > 0) {
        data.status = data.updates[0].status;
      }

      const org = data.organization?.trim();
      let pageName = "";
      let pageSlug = "";
      if (org) {
        pageName = org;
        const baseSlug = slugify(pageName);
        pageSlug = await findUniqueSlug(baseSlug);
      }

      setPreviewData({
        services: data.services,
        incidents: [data],
        name: pageName,
        slug: pageSlug,
      });

      setCollapsed(true);

      toast({
        title: "Incident analyzed!",
        description: `Found ${data.services.length} affected services.`,
      });
    } catch (err: any) {
      toast({
        title: "Analysis failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Input section */}
      <section
        className={`border rounded-xl p-6 transition-colors duration-300 ${
          collapsed
            ? "border-primary bg-accent"
            : "border-border bg-card"
        }`}
      >
        <div
          className={`flex items-center justify-between ${previewData ? "cursor-pointer" : ""}`}
          onClick={previewData ? () => setCollapsed(!collapsed) : undefined}
        >
          <h2 className="text-lg font-semibold flex items-center gap-2 text-card-foreground">
            <PenLine className="h-5 w-5" />
            Describe the Incident
          </h2>
          {previewData && (
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-300 ${
                collapsed ? "" : "rotate-180"
              }`}
            />
          )}
        </div>
        <div
          className={`transition-all duration-300 ease-in-out overflow-hidden ${
            collapsed ? "max-h-0 opacity-0 mt-0" : "max-h-[600px] opacity-100 mt-4"
          }`}
        >
          <div className="space-y-4">
            <Textarea
              placeholder={"Paste your incident status updates here, or describe what's happening...\n\nExample:\n\"Our API is experiencing elevated error rates. Database connections are timing out. The web dashboard is loading slowly. We identified the issue as a failed database migration and are rolling it back.\""}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-[160px] font-mono text-sm"
              disabled={analyzing}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                AI will identify affected services and create a status page preview.
              </p>
              <Button onClick={(e) => { e.stopPropagation(); handleAnalyze(); }} disabled={analyzing || !text.trim()} className="shrink-0">
                {analyzing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Zap className="h-4 w-4 mr-1" />
                )}
                {analyzing ? "Analyzing..." : previewData ? "Re-analyze" : "Analyze Incident"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Preview */}
      {previewData && (
        <StatusPagePreview
          initialServices={previewData.services}
          initialIncidents={previewData.incidents}
          initialName={previewData.name}
          initialSlug={previewData.slug}
          navigateTo={navigateTo}
        />
      )}
    </div>
  );
}
