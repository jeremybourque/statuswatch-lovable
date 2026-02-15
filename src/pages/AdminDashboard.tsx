import { useState } from "react";
import { useStatusPages } from "@/hooks/useStatusData";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Plus, Loader2, Trash2, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const AdminDashboard = () => {
  const { data: pages = [], isLoading } = useStatusPages();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManual) setSlug(slugify(val));
  };

  const handleCreate = async () => {
    if (!name.trim() || !slug.trim()) {
      toast({ title: "Name and slug are required", variant: "destructive" });
      return;
    }
    setCreating(true);
    const { error } = await supabase.from("status_pages").insert({
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || null,
    });
    setCreating(false);
    if (error) {
      toast({
        title: "Failed to create status page",
        description: error.message.includes("duplicate")
          ? "A page with that slug already exists."
          : error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Status page created!" });
    setName("");
    setSlug("");
    setDescription("");
    setSlugManual(false);
    queryClient.invalidateQueries({ queryKey: ["status-pages"] });
  };

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

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Create form */}
        <section className="border border-border rounded-xl bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
            <Plus className="h-5 w-5" />
            New Status Page
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="My Service"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                placeholder="my-service"
                value={slug}
                onChange={(e) => {
                  setSlugManual(true);
                  setSlug(slugify(e.target.value));
                }}
              />
              <p className="text-xs text-muted-foreground">URL path: /{slug || "..."}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Brief description of this status page"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <Button onClick={handleCreate} disabled={creating || !name.trim() || !slug.trim()}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
            Create Status Page
          </Button>
        </section>

        {/* Existing pages */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Existing Pages</h2>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : pages.length === 0 ? (
            <p className="text-muted-foreground text-sm">No status pages yet. Create one above.</p>
          ) : (
            <div className="space-y-2">
              {pages.map((page) => (
                <div
                  key={page.id}
                  className="flex items-center justify-between border border-border rounded-lg bg-card px-4 py-3"
                >
                  <div>
                    <Link to={`/${page.slug}`} className="text-sm font-semibold text-card-foreground hover:underline">
                      {page.name}
                    </Link>
                    <p className="text-xs text-muted-foreground font-mono">/{page.slug}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(page.id, page.name)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default AdminDashboard;
