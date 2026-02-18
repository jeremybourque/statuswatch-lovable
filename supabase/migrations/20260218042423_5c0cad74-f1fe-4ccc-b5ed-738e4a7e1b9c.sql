
CREATE TABLE public.resources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('status_page', 'system_diagram', 'incident_description')),
  name TEXT NOT NULL,
  url TEXT,
  content TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON public.resources FOR SELECT USING (true);
CREATE POLICY "Public insert access" ON public.resources FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update access" ON public.resources FOR UPDATE USING (true);
CREATE POLICY "Public delete access" ON public.resources FOR DELETE USING (true);
