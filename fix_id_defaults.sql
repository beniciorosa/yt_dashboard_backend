-- Add default ID generation for tables missing it

-- allowed_users
ALTER TABLE public.allowed_users 
ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- cta_presets
ALTER TABLE public.cta_presets 
ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- custom_links
ALTER TABLE public.custom_links 
ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- projects
ALTER TABLE public.projects 
ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- yt_links
ALTER TABLE public.yt_links 
ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
