# Windows Server deployment

The app can run natively on Windows. No Linux VM, WSL, or Microsoft Office installation is required. The frontend, API and PostgreSQL run on Windows; LibreOffice converts DOCX/PPTX to private PDF previews. PDFs display directly.

The Windows native launcher has not been executed in the Linux development environment. Complete the Windows smoke test below under the intended service account before enabling the public site. A successful Linux build is not a Windows runtime certification.

## 1. Install requirements

Use 64-bit Windows Server 2019 or newer with Desktop Experience and Windows PowerShell 5.1/.NET Framework. Install:

- A currently supported Node.js LTS release, version 22 or newer.
- PostgreSQL, either local or on a reachable private database host.
- 64-bit LibreOffice, including Writer and Impress, in its standard `C:\Program Files\LibreOffice` location. Install the fonts used in your documents for all users.
- [ClamAV for Windows](https://docs.clamav.net/manual/Installing.html), configure its database and run `freshclam.exe` to download current signatures. Set `CLAMSCAN_PATH` to the actual `clamscan.exe`. Production refuses to start without a scanner.
- IIS with [URL Rewrite and Application Request Routing](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/reverse-proxy-with-url-rewrite-v2-and-application-request-routing), plus an HTTPS certificate for the site.
- [WinSW](https://github.com/winsw/winsw) to manage the two Node processes as Windows services.

Use a dedicated standard Windows account for the API/converter and a separate standard account for the frontend. Initialize each account's Windows profile and grant “Log on as a service”. Do not run these services as Administrator or LocalSystem. Verify AppContainer profile creation works with the API's service identity, including after reboot.

## 2. Copy code and configure private storage

These examples use `C:\pptinit` for code and `D:\pptinit-data` for data. Adjust the paths if your server has no D: drive. Use local NTFS storage, not a mapped drive or UNC share, for preview jobs.

Create private directories for `uploads`, `tmp`, `logs\backend`, and `logs\frontend` under the data directory. In NTFS permissions:

- Only the API service account, SYSTEM, and Administrators should access uploads and temporary jobs. The API account needs Modify rights.
- Grant each service account Modify rights to its own log directory. Next.js also needs access to its `.next` runtime cache.
- Grant the service accounts Read & execute rights to their code and installed runtimes. Keep backend `.env` readable only by the API account and administrators.
- Do not grant `Everyone`, `Users`, `ALL APPLICATION PACKAGES`, or `ALL RESTRICTED APPLICATION PACKAGES` access to private app data or secrets. POSIX `mode: 0600` does not establish equivalent NTFS protection on Windows.
- Keep code, environment files, uploads and logs outside the IIS site's physical root.

Copy `backend/.env.windows.example` to `backend/.env`, and replace all example credentials and the JWT secret. Use your exact HTTPS site origin for `APP_ORIGIN`, without a trailing slash. Set paths to the Windows installations, using forward slashes in `.env`.

`PREVIEW_TEMP_DIR` controls the private converter job root. `UPLOAD_DIR` must point at the folder holding both originals and generated previews. If moving from Linux, migrate the PostgreSQL data and the existing upload files together. Leave `PREVIEW_SANDBOX_PATH` and `LIBREOFFICE_RUNTIME_DIR` unset on Windows: a Linux `.sh` wrapper cannot run natively.

Copy `frontend/.env.windows.example` to `frontend/.env.production`. `API_ORIGIN` must match the API's port; its value is read when the frontend is built, so rebuild after changing it. The IIS template below routes `/api` directly to Express; Next.js also retains its own rewrite for local testing.

## 3. Install and build on Windows

Copy source and lockfiles, not Linux `node_modules`, `.next`, or generated Prisma binaries. In PowerShell:

```powershell
Set-Location C:\pptinit\backend
npm ci
npm run db:migrate
npm run build
npm run db:seed

Set-Location C:\pptinit\frontend
npm ci
npm run build
```

`db:migrate` includes the document update timestamp migration. Seeding promotes or creates the configured administrator. Protect or remove the bootstrap admin password from runtime configuration after seeding.

Review the bundled PowerShell/C# scripts. If deployment added a downloaded-file marker, unblock only those reviewed files. If your organization's execution policy requires signed scripts, sign the launcher; the app does not use `ExecutionPolicy Bypass` or weaken machine policy.

## 4. Check configuration and real conversion

Run these under the API service account, with the same directories and environment the service will use:

```powershell
Set-Location C:\pptinit\backend
npm test
npm run check:deployment
npm run test:windows
```

`check:deployment` checks the database, writable storage, scanner executable and Windows launcher compilation. `test:windows` actually converts the bundled DOCX and PPTX fixtures through AppContainer and verifies the resulting PDF headers. It does not require the API or frontend to be running.

If the sandbox fails, inspect the printed Win32 operation/error and the Windows service logs. Check the account profile, PowerShell policy, NTFS permissions and the LibreOffice installation. Conversion fails closed; there is no unsandboxed production fallback. Do not fix failures by granting the converter access to the backend code/data tree or network capabilities.

Windows uses a new AppContainer per conversion, with no network capabilities, a grant to the current job directory, a fresh LibreOffice profile, and an allowlisted environment without database/JWT secrets. Standard Windows AppContainer access to permitted system/runtime resources still applies. The Job Object contains the full process tree, limits combined memory to 1 GiB, active processes to 16, CPU time to 80 seconds, and terminates the tree when the launcher exits. Conversion has a 90-second wall timeout, plus outer launcher startup overhead. Output and temporary-directory size are monitored; the app also validates the PDF and its 50 MiB limit after conversion. This is application isolation, not a separate virtual machine.

References: [AppContainer creation](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer), [process security capabilities and job assignment](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute), [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [LibreOffice CLI](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html).

## 5. Install the Windows services

Copy a suitable WinSW release executable twice into `deployment\windows`, naming the copies `pptinit-backend.exe` and `pptinit-frontend.exe`. Their matching XML templates are already provided. Review the XML files and edit installation/log paths. Do not put database passwords or account passwords in these XML files.

From an Administrator PowerShell:

```powershell
Set-Location C:\pptinit\deployment\windows
.\pptinit-backend.exe install
.\pptinit-frontend.exe install
```

Before starting them, use Windows Services (`services.msc`) to set each service's **Log On** identity to the intended standard account. Grant NTFS/log permissions and service logon rights as above. Then:

```powershell
.\pptinit-backend.exe start
.\pptinit-frontend.exe start
```

The templates use automatic startup, delayed start, restart on failure and rolling logs. Only one API instance should run: the preview queue currently has a single worker. Run a sandboxed preview through the installed service as well as the CLI smoke test, then reboot the server and repeat the preview test before launch.

## 6. Configure IIS and HTTPS

1. Create an IIS site whose physical root is `C:\pptinit\deployment\windows\iis`. Its only app file is the provided `web.config`. Do not point IIS at the repository root or uploads.
2. Bind your hostname and certificate on HTTPS port 443. Use HTTPS to log in: production cookies are Secure.
3. Enable ARR proxying at the IIS server level and preserve the original Host header. Configure its timeout to allow uploads and scans (for example, 180 seconds).
4. In URL Rewrite's **View Server Variables** at the server level, allow `HTTP_X_FORWARDED_FOR`. The API rule overwrites it with the actual client address; `TRUST_PROXY=loopback` trusts only the local IIS hop. If another load balancer sits before IIS, configure that topology deliberately instead of trusting arbitrary forwarded headers.
5. The supplied rules send `/api/*` to `127.0.0.1:4000` and other requests to `127.0.0.1:3000`, preserving query strings. Keep these ports unchanged or update the IIS rules, backend PORT, frontend API_ORIGIN and service arguments together.
6. The request filter allows 55 MiB requests, including multipart overhead; the backend still enforces the 50 MiB file limit. Review any additional upstream request limits/timeouts.
7. Expose only HTTPS to clients. The supplied services bind to loopback; keep the API, frontend and database ports private. Do not cache authenticated API responses or document content in IIS/ARR.

IIS configuration references: [reverse proxy setup](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/reverse-proxy-with-url-rewrite-v2-and-application-request-routing), [request size limits](https://learn.microsoft.com/en-us/iis/configuration/system.webServer/security/requestFiltering/requestLimits/).

## 7. Verify the staged site and maintain backups

With the staged HTTPS site running and `APP_ORIGIN` pointing to it:

```powershell
Set-Location C:\pptinit\backend
npm run test:integration
npm run test:updates
npm run test:previews
```

These tests create and remove their own test accounts/files. Verify signup, login, upload, rename, file replacement, link editing, PDF/Word/PowerPoint viewing, download, deletion and admin access in the browser. Include a near-50-MiB upload through IIS to confirm the deployed request limits.

Schedule backups of PostgreSQL and the upload directory together and test restoration. Keep LibreOffice, Windows, Node and ClamAV/signatures updated. Monitor free disk space and failed preview logs. If a service or host is killed during a conversion, reconcile abandoned `pptinit-preview-*` directories and AppContainer profiles named `pptinit.preview.*` after verifying no conversion is active; graceful conversion normally removes them.
