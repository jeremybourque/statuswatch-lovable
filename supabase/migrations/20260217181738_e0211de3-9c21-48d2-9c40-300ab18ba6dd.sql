-- Allow public insert on incidents (matching existing public access pattern)
CREATE POLICY "Public insert incidents"
ON public.incidents
FOR INSERT
WITH CHECK (true);

-- Allow public insert on incident_updates
CREATE POLICY "Public insert incident_updates"
ON public.incident_updates
FOR INSERT
WITH CHECK (true);