# pptinit

A private document workspace with an independently installed Next.js frontend and plain-JavaScript Express backend. Users create projects and add named PPTX, PDF, DOCX files or HTTPS links. Administrators browse users and their projects.

## Project structure

```text
frontend/                 Next.js App Router application (TypeScript)
  package.json            Frontend-only dependencies and commands
  package-lock.json       Frontend dependency lockfile
  node_modules/           Frontend dependencies
  app/                    Pages, layout, and global styles
  components/             React components
  public/                 Static frontend assets
backend/                  Express API (JavaScript only)
  package.json            Backend-only dependencies and commands
  package-lock.json       Backend dependency lockfile
  node_modules/           Backend dependencies
  .env                    Backend runtime configuration (not committed)
  src/controllers/        HTTP request and response handlers
  src/routes/             API route declarations
  src/middleware/         Authentication, authorization, limits, and errors
  src/services/           Authentication, documents, access, and previews
  src/validators/         Request and document validation
  prisma/                 Schema, migrations, and administrator seed
  tests/                  Security and integration tests
```

The browser still calls `/api`. `frontend/next.config.ts` proxies those requests to the loopback-only backend on port 4000, preserving same-origin cookies and request protection.

## Local setup

Requires Node.js 22+ and PostgreSQL (or Docker).

Set up the backend:

