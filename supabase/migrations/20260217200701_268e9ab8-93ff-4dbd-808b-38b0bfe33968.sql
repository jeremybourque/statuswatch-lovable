
-- Allow public update on incidents
CREATE POLICY "Public update incidents"
ON public.incidents
FOR UPDATE
USING (true);

-- Allow public delete on incidents
CREATE POLICY "Public delete incidents"
ON public.incidents
FOR DELETE
USING (true);

-- Allow public update on incident_updates
CREATE POLICY "Public update incident_updates"
ON public.incident_updates
FOR UPDATE
USING (true);

-- Allow public delete on incident_updates
CREATE POLICY "Public delete incident_updates"
ON public.incident_updates
FOR DELETE
USING (true);
