-- Create icons metadata table
CREATE TABLE IF NOT EXISTS public.icons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    icon_name TEXT UNIQUE NOT NULL, -- e.g., 'SP', 'MG'
    icon_info TEXT, -- Optional description or metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create icon files content table
CREATE TABLE IF NOT EXISTS public.icon_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    icon_id UUID NOT NULL REFERENCES public.icons(id) ON DELETE CASCADE,
    svg_content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(icon_id)
);

-- Index for faster lookup
CREATE INDEX IF NOT EXISTS idx_icons_name ON public.icons(icon_name);
