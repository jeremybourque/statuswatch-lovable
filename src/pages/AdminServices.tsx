import { useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { useStatusPage } from "@/hooks/useStatusData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowLeft, Plus, Loader2, Trash2, Pencil, Check, X, AlertTriangle, ChevronDown, Search } from "lucide-react";
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

function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalDatetime(local: string): string {
  return new Date(local).toISOString();
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
  resolved_at: string | null;
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
        .select("id, title, status, impact, created_at, resolved_at")
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
  const [editName, setEditName] = useState(page.name);
  const [editSlug, setEditSlug] = useState(page.slug);
  const [editDesc, setEditDesc] = useState(page.description ?? "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const hasChanges = editName.trim() !== page.name || editSlug !== page.slug || (editDesc.trim() || "") !== (page.description ?? "");

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
    queryClient.invalidateQueries({ queryKey: ["status-page"] });
    queryClient.invalidateQueries({ queryKey: ["status-pages"] });
    if (newSlug !== page.slug) {
      navigate(`/admin/${newSlug}/services`, { replace: true });
    }
  };

  return (
    <div className="border border-border rounded-lg bg-card px-4 py-4 space-y-3">
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
        <Button size="sm" onClick={saveEdit} disabled={saving || !editName.trim() || !editSlug.trim() || !hasChanges}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
          Save
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
      <div className="bg-card hover:bg-accent/50 transition-colors">
        <div className="w-full flex items-center justify-between p-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="relative flex h-3 w-3">
              {service.status !== "operational" && (
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.dotClass} opacity-75`} />
              )}
              <span className={`relative inline-flex rounded-full h-3 w-3 ${config.dotClass}`} />
            </span>
            <span className="font-medium text-card-foreground truncate">{service.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${config.colorClass}`}>{config.label}</span>
            <span className="text-xs text-muted-foreground font-mono w-14 text-right">{service.uptime}%</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={startEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete(service.id, service.name)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
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

/* ─── Incident Update Row ─── */

interface IncidentUpdateRow {
  id: string;
  status: string;
  message: string;
  created_at: string;
}

function EditableUpdate({
  update,
  onDelete,
}: {
  update: IncidentUpdateRow;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editStatus, setEditStatus] = useState(update.status);
  const [editMessage, setEditMessage] = useState(update.message);
  const [editTimestamp, setEditTimestamp] = useState(toLocalDatetime(update.created_at));
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const saveEdit = async () => {
    if (!editMessage.trim()) {
      toast({ title: "Message is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("incident_updates")
      .update({ status: editStatus, message: editMessage.trim(), created_at: fromLocalDatetime(editTimestamp) })
      .eq("id", update.id);
    setSaving(false);
    if (error) {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Update saved!" });
    setEditing(false);
    queryClient.invalidateQueries({ queryKey: ["admin-incident-updates"] });
  };

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-2 py-2">
        <div className="min-w-0">
          <span className="text-xs font-semibold capitalize text-muted-foreground">{update.status}</span>
          <span className="text-xs text-muted-foreground ml-1">— {new Date(update.created_at).toLocaleString()}</span>
          <p className="text-sm text-card-foreground mt-0.5">{update.message}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditStatus(update.status); setEditMessage(update.message); setEditTimestamp(toLocalDatetime(update.created_at)); setEditing(true); }}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(update.id)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-primary/30 rounded-md bg-muted/30 px-3 py-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={editStatus} onValueChange={setEditStatus}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {INCIDENT_STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Timestamp</Label>
          <Input type="datetime-local" className="h-8" value={editTimestamp} onChange={(e) => setEditTimestamp(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Message</Label>
        <Textarea value={editMessage} onChange={(e) => setEditMessage(e.target.value)} rows={2} />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={saveEdit} disabled={saving || !editMessage.trim()}>
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

/* ─── Incident Updates Panel ─── */

function IncidentUpdatesPanel({ incidentId }: { incidentId: string }) {
  const { data: updates = [], isLoading } = useQuery({
    queryKey: ["admin-incident-updates", incidentId],
    queryFn: async (): Promise<IncidentUpdateRow[]> => {
      const { data, error } = await supabase
        .from("incident_updates")
        .select("id, status, message, created_at")
        .eq("incident_id", incidentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [showAdd, setShowAdd] = useState(false);
  const [addStatus, setAddStatus] = useState("investigating");
  const [addMessage, setAddMessage] = useState("");
  const [addTimestamp, setAddTimestamp] = useState(toLocalDatetime(new Date().toISOString()));
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleAdd = async () => {
    if (!addMessage.trim()) return;
    setCreating(true);
    const { error } = await supabase.from("incident_updates").insert({
      incident_id: incidentId,
      status: addStatus,
      message: addMessage.trim(),
      created_at: fromLocalDatetime(addTimestamp),
    });
    setCreating(false);
    if (error) {
      toast({ title: "Failed to add update", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Update added!" });
    setAddMessage("");
    setAddStatus("investigating");
    setAddTimestamp(toLocalDatetime(new Date().toISOString()));
    setShowAdd(false);
    queryClient.invalidateQueries({ queryKey: ["admin-incident-updates", incidentId] });
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this update?")) return;
    const { error } = await supabase.from("incident_updates").delete().eq("id", id);
    if (error) {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["admin-incident-updates", incidentId] });
  };

  return (
    <div className="mt-3 border-t border-border pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Timeline Updates</p>
        {!showAdd && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAdd(true)}>
            <Plus className="h-3 w-3 mr-1" />
            Add Update
          </Button>
        )}
      </div>

      {showAdd && (
        <div className="border border-primary/30 rounded-md bg-muted/30 px-3 py-3 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={addStatus} onValueChange={setAddStatus}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INCIDENT_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Timestamp</Label>
            <Input type="datetime-local" className="h-8" value={addTimestamp} onChange={(e) => setAddTimestamp(e.target.value)} />
          </div>
        </div>
          <div className="space-y-1">
            <Label className="text-xs">Message</Label>
            <Textarea placeholder="Describe the update..." value={addMessage} onChange={(e) => setAddMessage(e.target.value)} rows={2} autoFocus />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleAdd} disabled={creating || !addMessage.trim()}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
              <X className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : updates.length === 0 && !showAdd ? (
        <p className="text-xs text-muted-foreground">No updates yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {updates.map((u) => (
            <EditableUpdate key={u.id} update={u} onDelete={handleDelete} />
          ))}
        </div>
      )}
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
  const [expanded, setExpanded] = useState(false);
  const [editTitle, setEditTitle] = useState(incident.title);
  const [editStatus, setEditStatus] = useState(incident.status);
  const [editImpact, setEditImpact] = useState(incident.impact);
  const [editStartTime, setEditStartTime] = useState(toLocalDatetime(incident.created_at));
  const [editResolvedAt, setEditResolvedAt] = useState(incident.resolved_at ? toLocalDatetime(incident.resolved_at) : "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const startEdit = () => {
    setEditTitle(incident.title);
    setEditStatus(incident.status);
    setEditImpact(incident.impact);
    setEditStartTime(toLocalDatetime(incident.created_at));
    setEditResolvedAt(incident.resolved_at ? toLocalDatetime(incident.resolved_at) : "");
    setEditing(true);
    setExpanded(true);
  };

  const saveEdit = async () => {
    if (!editTitle.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("incidents")
      .update({
        title: editTitle.trim(),
        status: editStatus,
        impact: editImpact,
        created_at: fromLocalDatetime(editStartTime),
        resolved_at: editResolvedAt ? fromLocalDatetime(editResolvedAt) : null,
      })
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
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => setExpanded(!expanded)} className="text-left min-w-0 flex-1">
            <p className="text-sm font-semibold text-card-foreground">{incident.title}</p>
            <p className="text-xs text-muted-foreground">
              {incident.status} · {incident.impact} · {new Date(incident.created_at).toLocaleDateString()}
            </p>
          </button>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" onClick={startEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => onDelete(incident.id, incident.title)}>
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setExpanded(!expanded)}>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
            </Button>
          </div>
        </div>
        {expanded && (
          <div className="px-4 pb-3">
            <IncidentUpdatesPanel incidentId={incident.id} />
          </div>
        )}
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
        <div className="space-y-1">
          <Label className="text-xs">Start Time</Label>
          <Input type="datetime-local" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Resolved At</Label>
          <Input type="datetime-local" value={editResolvedAt} onChange={(e) => setEditResolvedAt(e.target.value)} />
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
      <IncidentUpdatesPanel incidentId={incident.id} />
    </div>
  );
}

/* ─── Main Page ─── */

const AdminServices = () => {
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get("tab") || "details";
  const from = searchParams.get("from");

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
  const [serviceFilter, setServiceFilter] = useState("");

  // Incident add form
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentStatus, setIncidentStatus] = useState("investigating");
  const [incidentImpact, setIncidentImpact] = useState("major");
  const [showAddIncident, setShowAddIncident] = useState(false);
  const [creatingIncident, setCreatingIncident] = useState(false);
  const [incidentFilter, setIncidentFilter] = useState("");

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
    navigate(from === "status" ? `/${slug}` : from === "admin" ? "/admin" : "/");
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
            <Button variant="ghost" size="sm" onClick={() => navigate(from === "status" ? `/${slug}` : "/admin")}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
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
          <Tabs defaultValue={defaultTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="details">Page Details</TabsTrigger>
              <TabsTrigger value="services">Services ({services.length})</TabsTrigger>
              <TabsTrigger value="incidents">Incidents ({incidents.filter(i => i.status !== "resolved").length})</TabsTrigger>
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

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Find services..."
                  value={serviceFilter}
                  onChange={(e) => setServiceFilter(e.target.value)}
                  className="pl-9"
                />
              </div>

              {services.length === 0 && !showAddService ? (
                <p className="text-muted-foreground text-sm">No services yet. Add one to get started.</p>
              ) : (
                <div className="space-y-0 border border-border rounded-lg overflow-hidden">
                  {services
                    .filter((s) => s.name.toLowerCase().includes(serviceFilter.toLowerCase()))
                    .map((service, index, filtered) => (
                      <div
                        key={service.id}
                        className={index !== filtered.length - 1 ? "border-b border-border" : ""}
                      >
                        <EditableService service={service} onDelete={handleDeleteService} />
                      </div>
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

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Find incidents..."
                  value={incidentFilter}
                  onChange={(e) => setIncidentFilter(e.target.value)}
                  className="pl-9"
                />
              </div>

              {incidents.length === 0 && !showAddIncident ? (
                <p className="text-muted-foreground text-sm">No incidents yet.</p>
              ) : (
                <div className="space-y-2">
                  {incidents
                    .filter((i) => i.title.toLowerCase().includes(incidentFilter.toLowerCase()))
                    .map((incident) => (
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
