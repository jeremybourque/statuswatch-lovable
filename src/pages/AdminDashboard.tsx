import { useState } from "react";
import { useStatusPages, type StatusPage } from "@/hooks/useStatusData";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Plus, Loader2, Trash2, ArrowLeft, Pencil, Check, X } from "lucide-react";
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

function EditableRow({ page, onDelete }: { page: StatusPage; onDelete: (id: string, name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(page.name);
  const [editSlug, setEditSlug] = useState(page.slug);
  const [editDesc, setEditDesc] = useState(page.description ?? "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const startEdit = () => {
    setEditName(page.name);
    setEditSlug(page.slug);
    setEditDesc(page.description ?? "");
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = async () => {
    if (!editName.trim() || !editSlug.trim()) {
      toast({ title: "Name and slug are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("status_pages")
      .update({
        name: editName.trim(),
        slug: editSlug.trim(),
        description: editDesc.trim() || null,
      })
      .eq("id", page.id);
    setSaving(false);
    if (error) {
      toast({
        title: "Failed to update",
        description: error.message.includes("duplicate")
          ? "A page with that slug already exists."
          : error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Status page updated!" });
    setEditing(false);
    queryClient.invalidateQueries({ queryKey: ["status-pages"] });
  };

  if (!editing) {
    return (
      <div className="flex items-center justify-between border border-border rounded-lg bg-card px-4 py-3">
        <div>
          <Link to={`/${page.slug}`} className="text-sm font-semibold text-card-foreground hover:underline">
            {page.name}
          </Link>
          <p className="text-xs text-muted-foreground font-mono">/{page.slug}</p>
          {page.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{page.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={startEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
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

  return (
    <div className="border border-primary/30 rounded-lg bg-card px-4 py-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Name</Label>
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Slug</Label>
          <Input value={editSlug} onChange={(e) => setEditSlug(slugify(e.target.value))} />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={saveEdit} disabled={saving || !editName.trim() || !editSlug.trim()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={cancelEdit}>
          <X className="h-3.5 w-3.5 mr-1" />
          Cancel
        </Button>
      </div>
    </div>
  );
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
                <EditableRow key={page.id} page={page} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default AdminDashboard;
