CREATE POLICY "Public insert uptime_days"
ON public.uptime_days
FOR INSERT
WITH CHECK (true);