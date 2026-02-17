import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useStatusPage } from "@/hooks/useStatusData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowLeft, Plus, Loader2, Trash2, Pencil, Check, X, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { statusConfig, type ServiceStatus } from "@/lib/statusData";

interface ServiceRow {
  id: string;
  name: string;
  status: string;
  uptime: number;
  display_order: number;
  parent_id: string | null;
}

const STATUS_OPTIONS: { value: ServiceStatus; label: string }[] = [
  { value: "operational", label: "Operational" },
  { value: "degraded", label: "Degraded Performance" },
  { value: "partial", label: "Partial Outage" },
  { value: "major", label: "Major Outage" },
  { value: "maintenance", label: "Under Maintenance" },
];

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
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            onClick={() => onDelete(service.id, service.name)}
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
          <Label className="text-xs">Status</Label>
          <Select value={editStatus} onValueChange={setEditStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
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
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive ml-auto"
          onClick={() => onDelete(service.id, service.name)}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
      </div>
    </div>
  );
}

const AdminServices = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: page, isLoading: pageLoading } = useStatusPage(slug ?? "");
  const { data: services = [], isLoading: servicesLoading } = useAdminServices(page?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [addingName, setAddingName] = useState("");
  const [addingStatus, setAddingStatus] = useState<string>("operational");
  const [showAddForm, setShowAddForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleAdd = async () => {
    if (!addingName.trim() || !page) return;
    setCreating(true);
    const nextOrder = services.length > 0 ? Math.max(...services.map((s) => s.display_order)) + 1 : 0;
    const { error } = await supabase.from("services").insert({
      name: addingName.trim(),
      status: addingStatus,
      status_page_id: page.id,
      display_order: nextOrder,
    });
    setCreating(false);
    if (error) {
      toast({ title: "Failed to add service", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Service added!" });
    setAddingName("");
    setAddingStatus("operational");
    setShowAddForm(false);
    queryClient.invalidateQueries({ queryKey: ["admin-services", page.id] });
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete service "${name}"?`)) return;
    const { error } = await supabase.from("services").delete().eq("id", id);
    if (error) {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `"${name}" deleted` });
    queryClient.invalidateQueries({ queryKey: ["admin-services"] });
  };

  const isLoading = pageLoading || servicesLoading;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center gap-3">
          <Activity className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              {page ? page.name : "Services"}
            </h1>
            <p className="text-xs text-muted-foreground">Manage services</p>
          </div>
          <Link to="/admin" className="ml-auto">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Services</h2>
          {!showAddForm && (
            <Button size="sm" onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Service
            </Button>
          )}
        </div>

        {showAddForm && (
          <div className="border border-primary/30 rounded-lg bg-card px-4 py-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  placeholder="e.g. API Server"
                  value={addingName}
                  onChange={(e) => setAddingName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={addingStatus} onValueChange={setAddingStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleAdd} disabled={creating || !addingName.trim()}>
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>
                <X className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : services.length === 0 && !showAddForm ? (
          <p className="text-muted-foreground text-sm">No services yet. Add one to get started.</p>
        ) : (
          <div className="space-y-2">
            {services.map((service) => (
              <EditableService key={service.id} service={service} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminServices;
