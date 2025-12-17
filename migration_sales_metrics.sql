-- migration_sales_metrics.sql

-- 1. Add video_id column to yt_links if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'yt_links' AND column_name = 'video_id') THEN
        ALTER TABLE public.yt_links ADD COLUMN video_id TEXT;
    END IF;
END $$;

-- 2. Create hubspot_negocios table
CREATE TABLE IF NOT EXISTS public.hubspot_negocios (
    id TEXT PRIMARY KEY,
    utm_content TEXT,
    amount NUMERIC,
    dealstage TEXT,
    closedate TIMESTAMP WITH TIME ZONE,
    owner_name TEXT,
    products TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Enable RLS and Policies
ALTER TABLE public.hubspot_negocios ENABLE ROW LEVEL SECURITY;

-- Allow public access (or restrict as needed, keeping open for now matching unrestricted tables)
CREATE POLICY "Enable read access for all users" ON public.hubspot_negocios FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON public.hubspot_negocios FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON public.hubspot_negocios FOR UPDATE USING (true);
CREATE POLICY "Enable delete for all users" ON public.hubspot_negocios FOR DELETE USING (true);
