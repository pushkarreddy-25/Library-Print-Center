# Windows Print Agent

This process runs on the operator's Windows PC. It is the only component allowed to communicate with the installed physical printer.

## Responsibilities

- Authenticate to the print center backend using an agent credential stored in Windows Credential Manager.
- Discover configured Windows printers.
- Maintain a secure outbound connection to the cloud backend.
- Claim one waiting job at a time.
- Download the private document through an authorized, short-lived signed URL.
- Submit the document and requested settings to the selected Windows printer.
- Report `printing`, `completed`, or `failed` status with an error message.
- Send printer heartbeat and availability information.

## Security requirements

- Never expose the Supabase service-role key.
- Never create public storage URLs.
- Never accept arbitrary file URLs from the browser.
- Validate every claimed job and printer against the backend response.
- Keep agent credentials out of source control and browser bundles.
- Restrict local HTTP access to the operator dashboard origin or use a loopback-only listener.

## Backend contract

The first implementation should expose these authenticated agent operations through a server-side endpoint or Supabase Edge Function:

- `POST /agent/heartbeat`
- `POST /agent/jobs/claim`
- `POST /agent/jobs/:id/start`
- `POST /agent/jobs/:id/complete`
- `POST /agent/jobs/:id/fail`
- `GET /agent/printers`

The agent must receive a signed download URL only after claiming a job. Signed URLs should expire quickly and must not be rendered in the student or operator UI.

## Required deployment values

Before implementing the Windows service, provide:

- Windows version
- Operator PC name
- Installed printer name
- USB, Wi-Fi, or Ethernet connection
- Preferred installation model: Windows Service or tray application
