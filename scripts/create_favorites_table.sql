-- Execute este comando no SQL Editor do seu Supabase para corrigir o erro 500

CREATE TABLE IF NOT EXISTS public.comment_favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id TEXT UNIQUE NOT NULL,
    author_name TEXT,
    author_profile_image TEXT,
    content TEXT,
    video_id TEXT,
    video_title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE public.comment_favorites ENABLE ROW LEVEL SECURITY;

-- Criar política de acesso total (para fins de dashboard interno)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'comment_favorites' AND policyname = 'Allow all for now'
    ) THEN
        CREATE POLICY "Allow all for now" ON public.comment_favorites FOR ALL USING (true);
    END IF;
END
$$;
