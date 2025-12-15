-- Enable public access for allowed_users
CREATE POLICY "Enable read access for all users" ON "public"."allowed_users"
AS PERMISSIVE FOR SELECT
TO public
USING (true);

-- Enable public access for cta_presets
CREATE POLICY "Enable all access for all users" ON "public"."cta_presets"
AS PERMISSIVE FOR ALL
TO public
USING (true);

-- Enable public access for custom_links
CREATE POLICY "Enable all access for all users" ON "public"."custom_links"
AS PERMISSIVE FOR ALL
TO public
USING (true);

-- Enable public access for projects
CREATE POLICY "Enable all access for all users" ON "public"."projects"
AS PERMISSIVE FOR ALL
TO public
USING (true);

-- Enable public access for reply_examples
CREATE POLICY "Enable all access for all users" ON "public"."reply_examples"
AS PERMISSIVE FOR ALL
TO public
USING (true);

-- Enable public access for social_presets
CREATE POLICY "Enable all access for all users" ON "public"."social_presets"
AS PERMISSIVE FOR ALL
TO public
USING (true);

-- Enable public access for yt_links
CREATE POLICY "Enable all access for all users" ON "public"."yt_links"
AS PERMISSIVE FOR ALL
TO public
USING (true);
