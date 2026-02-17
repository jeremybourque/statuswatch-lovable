import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useStatusPage } from "@/hooks/useStatusData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowLeft, Plus, Loader2, Trash2, Pencil, Check, X, AlertTriangle } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { statusConfig, type ServiceStatus } from "@/lib/statusData";

/* ─── helpers ─── */

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/* ─── types & constants ─── */

interface ServiceRow {
  id: string;
  name: string;
  status: string;
  uptime: number;
  display_order: number;
  parent_id: string | null;
}

interface IncidentRow {
  id: string;
  title: string;
  status: string;
  impact: string;
  created_at: string;
}

const STATUS_OPTIONS: { value: ServiceStatus; label: string }[] = [
  { value: "operational", label: "Operational" },
  { value: "degraded", label: "Degraded Performance" },
  { value: "partial", label: "Partial Outage" },
  { value: "major", label: "Major Outage" },
  { value: "maintenance", label: "Under Maintenance" },
];

const INCIDENT_STATUS_OPTIONS = [
  { value: "investigating", label: "Investigating" },
  { value: "identified", label: "Identified" },
  { value: "monitoring", label: "Monitoring" },
  { value: "resolved", label: "Resolved" },
];

const INCIDENT_IMPACT_OPTIONS: { value: ServiceStatus; label: string }[] = [
  { value: "major", label: "Major" },
  { value: "partial", label: "Partial" },
  { value: "degraded", label: "Degraded" },
  { value: "maintenance", label: "Maintenance" },
];

/* ─── hooks ─── */

