-- Allow public inserts on services (existing policy only allows admin inserts)
CREATE POLICY "Public insert services"
ON public.services
FOR INSERT
WITH CHECK (true);

-- Allow public updates on services
CREATE POLICY "Public update services"
ON public.services
FOR UPDATE
USING (true);

-- Allow public deletes on services
CREATE POLICY "Public delete services"
ON public.services
FOR DELETE
USING (true);