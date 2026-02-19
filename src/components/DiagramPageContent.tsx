import { useState, useRef, useCallback } from "react";
import { Loader2, Network, Upload, Link, Image, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { StatusPagePreview, type PreviewService } from "@/components/StatusPagePreview";

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function DiagramPageContent({ navigateTo = "/", initialUrl }: { navigateTo?: string; initialUrl?: string }) {
  const { toast } = useToast();

  const [mode, setMode] = useState<"idle" | "file" | "url">(initialUrl ? "url" : "idle");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState(initialUrl || "");
  const [analyzing, setAnalyzing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [previewData, setPreviewData] = useState<{
    services: PreviewService[];
    name: string;
    slug: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image file.", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max file size is 20MB.", variant: "destructive" });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImagePreview(dataUrl);
      // Strip the data:image/...;base64, prefix
      const base64 = dataUrl.split(",")[1];
      setImageBase64(base64);
      setImageUrl("");
      setMode("file");
    };
    reader.readAsDataURL(file);
  }, [toast]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) processFile(file);
        return;
      }
    }
    // Check for pasted URL text
    const text = e.clipboardData?.getData("text/plain")?.trim();
    if (text && /^https?:\/\/.+/i.test(text)) {
      e.preventDefault();
      setMode("url");
      setImageUrl(text);
    }
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const clearImage = () => {
    setImagePreview(null);
    setImageBase64(null);
    setImageUrl("");
    setMode("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

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

  const loadImageFromUrl = (url: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        setImagePreview(url);
        setMode("file");
        resolve();
      };
      img.onerror = () => {
        // Still show the URL as preview even if CORS blocks it
        setImagePreview(url);
        setMode("file");
        resolve();
      };
      img.src = url;
    });
  };

  const handleAnalyze = async () => {
    if (!imageBase64 && !imageUrl.trim()) return;

    // If in URL mode, load and display the image first
    if (!imageBase64 && imageUrl.trim()) {
      await loadImageFromUrl(imageUrl.trim());
    }

    setAnalyzing(true);
    setPreviewData(null);
    setCollapsed(false);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const body: Record<string, string> = {};
      if (imageBase64) {
        body.imageBase64 = imageBase64;
      } else if (imageUrl.trim()) {
        body.imageUrl = imageUrl.trim();
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/analyze-diagram`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(err.error || `Request failed (${response.status})`);
      }

      const result = await response.json();
      if (!result.success || !result.data) throw new Error("No data returned");

      const data = result.data;
      const services: PreviewService[] = (data.services || [])
        .filter((s: any) => s.name?.toLowerCase() !== "user")
        .map((s: any) => ({
          name: s.name,
          status: s.status || "operational",
        }));

      const org = data.organization?.trim();
      let pageName = org || data.suggested_name?.trim() || "";

      // Last-resort fallback: derive name from the image URL filename
      if (!pageName && imageUrl.trim()) {
        try {
          const pathname = new URL(imageUrl.trim()).pathname;
          const filename = pathname.split("/").pop() || "";
          const nameFromFile = filename
            .replace(/\.[^.]+$/, "")
            .replace(/[-_]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (nameFromFile.length > 2) {
            pageName = nameFromFile
              .split(" ")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" ");
          }
        } catch { /* invalid URL, skip */ }
      }

      let pageSlug = "";
      if (pageName) {
        pageSlug = await findUniqueSlug(slugify(pageName));
      }

      setPreviewData({ services, name: pageName, slug: pageSlug });
      setCollapsed(true);

      toast({
        title: "Diagram analyzed!",
        description: `Found ${services.length} services. ${data.summary || ""}`,
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

  const hasImage = !!imageBase64 || !!imageUrl.trim();

  return (
    <div className="space-y-6" onPaste={handlePaste}>
      {/* Input section */}
      <section
        className={`border rounded-xl p-6 transition-colors duration-300 ${
          collapsed
            ? "border-primary bg-accent cursor-pointer"
            : "border-border bg-card"
        }`}
      >
        <div
          className={`flex items-center justify-between ${previewData ? "cursor-pointer" : ""}`}
          onClick={previewData ? () => setCollapsed(!collapsed) : undefined}
        >
          <h2 className="text-lg font-semibold flex items-center gap-2 text-card-foreground transition-colors duration-300">
            <Network className="h-5 w-5" />
            System Diagram
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
            collapsed ? "max-h-0 opacity-0 mt-0" : "max-h-[800px] opacity-100 mt-4"
          }`}
        >
          <div className="space-y-4">
            {/* Image preview or upload area */}
            {imagePreview ? (
              <div className="relative border border-border rounded-lg overflow-hidden bg-muted/50">
                <img
                  src={imagePreview}
                  alt="System diagram"
                  className="w-full max-h-[400px] object-contain"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 h-8 w-8"
                  onClick={(e) => { e.stopPropagation(); clearImage(); }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div
                ref={dropZoneRef}
                tabIndex={0}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors outline-none ring-0 ${
                  dragOver ? "border-primary bg-accent/50" : "border-border focus:border-primary/60"
                }`}
              >
                <div className="flex flex-col items-center gap-3">
                  <Image className="h-10 w-10 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-card-foreground">
                      Drop your diagram here, or paste from clipboard
                    </p>
                    <p className="text-xs text-muted-foreground">
                      PNG, JPG, WebP, GIF — up to 20MB
                    </p>
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4 mr-1" />
                      Browse Files
                    </Button>
                    <span className="text-xs text-muted-foreground">or</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMode("url")}
                    >
                      <Link className="h-4 w-4 mr-1" />
                      Use URL
                    </Button>
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) processFile(file);
                  }}
                />
              </div>
            )}

            {/* URL input */}
            {mode === "url" && !imagePreview && (
              <div className="flex gap-3">
                <Input
                  placeholder="https://example.com/diagram.png"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && imageUrl.trim()) handleAnalyze();
                  }}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setMode("idle"); setImageUrl(""); }}
                >
                  Cancel
                </Button>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                AI will identify services and components from your diagram.
              </p>
              <Button
                onClick={(e) => { e.stopPropagation(); handleAnalyze(); }}
                disabled={analyzing || !hasImage}
                className="shrink-0"
              >
                {analyzing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Network className="h-4 w-4 mr-1" />
                )}
                {analyzing ? "Analyzing..." : previewData ? "Re-analyze" : "Analyze Diagram"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Preview */}
      {previewData && (
        <StatusPagePreview
          initialServices={previewData.services}
          initialIncidents={[]}
          initialName={previewData.name}
          initialSlug={previewData.slug}
          navigateTo={navigateTo}
        />
      )}
    </div>
  );
}
