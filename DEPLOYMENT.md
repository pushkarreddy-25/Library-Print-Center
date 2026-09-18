# Deployment contract

## Web application

The React application is deployable to Vercel, Netlify, Cloudflare Pages, or another static hosting provider. The host only needs the Vite build output and these environment variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_STORAGE_BUCKET=print-documents
VITE_PRINT_AGENT_URL=http://127.0.0.1:8787
```

Changing from a temporary host to a custom domain does not require application changes. Configure the new domain in the hosting provider and update Supabase Auth redirect URLs/site URL.

## Supabase

- Auth: email/password for V1.
- Database: PostgreSQL.
- Realtime: `public.print_jobs` publication.
- Storage: private bucket `print-documents`.
- Frontend uses only the publishable/anon key.
- The service-role key belongs only in trusted server-side or Edge Function secrets, if needed later.

Run `supabase/schema.sql` in the Supabase SQL editor before creating accounts.

## Storage

Files are stored privately at `<user-id>/<job-id>/<filename>`. The storage adapter is isolated in `src/lib/printCenterApi.js`, so a future S3/R2 adapter can replace it without changing the student workflow.

## Printer boundary

The cloud application never accesses USB, Wi-Fi, or Ethernet printers directly. The Windows Print Agent on the operator PC owns printer communication and reports lifecycle status back to the backend. See `windows-print-agent/README.md`.
