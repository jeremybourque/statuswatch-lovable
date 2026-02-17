import { useStatusPages, type StatusPage } from "@/hooks/useStatusData";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Plus, Loader2, Trash2, ArrowLeft, Pencil, Server, Globe, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";

function usePageCounts(pageId: string) {
  const { data: serviceCount = 0 } = useQuery({
    queryKey: ["service-count", pageId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("services")
        .select("*", { count: "exact", head: true })
        .eq("status_page_id", pageId);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const { data: incidentCount = 0 } = useQuery({
    queryKey: ["open-incident-count", pageId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("incidents")
        .select("*", { count: "exact", head: true })
        .eq("status_page_id", pageId)
        .neq("status", "resolved");
      if (error) throw error;
      return count ?? 0;
    },
  });
  return { serviceCount, incidentCount };
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function PageRow({ page, onDelete }: { page: StatusPage; onDelete: (id: string, name: string) => void }) {
  const { serviceCount, incidentCount } = usePageCounts(page.id);
  return (
    <div className="flex items-center justify-between border border-border rounded-lg bg-card px-4 py-3">
      <div>
        <div className="flex items-center gap-4">
          <Link to={`/${page.slug}`} className="text-sm font-semibold text-card-foreground hover:underline">
            {page.name}
          </Link>
          <span className="text-xs text-muted-foreground font-mono">/{page.slug}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {serviceCount} service{serviceCount !== 1 ? "s" : ""} · {incidentCount} open incident{incidentCount !== 1 ? "s" : ""}
          {page.description && <> · {page.description}</>}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Link to={`/admin/${page.slug}/services?tab=details`}>
          <Button variant="ghost" size="icon" title="Edit page details">
            <Pencil className="h-4 w-4" />
          </Button>
        </Link>
        <Link to={`/admin/${page.slug}/services?tab=services`}>
          <Button variant="ghost" size="icon" title="Edit services">
            <Server className="h-4 w-4" />
          </Button>
        </Link>
        <Link to={`/admin/${page.slug}/services?tab=incidents`}>
          <Button variant="ghost" size="icon" title="Edit incidents">
            <AlertTriangle className="h-4 w-4" />
          </Button>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive"
          onClick={() => onDelete(page.id, page.name)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

const AdminDashboard = () => {
  const { data: pages = [], isLoading } = useStatusPages();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleDelete = async (id: string, pageName: string) => {
    if (!confirm(`Delete "${pageName}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("status_pages").delete().eq("id", id);
    if (error) {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `"${pageName}" deleted` });
    queryClient.invalidateQueries({ queryKey: ["status-pages"] });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center gap-3">
          <Activity className="h-7 w-7 text-primary" />
          <h1 className="text-xl font-bold text-foreground tracking-tight">StatusWatch Admin</h1>
          <Link to="/" className="ml-auto">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Status Pages</h2>
          <div className="flex items-center gap-2">
            <Link to="/admin/clone">
              <Button size="sm" variant="outline">
                <Globe className="h-4 w-4 mr-1" />
                Clone from URL
              </Button>
            </Link>
            <Link to="/admin/new?from=admin">
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Add Page
              </Button>
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : pages.length === 0 ? (
          <p className="text-muted-foreground text-sm">No status pages yet.</p>
        ) : (
          <div className="space-y-2">
            {pages.map((page) => (
              <PageRow key={page.id} page={page} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminDashboard;