function useAdminServices(pageId: string | undefined) {
  return useQuery({
    queryKey: ["admin-services", pageId],
    enabled: !!pageId,
    queryFn: async (): Promise<ServiceRow[]> => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, status, uptime, display_order, parent_id")
        .eq("status_page_id", pageId!)
        .order("display_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useAdminIncidents(pageId: string | undefined) {
  return useQuery({
    queryKey: ["admin-incidents", pageId],
    enabled: !!pageId,
    queryFn: async (): Promise<IncidentRow[]> => {
      const { data, error } = await supabase
        .from("incidents")
        .select("id, title, status, impact, created_at")
        .eq("status_page_id", pageId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/* ─── Page Details Section ─── */

function PageDetailsSection({
  page,
}: {
  page: { id: string; name: string; slug: string; description: string | null };
}) {
  const [editing, setEditing] = useState(true);
  const [editName, setEditName] = useState(page.name);
  const [editSlug, setEditSlug] = useState(page.slug);
  const [editDesc, setEditDesc] = useState(page.description ?? "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const startEdit = () => {
    setEditName(page.name);
    setEditSlug(page.slug);
    setEditDesc(page.description ?? "");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editName.trim() || !editSlug.trim()) {
      toast({ title: "Name and slug are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const newSlug = editSlug.trim();
    const { error } = await supabase
      .from("status_pages")
      .update({
        name: editName.trim(),
        slug: newSlug,
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
    toast({ title: "Page details updated!" });
    setEditing(false);
    queryClient.invalidateQueries({ queryKey: ["status-page"] });
    queryClient.invalidateQueries({ queryKey: ["status-pages"] });
    if (newSlug !== page.slug) {
      navigate(`/admin/${newSlug}/services`, { replace: true });
    }
  };

  if (!editing) {
    return (
      <div className="border border-border rounded-lg bg-card px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-card-foreground">{page.name}</p>
            <p className="text-xs text-muted-foreground font-mono">/{page.slug}</p>
            {page.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{page.description}</p>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={startEdit}>
            <Pencil className="h-4 w-4" />
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
        <Button size="sm" onClick={saveEdit} disabled={saving || !editName.trim() || !editSlug.trim() || (editName.trim() === page.name && editSlug === page.slug && (editDesc.trim() || "") === (page.description ?? ""))}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          <X className="h-3.5 w-3.5 mr-1" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ─── Editable Service ─── */

function EditableService({
  service,
  onDelete,
}: {
  service: ServiceRow;
  onDelete: (id: string, name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(service.name);
  const [editStatus, setEditStatus] = useState(service.status);
  const [editUptime, setEditUptime] = useState(String(service.uptime));
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const startEdit = () => {
    setEditName(service.name);
    setEditStatus(service.status);
    setEditUptime(String(service.uptime));
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editName.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const uptimeNum = parseFloat(editUptime);
    if (isNaN(uptimeNum) || uptimeNum < 0 || uptimeNum > 100) {
      toast({ title: "Uptime must be between 0 and 100", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("services")
      .update({ name: editName.trim(), status: editStatus, uptime: uptimeNum })
      .eq("id", service.id);
    setSaving(false);
    if (error) {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Service updated!" });
    setEditing(false);
    queryClient.invalidateQueries({ queryKey: ["admin-services"] });
  };

  const config = statusConfig[service.status as ServiceStatus] ?? statusConfig.operational;

  if (!editing) {
    return (
      <div className="flex items-center justify-between border border-border rounded-lg bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={`inline-flex h-2.5 w-2.5 rounded-full ${config.dotClass}`} />
          <div>
            <p className="text-sm font-semibold text-card-foreground">{service.name}</p>
            <p className={`text-xs font-medium ${config.colorClass}`}>{config.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground font-mono mr-2">{service.uptime}%</span>
          <Button variant="ghost" size="icon" onClick={startEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => onDelete(service.id, service.name)}>
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
          <Label className="text-xs">Status</Label>
          <Select value={editStatus} onValueChange={setEditStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Uptime %</Label>
          <Input type="number" min="0" max="100" step="0.01" value={editUptime} onChange={(e) => setEditUptime(e.target.value)} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={saveEdit} disabled={saving || !editName.trim()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          <X className="h-3.5 w-3.5 mr-1" />
          Cancel
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive ml-auto" onClick={() => onDelete(service.id, service.name)}>
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
      </div>
    </div>
  );
}

/* ─── Editable Incident ─── */

function EditableIncident({
  incident,
  onDelete,
}: {
  incident: IncidentRow;
  onDelete: (id: string, title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(incident.title);
  const [editStatus, setEditStatus] = useState(incident.status);
  const [editImpact, setEditImpact] = useState(incident.impact);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const startEdit = () => {
    setEditTitle(incident.title);
    setEditStatus(incident.status);
    setEditImpact(incident.impact);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editTitle.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("incidents")
      .update({ title: editTitle.trim(), status: editStatus, impact: editImpact })
      .eq("id", incident.id);
    setSaving(false);
    if (error) {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Incident updated!" });
    setEditing(false);
    queryClient.invalidateQueries({ queryKey: ["admin-incidents"] });
  };

  if (!editing) {
    return (
      <div className="flex items-center justify-between border border-border rounded-lg bg-card px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-card-foreground">{incident.title}</p>
          <p className="text-xs text-muted-foreground">
            {incident.status} · {incident.impact} · {new Date(incident.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={startEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => onDelete(incident.id, incident.title)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-primary/30 rounded-lg bg-card px-4 py-4 space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Title</Label>
        <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={editStatus} onValueChange={setEditStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {INCIDENT_STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Impact</Label>
          <Select value={editImpact} onValueChange={setEditImpact}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {INCIDENT_IMPACT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={saveEdit} disabled={saving || !editTitle.trim()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          <X className="h-3.5 w-3.5 mr-1" />
          Cancel
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive ml-auto" onClick={() => onDelete(incident.id, incident.title)}>
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
      </div>
    </div>
  );
}

/* ─── Main Page ─── */

const AdminServices = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: page, isLoading: pageLoading } = useStatusPage(slug ?? "");
  const { data: services = [], isLoading: servicesLoading } = useAdminServices(page?.id);
  const { data: incidents = [], isLoading: incidentsLoading } = useAdminIncidents(page?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Service add form
  const [addingName, setAddingName] = useState("");
  const [addingStatus, setAddingStatus] = useState<string>("operational");
  const [showAddService, setShowAddService] = useState(false);
  const [creatingService, setCreatingService] = useState(false);

  // Incident add form
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentStatus, setIncidentStatus] = useState("investigating");
  const [incidentImpact, setIncidentImpact] = useState("major");
  const [showAddIncident, setShowAddIncident] = useState(false);
  const [creatingIncident, setCreatingIncident] = useState(false);

  const handleAddService = async () => {
    if (!addingName.trim() || !page) return;
    setCreatingService(true);
    const nextOrder = services.length > 0 ? Math.max(...services.map((s) => s.display_order)) + 1 : 0;
    const { error } = await supabase.from("services").insert({
      name: addingName.trim(),
      status: addingStatus,
      status_page_id: page.id,
      display_order: nextOrder,
    });
    setCreatingService(false);
    if (error) {
      toast({ title: "Failed to add service", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Service added!" });
    setAddingName("");
    setAddingStatus("operational");
    setShowAddService(false);
    queryClient.invalidateQueries({ queryKey: ["admin-services", page.id] });
  };

  const handleDeleteService = async (id: string, name: string) => {
    if (!confirm(`Delete service "${name}"?`)) return;
    const { error } = await supabase.from("services").delete().eq("id", id);
    if (error) {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `"${name}" deleted` });
    queryClient.invalidateQueries({ queryKey: ["admin-services"] });
  };

  const handleAddIncident = async () => {
    if (!incidentTitle.trim() || !page) return;
    setCreatingIncident(true);
    const { error } = await supabase.from("incidents").insert({
      title: incidentTitle.trim(),
      status: incidentStatus,
      impact: incidentImpact,
      status_page_id: page.id,
    });
    setCreatingIncident(false);
    if (error) {
      toast({ title: "Failed to add incident", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Incident added!" });
    setIncidentTitle("");
    setIncidentStatus("investigating");
    setIncidentImpact("major");
    setShowAddIncident(false);
    queryClient.invalidateQueries({ queryKey: ["admin-incidents", page.id] });
  };

  const handleDeleteIncident = async (id: string, title: string) => {
    if (!confirm(`Delete incident "${title}"?`)) return;
    const { error } = await supabase.from("incidents").delete().eq("id", id);
    if (error) {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `"${title}" deleted` });
    queryClient.invalidateQueries({ queryKey: ["admin-incidents"] });
  };

  const handleDeletePage = async () => {
    if (!page) return;
    if (!confirm(`Delete "${page.name}"? This will also delete all its services and incidents and cannot be undone.`)) return;
    const { error } = await supabase.from("status_pages").delete().eq("id", page.id);
    if (error) {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `"${page.name}" deleted` });
    queryClient.invalidateQueries({ queryKey: ["status-pages"] });
    navigate("/admin");
  };

  const isLoading = pageLoading || servicesLoading || incidentsLoading;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center gap-3">
          <Activity className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              {page ? page.name : "Edit Status Page"}
            </h1>
            <p className="text-xs text-muted-foreground">Manage page details, services & incidents</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleDeletePage}>
              <Trash2 className="h-4 w-4 mr-1" />
              Delete Page
            </Button>
            <Link to="/admin">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !page ? (
        <div className="max-w-4xl mx-auto px-4 py-16 text-center text-muted-foreground">
          Status page not found.
        </div>
      ) : (
        <main className="max-w-4xl mx-auto px-4 py-8">
          <Tabs defaultValue="details">
            <TabsList className="mb-6">
              <TabsTrigger value="details">Page Details</TabsTrigger>
              <TabsTrigger value="services">Services</TabsTrigger>
              <TabsTrigger value="incidents">Incidents</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-3">
              <PageDetailsSection page={page} />
            </TabsContent>

            <TabsContent value="services" className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Services</h2>
                {!showAddService && (
                  <Button size="sm" onClick={() => setShowAddService(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Service
                  </Button>
                )}
              </div>

              {showAddService && (
                <div className="border border-primary/30 rounded-lg bg-card px-4 py-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Name</Label>
                      <Input placeholder="e.g. API Server" value={addingName} onChange={(e) => setAddingName(e.target.value)} autoFocus />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Status</Label>
                      <Select value={addingStatus} onValueChange={setAddingStatus}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={handleAddService} disabled={creatingService || !addingName.trim()}>
                      {creatingService ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowAddService(false)}>
                      <X className="h-3.5 w-3.5 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {services.length === 0 && !showAddService ? (
                <p className="text-muted-foreground text-sm">No services yet. Add one to get started.</p>
              ) : (
                <div className="space-y-2">
                  {services.map((service) => (
                    <EditableService key={service.id} service={service} onDelete={handleDeleteService} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="incidents" className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Incidents
                </h2>
                {!showAddIncident && (
                  <Button size="sm" onClick={() => setShowAddIncident(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Incident
                  </Button>
                )}
              </div>

              {showAddIncident && (
                <div className="border border-primary/30 rounded-lg bg-card px-4 py-4 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Title</Label>
                    <Input placeholder="e.g. API degraded performance" value={incidentTitle} onChange={(e) => setIncidentTitle(e.target.value)} autoFocus />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Status</Label>
                      <Select value={incidentStatus} onValueChange={setIncidentStatus}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {INCIDENT_STATUS_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Impact</Label>
                      <Select value={incidentImpact} onValueChange={setIncidentImpact}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {INCIDENT_IMPACT_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={handleAddIncident} disabled={creatingIncident || !incidentTitle.trim()}>
                      {creatingIncident ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowAddIncident(false)}>
                      <X className="h-3.5 w-3.5 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {incidents.length === 0 && !showAddIncident ? (
                <p className="text-muted-foreground text-sm">No incidents yet.</p>
              ) : (
                <div className="space-y-2">
                  {incidents.map((incident) => (
                    <EditableIncident key={incident.id} incident={incident} onDelete={handleDeleteIncident} />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </main>
      )}
    </div>
  );
};

export default AdminServices;
