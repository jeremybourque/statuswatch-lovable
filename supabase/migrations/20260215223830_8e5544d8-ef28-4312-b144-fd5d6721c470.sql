-- Allow public inserts on status_pages (no auth required per user request)
CREATE POLICY "Public insert access"
ON public.status_pages
FOR INSERT
WITH CHECK (true);

-- Allow public updates on status_pages
CREATE POLICY "Public update access"
ON public.status_pages
FOR UPDATE
USING (true);

-- Allow public deletes on status_pages
CREATE POLICY "Public delete access"
ON public.status_pages
FOR DELETE
USING (true);