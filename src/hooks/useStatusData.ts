import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Service, Incident, ServiceStatus } from "@/lib/statusData";

async function fetchServices(): Promise<Service[]> {
  const { data: services, error: sErr } = await supabase
    .from("services")
    .select("*")
    .order("display_order");

  if (sErr) throw sErr;

  const { data: uptimeDays, error: uErr } = await supabase
    .from("uptime_days")
    .select("service_id, day, up")
    .order("day", { ascending: true });

  if (uErr) throw uErr;

  const uptimeMap = new Map<string, boolean[]>();
  for (const row of uptimeDays ?? []) {
    if (!uptimeMap.has(row.service_id)) uptimeMap.set(row.service_id, []);
    uptimeMap.get(row.service_id)!.push(row.up);
  }

  return (services ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status as ServiceStatus,
    uptime: Number(s.uptime),
    uptimeDays: uptimeMap.get(s.id) ?? [],
  }));
}

async function fetchIncidents(): Promise<Incident[]> {
  const { data: incidents, error: iErr } = await supabase
    .from("incidents")
    .select("*")
    .order("created_at", { ascending: false });

  if (iErr) throw iErr;

  const { data: updates, error: uErr } = await supabase
    .from("incident_updates")
    .select("*")
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
}

export function useServices() {
  return useQuery({
    queryKey: ["services"],
    queryFn: fetchServices,
  });
}

export function useIncidents() {
  return useQuery({
    queryKey: ["incidents"],
    queryFn: fetchIncidents,
  });
}
