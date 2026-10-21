# pptinit

A private document workspace built with Next.js, Express, Prisma, and PostgreSQL. Users create projects and add named PPTX, PDF, DOCX files or HTTPS links. Administrators browse users and their projects. There are no modules.

## Local setup

Requires Node.js 22+ and PostgreSQL (or Docker).

1. `npm install`
2. Copy `.env.example` to `.env`. Set a random JWT secret with at least 32 characters. For example, generate one with `openssl rand -hex 32`.
3. `docker compose up -d db` (or configure DATABASE_URL for your PostgreSQL server).
4. `npm run db:migrate`
5. Set ADMIN_EMAIL and ADMIN_PASSWORD, then `npm run db:seed` to create the admin account. Existing accounts are promoted without changing their password.
6. `npm run dev`
7. Open http://localhost:3000.

`npm test` runs security validation tests. With the local server running, `npm run test:integration` checks authentication, upload handling, access isolation, and admin permissions against the configured database. It creates and removes its own test users. `npm run build` checks frontend and backend compilation. `npm start` runs the compiled applications. The start script sets NODE_ENV=production and requires the configured scanner.

## Security and storage

- Argon2id password hashes, 15-minute JWTs in HttpOnly cookies, rotating seven-day refresh sessions. Every authenticated request verifies the backing session; logout invalidates it immediately.
- Same-origin mutation protection, strict schemas, Helmet headers, rate limiting, and owner/admin checks. Admin document access is read-only; admin downloads are audited.
- File uploads are limited to 50 MB each and 1 GB per user. A PostgreSQL row lock serializes concurrent quota checks. Random private filenames prevent traversal and public access; downloads require authorization and use attachment disposition.
- Office uploads are inspected for expected structure, encrypted entries, macros, embedded objects, entry count, and expanded size. PDF header/trailer checks identify malformed uploads but are not a malware scanner.
- Set CLAMSCAN_PATH to an installed and updated ClamAV scanner. Production refuses to start without this setting; a failed scan rejects the upload. Local development without a scanner accepts structurally valid documents for testing only.
- Files are stored in UPLOAD_DIR, outside public assets. Mount a persistent private volume in production. Do not deploy this storage setup on an ephemeral/serverless filesystem. Move storage to a private object bucket for multi-instance deployment.
- Documents are preserved as uploaded. No lossy compression is applied: Office files already use ZIP packaging. Links are stored, never fetched by the backend.

## Deployment notes and remaining work

Run Next.js and Express behind HTTPS on the same origin. Express binds to loopback on port 4000; Next.js proxies /api. The supplied Next.js rewrite assumes PORT=4000. Configure APP_ORIGIN to the exact public origin. Configure trusted proxy handling deliberately if adding a reverse proxy, so rate limits use the correct client IP. Do not expose the API directly.

Before a public launch:

- Add transactional email for email verification and password resets; these flows are not implemented yet.
- Review the included initial migration before deployment. It enforces document source and user role constraints. Use migrations rather than db:push for future schema changes.
- Back up PostgreSQL and the upload volume together; add an orphan-file reconciliation job for interrupted writes/deletes.
- Use a shared rate-limit store and shared private object storage before scaling to multiple API instances.
- Run the included integration tests against a dedicated test instance before deployment; expand coverage to scanner failure, quota concurrency, and large-file handling.
- Perform a full accessibility review; dialogs include keyboard focus trapping, Escape handling, and focus return.

The current UI supports signup/login/logout, project creation, project search, document upload/link creation, download, document deletion with confirmation, admin user search and pagination, and admin project/document browsing. Project renaming/deletion, previews, sharing, and automatic document optimization are not included.

## UI motion

Project and user cards use the source-owned [React Bits SpotlightCard](https://github.com/DavidHDev/react-bits), customized to the pptinit palette. Its license is retained in `components/react-bits/LICENSE.md`. Login background movement, card entrances, button sheen, and illustration motion use CSS. Reduced-motion preferences disable decorative animation; cards remain keyboard-accessible buttons.
