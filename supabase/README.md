# Supabase setup

1. Create a Supabase project.
2. Run `schema.sql` in the SQL editor.
3. Copy the project URL and anon key into `.env.local` using `.env.example`.
4. Enable Email auth. Phone fields remain available in the schema for a later OTP integration, but phone auth is not required.
5. To enable the Google button, open **Authentication > Sign In / Providers > Google** in Supabase, enable Google, and add the Google OAuth client ID and client secret from Google Cloud Console. Set the Google OAuth redirect URI to:

```text
https://<your-project-ref>.supabase.co/auth/v1/callback
```

Set the Supabase **Site URL** and additional redirect URLs to the origins where this app runs, for example `http://127.0.0.1:5173` for local development and your production app URL after deployment.
6. Create the first operator account, then promote it from the SQL editor:

```sql
update public.profiles
set role = 'operator'
where email = 'operator@example.com';
```

The schema backfills profiles for accounts created before the schema was installed. This matters because Supabase Auth users and application profiles are separate records.

The document bucket is private. Files are stored under `<user-id>/<job-id>/<filename>` and must only be served through authenticated signed URLs or the Windows print agent. `print_jobs` is enabled for Supabase Realtime so dashboards receive queue changes without polling.
