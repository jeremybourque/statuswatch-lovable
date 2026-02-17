
-- Add parent_id column for hierarchical services
ALTER TABLE public.services ADD COLUMN parent_id uuid REFERENCES public.services(id) ON DELETE CASCADE;

-- Create index for efficient child lookups
CREATE INDEX idx_services_parent_id ON public.services(parent_id);

-- Migrate existing group_name data: create parent services and link children
DO $$
DECLARE
  rec RECORD;
  parent_uuid uuid;
BEGIN
  -- For each unique (status_page_id, group_name) combo, create a parent service
  FOR rec IN
    SELECT DISTINCT status_page_id, group_name, MIN(display_order) as min_order
    FROM public.services
    WHERE group_name IS NOT NULL
    GROUP BY status_page_id, group_name
  LOOP
    parent_uuid := gen_random_uuid();
    
    -- Insert parent service
    INSERT INTO public.services (id, name, status, status_page_id, display_order, group_name, uptime)
    VALUES (parent_uuid, rec.group_name, 'operational', rec.status_page_id, rec.min_order, NULL, 99.99);
    
    -- Link existing children to this parent
    UPDATE public.services
    SET parent_id = parent_uuid, group_name = NULL
    WHERE status_page_id = rec.status_page_id
      AND group_name = rec.group_name
      AND id != parent_uuid;
  END LOOP;
END $$;