1. `cd backend`
2. `npm install`
3. Copy `.env.example` to `.env`. Set a random JWT secret with at least 32 characters.
4. Start PostgreSQL and configure `DATABASE_URL` in `backend/.env`.
5. `npm run db:migrate`
6. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD`, then run `npm run db:seed`.
7. `npm run dev`

In a second terminal, set up the frontend:

1. `cd frontend`
2. `npm install`
3. `npm run dev`
4. Open http://localhost:3000.

Run backend security tests with `npm test` from `backend`. With both applications running, `npm run test:integration` from `backend` checks authentication, upload handling, access isolation, and admin permissions. Build each application independently with `npm run build` in its own directory.

## Security and storage

Owners can use the pencil button beside a document or link to rename it, update its HTTPS URL, or upload a replacement file. The original upload date stays visible, and edits show a **Last updated** date and time in the viewer's local timezone. Existing items have no edit timestamp until they are changed; generating a preview does not count as an edit.

File replacements are validated and scanned using the same rules as new uploads. After the replacement is saved, the previous file and its PDF preview are deleted. Version history is not retained. A rejected replacement leaves the current file available. Replacement files count against the 1 GB quota after crediting the old file and preview.

After updating the app, run `npm run db:migrate` and `npm run build` in `backend` to add the timestamp column and regenerate Prisma Client. Run `npm run test:updates` in `backend` against the local database to verify editing, access controls, replacement cleanup, quota handling, and replacement during preview conversion. The test starts its own API and cleans up its test accounts and files.

- Argon2id password hashes, 15-minute JWTs in HttpOnly cookies, rotating seven-day refresh sessions. Every authenticated request verifies the backing session; logout invalidates it immediately.
- Same-origin mutation protection, strict schemas, Helmet headers, rate limiting, and owner/admin checks. Admin document access is read-only; admin downloads are audited.
- File uploads are limited to 50 MB each and 1 GB per user. A PostgreSQL row lock serializes concurrent quota checks. Random private filenames prevent traversal and public access; downloads require authorization and use attachment disposition.
- Office uploads are inspected for expected structure, encrypted entries, macros, embedded objects, entry count, and expanded size. PDF header/trailer checks identify malformed uploads but are not a malware scanner.
- Set CLAMSCAN_PATH to an installed and updated ClamAV scanner. Production refuses to start without this setting; a failed scan rejects the upload. Local development without a scanner accepts structurally valid documents for testing only.
- Files are stored in UPLOAD_DIR, outside public assets. Mount a persistent private volume in production. Do not deploy this storage setup on an ephemeral/serverless filesystem. Move storage to a private object bucket for multi-instance deployment.
- Documents are preserved as uploaded. No lossy compression is applied: Office files already use ZIP packaging. Links are stored, never fetched by the backend.

## Deployment notes and remaining work

Host the app on Linux. Office previews use LibreOffice inside the included bubblewrap sandbox. Start from `backend/.env.example` and `frontend/.env.example`, and configure private persistent storage before deployment. `npm run check:deployment` in `backend` checks database connectivity, writable storage and configured converter/scanner paths; `npm run test:previews` verifies actual document previews with the app running.

Run Next.js and Express behind HTTPS on the same origin. Express binds to loopback on port 4000; Next.js proxies /api. The supplied Next.js rewrite assumes PORT=4000. Configure APP_ORIGIN to the exact public origin. Configure trusted proxy handling deliberately if adding a reverse proxy, so rate limits use the correct client IP. Do not expose the API directly.

Before a public launch:

- Add transactional email for email verification and password resets; these flows are not implemented yet.
- Review the included initial migration before deployment. It enforces document source and user role constraints. Use migrations rather than db:push for future schema changes.
- Back up PostgreSQL and the upload volume together; add an orphan-file reconciliation job for interrupted writes/deletes.
- Use a shared rate-limit store and shared private object storage before scaling to multiple API instances.
- Run the included integration tests against a dedicated test instance before deployment; expand coverage to scanner failure, quota concurrency, and large-file handling.
- Perform a full accessibility review; dialogs include keyboard focus trapping, Escape handling, and focus return.

The current UI supports signup/login/logout, project creation, project search, document upload/link creation, download, document deletion with confirmation, admin user search and pagination, and admin project/document browsing. Project renaming/deletion, sharing, and automatic document optimization are not included.

## UI motion

Project and user cards use the source-owned [React Bits SpotlightCard](https://github.com/DavidHDev/react-bits), customized to the pptinit palette. Its license is retained in `components/react-bits/LICENSE.md`. Login background movement, card entrances, button sheen, and illustration motion use CSS. Reduced-motion preferences disable decorative animation; cards remain keyboard-accessible buttons.

## Browser document previews

Click **View** beside an uploaded file. PDFs open directly; PPTX and DOCX files are converted to static PDFs on demand. The viewer supports the browser PDF toolbar (page navigation and zoom), fullscreen, a separate preview tab, and downloading the original. Browser PDF support varies on mobile; use the separate tab or download fallback when needed. External links continue to open at their original location. Animations, transitions, embedded media, and exact font fidelity are not preserved by conversion.

Run `npm run db:migrate` after updating the app. Install LibreOffice Impress and Writer, then set `LIBREOFFICE_PATH` to its absolute executable path. Restart the API after environment changes. Without this setting, PDF viewing still works and Office previews display a configuration message. Conversion uses the [LibreOffice headless PDF export](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html).

For production Office previews, install Linux bubblewrap and set `PREVIEW_SANDBOX_PATH` to the absolute path of `backend/scripts/preview-sandbox.sh`. It isolates the converter from the network and application filesystem, mounts only system runtime resources and the current temporary job, drops capabilities, and applies CPU/file limits. The host must permit unprivileged user namespaces. A non-system LibreOffice runtime can be mounted read-only with `LIBREOFFICE_RUNTIME_DIR`. Production refuses to enable Office conversion without the wrapper. Keep LibreOffice and ClamAV current; install fonts needed by your documents in the converter runtime.

The single-process worker persists QUEUED/PROCESSING/READY/FAILED states in PostgreSQL, processes one job at a time, and recovers interrupted work on restart. Use only one API/worker instance with this implementation; move jobs to a dedicated queue before scaling horizontally. Each conversion has a fresh profile with macro execution disabled, a 90-second timeout, a 50 MB output limit, and temporary directory cleanup. Preview files count toward the user's 1 GB quota and are removed when the original is deleted. Previews use the same owner/admin permissions as downloads; admin views are audited. Generated preview PDFs remain private and are fetched into a temporary browser blob URL that is revoked when the viewer closes.

With the app running and the converter configured, `npm run test:previews` exercises real two-slide PPTX, DOCX, and PDF fixtures, unauthorized access, admin viewing, private response headers, conversion failure/retry, and deletion cleanup. It creates and removes its own test accounts.
