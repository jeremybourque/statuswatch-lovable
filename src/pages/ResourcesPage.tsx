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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Activity, Plus, Pencil, Trash2, ArrowLeft, ExternalLink } from "lucide-react";
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

const typeLabels: Record<ResourceType, string> = {
  status_page: "Status Page",
  system_diagram: "System Diagram",
  incident_description: "Incident Description",
};

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

const ResourcesPage = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Resource | undefined>();

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
    mutationFn: async (vals: { id?: string; type: ResourceType; name: string; url: string; content: string }) => {
      const row = {
        type: vals.type,
        name: vals.name,
        url: vals.type === "incident_description" ? null : vals.url,
        content: vals.type === "incident_description" ? vals.content : null,
      };
      if (vals.id) {
        const { error } = await supabase.from("resources").update(row).eq("id", vals.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("resources").insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resources"] });
      setDialogOpen(false);
      setEditing(undefined);
      toast.success("Resource saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("resources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resources"] });
      toast.success("Resource deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };

  const openEdit = (r: Resource) => {
    setEditing(r);
    setDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Activity className="h-7 w-7 text-primary" />
          <h1 className="text-xl font-bold text-foreground tracking-tight">Resources</h1>
          <div className="ml-auto">
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" />
              Add Resource
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : resources.length === 0 ? (
          <p className="text-muted-foreground text-sm">No resources yet.</p>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {typeLabels[r.type]}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                      {r.type === "incident_description" ? r.content : r.url}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        {r.type === "status_page" && r.url && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Clone this status page"
                            onClick={() => navigate(`/new?choice=clone&cloneUrl=${encodeURIComponent(r.url!)}`)}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {r.type === "system_diagram" && r.url && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Use in diagram analyzer"
                            onClick={() => navigate(`/new?choice=diagram&diagramUrl=${encodeURIComponent(r.url!)}`)}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {r.type === "incident_description" && r.content && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Use in incident analyzer"
                            onClick={() => {
                              sessionStorage.setItem("preloadIncidentDescription", r.content!);
                              navigate(`/new?choice=incident`);
                            }}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(undefined); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Resource" : "New Resource"}</DialogTitle>
          </DialogHeader>
          <ResourceForm
            initial={editing}
            onCancel={() => setDialogOpen(false)}
            onSubmit={(vals) => upsert.mutate({ ...vals, id: editing?.id })}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ResourcesPage;
