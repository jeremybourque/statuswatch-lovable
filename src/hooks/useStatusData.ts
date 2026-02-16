import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Service, Incident, ServiceStatus } from "@/lib/statusData";

export interface StatusPage {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  created_at: string;
}

export function useStatusPages() {
  return useQuery({
    queryKey: ["status-pages"],
    queryFn: async (): Promise<StatusPage[]> => {
      const { data, error } = await supabase
        .from("status_pages")
        .select("*")
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useStatusPage(slug: string) {
  return useQuery({
    queryKey: ["status-page", slug],
    queryFn: async (): Promise<StatusPage | null> => {
      const { data, error } = await supabase
        .from("status_pages")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useServices(statusPageId: string | undefined) {
  return useQuery({
    queryKey: ["services", statusPageId],
    enabled: !!statusPageId,
    queryFn: async (): Promise<Service[]> => {
      const { data: services, error: sErr } = await supabase
        .from("services")
        .select("*")
        .eq("status_page_id", statusPageId!)
        .order("display_order");
      if (sErr) throw sErr;

      const serviceIds = (services ?? []).map((s) => s.id);
      if (serviceIds.length === 0) return [];

      const { data: uptimeDays, error: uErr } = await supabase
        .from("uptime_days")
        .select("service_id, day, up")
        .in("service_id", serviceIds)
        .order("day", { ascending: true });
      if (uErr) throw uErr;

      const uptimeMap = new Map<string, Map<string, boolean>>();
      for (const row of uptimeDays ?? []) {
        if (!uptimeMap.has(row.service_id)) uptimeMap.set(row.service_id, new Map());
        uptimeMap.get(row.service_id)!.set(row.day, row.up);
      }

      // Find the global date range across all services
      let globalMin: string | null = null;
      let globalMax: string | null = null;
      for (const [, dayMap] of uptimeMap) {
        for (const key of dayMap.keys()) {
          if (!globalMin || key < globalMin) globalMin = key;
          if (!globalMax || key > globalMax) globalMax = key;
        }
      }

      return (services ?? []).map((s) => {
        const dayMap = uptimeMap.get(s.id);
        let days: (boolean | null)[] = [];
        if (globalMin && globalMax) {
          const [sy, sm, sd] = globalMin.split("-").map(Number);
          const [ey, em, ed] = globalMax.split("-").map(Number);
          const start = new Date(sy, sm - 1, sd);
          const end = new Date(ey, em - 1, ed);
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            days.push(dayMap?.has(key) ? dayMap.get(key)! : null);
          }
        }
        return {
          id: s.id,
          name: s.name,
          status: s.status as ServiceStatus,
          uptime: Number(s.uptime),
          uptimeDays: days,
          group_name: s.group_name,
        };
      });
    },
  });
}

export function useIncidents(statusPageId: string | undefined) {
  return useQuery({
    queryKey: ["incidents", statusPageId],
    enabled: !!statusPageId,
    queryFn: async (): Promise<Incident[]> => {
      const { data: incidents, error: iErr } = await supabase
        .from("incidents")
        .select("*")
        .eq("status_page_id", statusPageId!)
        .order("created_at", { ascending: false });
      if (iErr) throw iErr;

      const incidentIds = (incidents ?? []).map((inc) => inc.id);
      if (incidentIds.length === 0) return [];

      const { data: updates, error: uErr } = await supabase
        .from("incident_updates")
        .select("*")
        .in("incident_id", incidentIds)
        .order("created_at", { ascending: false });
      if (uErr) throw uErr;

      const updatesMap = new Map<string, Incident["updates"]>();
      for (const u of updates ?? []) {
        if (!updatesMap.has(u.incident_id)) updatesMap.set(u.incident_id, []);
        updatesMap.get(u.incident_id)!.push({
          status: u.status as Incident["status"],
          message: u.message,
          timestamp: u.created_at,
        });
      }

      return (incidents ?? []).map((inc) => ({
        id: inc.id,
        title: inc.title,
        status: inc.status as Incident["status"],
        impact: inc.impact as ServiceStatus,
        createdAt: inc.created_at,
        updates: updatesMap.get(inc.id) ?? [],
      }));
    },
  });
}
