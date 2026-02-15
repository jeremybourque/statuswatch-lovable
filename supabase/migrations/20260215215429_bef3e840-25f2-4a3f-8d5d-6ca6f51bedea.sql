
-- Status pages table
CREATE TABLE public.status_pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  logo_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.status_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON public.status_pages FOR SELECT USING (true);

CREATE TRIGGER update_status_pages_updated_at
  BEFORE UPDATE ON public.status_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add status_page_id to services and incidents
ALTER TABLE public.services ADD COLUMN status_page_id UUID REFERENCES public.status_pages(id) ON DELETE CASCADE;
ALTER TABLE public.incidents ADD COLUMN status_page_id UUID REFERENCES public.status_pages(id) ON DELETE CASCADE;

-- Create indexes
CREATE INDEX idx_services_status_page ON public.services (status_page_id);
CREATE INDEX idx_incidents_status_page ON public.incidents (status_page_id);

-- Seed a default status page and link existing data
INSERT INTO public.status_pages (id, name, slug, description) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'StatusWatch', 'statuswatch', 'Main system status page');

UPDATE public.services SET status_page_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
UPDATE public.incidents SET status_page_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Make status_page_id NOT NULL after backfill
ALTER TABLE public.services ALTER COLUMN status_page_id SET NOT NULL;
ALTER TABLE public.incidents ALTER COLUMN status_page_id SET NOT NULL;
