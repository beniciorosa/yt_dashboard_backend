CREATE TABLE IF NOT EXISTS public.allowed_users (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    email TEXT,
    full_name TEXT,
    role TEXT,
    is_active BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.allowed_users ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cta_presets (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    preset_name TEXT,
    text TEXT,
    url TEXT,
    position TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.cta_presets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.custom_links (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    preset_name TEXT,
    title TEXT,
    url TEXT,
    position TEXT,
    order_index TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.custom_links ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.projects (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT,
    video_title TEXT,
    final_description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.reply_examples (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    comment_text TEXT,
    reply_text TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.reply_examples ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.social_presets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT,
    preset_name TEXT,
    instagram_username TEXT,
    x_username TEXT,
    youtube_username TEXT,
    tiktok_username TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.social_presets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.yt_links (
    id TEXT PRIMARY KEY,
    title TEXT,
    publish_date TIMESTAMP WITH TIME ZONE,
    base_url TEXT,
    slug TEXT,
    utm_content TEXT,
    final_url TEXT,
    short_code TEXT,
    short_url TEXT,
    is_draft BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.yt_links ENABLE ROW LEVEL SECURITY;

