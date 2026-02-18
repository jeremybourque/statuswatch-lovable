import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Activity, Plus, ArrowLeft, Globe, Network, FileText, ExternalLink, RefreshCw, Check } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

type ResourceType = "status_page" | "system_diagram" | "incident_description";

interface Resource {
  id: string;
  type: ResourceType;
  name: string;
  url: string | null;
  content: string | null;
  created_at: string;
}

const sectionConfig: Record<ResourceType, { label: string; icon: typeof Globe; description: string }> = {
  status_page: { label: "Status Pages", icon: Globe, description: "Clone existing status pages into new projects" },
  system_diagram: { label: "System Diagrams", icon: Network, description: "Analyze architecture diagrams for status page generation" },
  incident_description: { label: "Incident Descriptions", icon: FileText, description: "Pre-written incident texts for quick analysis" },
};

const typeOrder: ResourceType[] = ["status_page", "system_diagram", "incident_description"];

function ResourceForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Resource;
  onSubmit: (data: { type: ResourceType; name: string; url: string; content: string }) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<ResourceType>(initial?.type ?? "status_page");
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const isText = type === "incident_description";

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Type</label>
        <Select value={type} onValueChange={(v) => setType(v as ResourceType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="status_page">Status Page</SelectItem>
            <SelectItem value="system_diagram">System Diagram</SelectItem>
            <SelectItem value="incident_description">Incident Description</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Resource name" />
      </div>
      {isText ? (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Content</label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Description text…"
            rows={4}
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">URL</label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!name.trim() || (isText ? !content.trim() : !url.trim())}
          onClick={() => onSubmit({ type, name, url, content })}
        >
          {initial ? "Update" : "Create"}
        </Button>
      </div>
    </div>
  );
}

function getFaviconUrl(siteUrl: string, bustCache?: number): string | null {
  try {
    const domain = new URL(siteUrl).hostname;
    const base = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    return bustCache ? `${base}&_=${bustCache}` : base;
  } catch {
    return null;
  }
}

function ResourceCard({ resource, navigate }: { resource: Resource; navigate: ReturnType<typeof useNavigate> }) {
  const [faviconError, setFaviconError] = useState(false);
  const [cacheBust, setCacheBust] = useState<number | undefined>();
  const [previewBust, setPreviewBust] = useState<number | undefined>();
  const [showPreview, setShowPreview] = useState(false);

  const launchAction = () => {
    if (resource.type === "status_page" && resource.url) {
      navigate(`/new?choice=clone&cloneUrl=${encodeURIComponent(resource.url)}`);
    } else if (resource.type === "system_diagram" && resource.url) {
      navigate(`/new?choice=diagram&diagramUrl=${encodeURIComponent(resource.url)}`);
    } else if (resource.type === "incident_description" && resource.content) {
      sessionStorage.setItem("preloadIncidentDescription", resource.content);
      navigate(`/new?choice=incident`);
    }
  };

  const subtitle = resource.type === "incident_description"
    ? (resource.content?.slice(0, 120) + (resource.content && resource.content.length > 120 ? "…" : ""))
    : resource.url;

  const actionLabel = resource.type === "status_page" ? "Clone" : "Analyze";
  const faviconUrl = resource.type === "status_page" && resource.url ? getFaviconUrl(resource.url, cacheBust) : null;
  const previewUrl = resource.type === "status_page" && resource.url && previewBust ? getFaviconUrl(resource.url, previewBust) : null;

  const requestRefresh = () => {
    setPreviewBust(Date.now());
    setShowPreview(true);
  };

  const confirmRefresh = () => {
    setCacheBust(previewBust);
    setFaviconError(false);
    setShowPreview(false);
    setPreviewBust(undefined);
  };

  const cancelRefresh = () => {
    setShowPreview(false);
    setPreviewBust(undefined);
  };

  return (
    <div className="rounded-xl border border-border bg-card transition-colors hover:border-primary/20 hover:bg-accent/50">
      <div className="group flex items-center gap-3 p-4">
        {faviconUrl && !faviconError ? (
          <button onClick={requestRefresh} className="shrink-0 rounded hover:ring-2 hover:ring-primary/20 transition-all" title="Refresh favicon">
            <img src={faviconUrl} alt="" className="h-5 w-5 rounded" />
          </button>
        ) : resource.type === "status_page" ? (
          <button onClick={requestRefresh} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors" title="Refresh favicon">
            <RefreshCw className="h-5 w-5" />
          </button>
        ) : null}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground text-sm">{resource.name}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 opacity-70 group-hover:opacity-100 transition-opacity"
          onClick={launchAction}
        >
          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
          {actionLabel}
        </Button>
      </div>
      {showPreview && previewUrl && (
        <div className="border-t border-border px-4 py-3 flex items-center gap-3 bg-muted/30 rounded-b-xl">
          <img src={previewUrl} alt="New favicon" className="h-8 w-8 rounded border border-border" />
          <p className="text-xs text-muted-foreground flex-1">Use this favicon?</p>
          <Button variant="outline" size="sm" onClick={cancelRefresh}>Cancel</Button>
          <Button size="sm" onClick={confirmRefresh}>
            <Check className="h-3.5 w-3.5 mr-1" />
            Accept
          </Button>
        </div>
      )}
    </div>
  );
}

const ResourcesPage = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: resources = [], isLoading } = useQuery({
    queryKey: ["resources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resources")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Resource[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (vals: { type: ResourceType; name: string; url: string; content: string }) => {
      const row = {
        type: vals.type,
        name: vals.name,
        url: vals.type === "incident_description" ? null : vals.url,
        content: vals.type === "incident_description" ? vals.content : null,
      };
      const { error } = await supabase.from("resources").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resources"] });
      setDialogOpen(false);
      toast.success("Resource saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const grouped = typeOrder.reduce((acc, type) => {
    acc[type] = resources.filter((r) => r.type === type);
    return acc;
  }, {} as Record<ResourceType, Resource[]>);

  const nonEmptySections = typeOrder.filter((t) => grouped[t].length > 0);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Activity className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">Resources</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Saved references for quick-launch workflows</p>
          </div>
          <div className="ml-auto">
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : resources.length === 0 ? (
          <div className="text-center py-16">
            <Activity className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No resources yet. Add one to get started.</p>
          </div>
        ) : (
          nonEmptySections.map((type) => {
            const config = sectionConfig[type];
            const Icon = config.icon;
            return (
              <section key={type}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">{config.label}</h2>
                    <p className="text-xs text-muted-foreground">{config.description}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {grouped[type].map((r) => (
                    <ResourceCard key={r.id} resource={r} navigate={navigate} />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Resource</DialogTitle>
          </DialogHeader>
          <ResourceForm
            onCancel={() => setDialogOpen(false)}
            onSubmit={(vals) => upsert.mutate(vals)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ResourcesPage;
