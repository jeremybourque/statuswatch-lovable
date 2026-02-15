import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Activity, ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, useIsAdmin } from "@/hooks/useAuth";
import { Link } from "react-router-dom";

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

const CreateStatusPage = () => {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugTouched) setSlug(slugify(val));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug.trim()) return;
    setSaving(true);

    const { error } = await supabase.from("status_pages").insert({
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || null,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Created!", description: `Status page "${name}" is live.` });
      navigate(`/${slug.trim()}`);
    }
    setSaving(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    navigate("/auth");
    return null;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-muted-foreground">You need admin access to create status pages.</p>
          <Link to="/" className="text-primary text-sm hover:underline">← Back to home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-xl mx-auto px-4 py-6 flex items-center gap-3">
          <Link to="/">
            <ArrowLeft className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
          </Link>
          <Activity className="h-6 w-6 text-primary" />
          <h1 className="text-lg font-bold text-foreground">New Status Page</h1>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="space-y-5 border border-border rounded-xl bg-card p-6">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="My Service"
              required
              maxLength={100}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              placeholder="my-service"
              required
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">URL path: /{slug || "my-service"}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="desc">Description (optional)</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this status page"
              maxLength={500}
              rows={3}
            />
          </div>

          <Button type="submit" disabled={saving || !name.trim() || !slug.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Status Page
          </Button>
        </form>
      </main>
    </div>
  );
};

export default CreateStatusPage;
