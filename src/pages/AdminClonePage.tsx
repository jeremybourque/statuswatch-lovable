import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, ArrowLeft, Loader2, Globe, Plus, Check } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { statusConfig, type ServiceStatus } from "@/lib/statusData";

interface ExtractedService {
  name: string;
  status: ServiceStatus;
}

interface ExtractedData {
  name: string;
  services: ExtractedService[];
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const AdminClonePage = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleFetch = async () => {
    if (!url.trim()) return;
    setFetching(true);
    setExtracted(null);

    try {
      const { data, error } = await supabase.functions.invoke("clone-status-page", {
        body: { url: url.trim() },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to extract data");

      const result = data.data as ExtractedData;
      setExtracted(result);
      setName(result.name || "");
      if (!slugManual) setSlug(slugify(result.name || ""));
      toast({ title: "Page analyzed!", description: `Found ${result.services?.length ?? 0} services.` });
    } catch (err: any) {
      toast({ title: "Failed to analyze page", description: err.message, variant: "destructive" });
    } finally {
      setFetching(false);
    }
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManual) setSlug(slugify(val));
  };

  const handleCreate = async () => {
    if (!name.trim() || !slug.trim() || !extracted) return;
    setCreating(true);

    try {
      // Create the status page
      const { data: page, error: pageErr } = await supabase
        .from("status_pages")
        .insert({ name: name.trim(), slug: slug.trim() })
        .select("id")
        .single();
      if (pageErr) throw pageErr;

      // Create services
      if (extracted.services?.length > 0) {
        const services = extracted.services.map((s, i) => ({
          name: s.name,
          status: s.status,
          status_page_id: page.id,
          display_order: i,
        }));
        const { error: sErr } = await supabase.from("services").insert(services);
        if (sErr) throw sErr;
      }

      toast({ title: "Status page cloned!" });
      navigate("/admin");
    } catch (err: any) {
      toast({
        title: "Failed to create",
        description: err.message.includes("duplicate")
          ? "A page with that slug already exists."
          : err.message,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center gap-3">
          <Activity className="h-7 w-7 text-primary" />
          <h1 className="text-xl font-bold text-foreground tracking-tight">Clone Status Page</h1>
          <Link to="/admin" className="ml-auto">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* URL input */}
        <section className="border border-border rounded-xl bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Enter Status Page URL
          </h2>
          <div className="flex gap-3">
            <Input
              placeholder="https://status.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleFetch} disabled={fetching || !url.trim()}>
              {fetching ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Globe className="h-4 w-4 mr-1" />}
              {fetching ? "Analyzing..." : "Analyze"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Paste a public status page URL to extract its services and create a copy.
          </p>
        </section>

        {/* Preview extracted data */}
        {extracted && (
          <section className="border border-border rounded-xl bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-card-foreground">Preview</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="clone-name">Name</Label>
                <Input
                  id="clone-name"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clone-slug">Slug</Label>
                <Input
                  id="clone-slug"
                  value={slug}
                  onChange={(e) => {
                    setSlugManual(true);
                    setSlug(slugify(e.target.value));
                  }}
                />
                <p className="text-xs text-muted-foreground">URL path: /{slug || "..."}</p>
              </div>
            </div>

            {extracted.services?.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm">Services ({extracted.services.length})</Label>
                <div className="space-y-1.5">
                  {extracted.services.map((s, i) => {
                    const config = statusConfig[s.status] ?? statusConfig.operational;
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-3 border border-border rounded-lg bg-background px-3 py-2"
                      >
                        <span className={`inline-flex h-2.5 w-2.5 rounded-full ${config.dotClass}`} />
                        <span className="text-sm text-foreground">{s.name}</span>
                        <span className={`text-xs font-medium ml-auto ${config.colorClass}`}>
                          {config.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <Button
              onClick={handleCreate}
              disabled={creating || !name.trim() || !slug.trim()}
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Plus className="h-4 w-4 mr-1" />
              )}
              Create Status Page
            </Button>
          </section>
        )}
      </main>
    </div>
  );
};

export default AdminClonePage;
