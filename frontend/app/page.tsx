"use client";
import { useEffect, useRef, useState } from "react";
import SpotlightCard from "../components/react-bits/SpotlightCard";
import DocumentViewer from "../components/DocumentViewer";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  Eye,
  Folder,
  FolderOpen,
  Grid2X2,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  _count?: { projects: number };
};
type Project = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  _count?: { documents: number };
};
type Doc = {
  id: string;
  name: string;
  kind: string;
  url?: string;
  size: number;
  createdAt: string;
  originalName?: string;
};
let refreshPromise: Promise<Response> | null = null;
async function api(url: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  let res = await fetch("/api" + url, { ...options, headers });
  if (
    res.status === 401 &&
    !["/auth/login", "/auth/signup", "/auth/refresh", "/auth/logout"].includes(
      url,
    )
  ) {
    refreshPromise ??= fetch("/api/auth/refresh", { method: "POST" }).finally(
      () => {
        refreshPromise = null;
      },
    );
    const refresh = await refreshPromise;
    if (refresh.ok) res = await fetch("/api" + url, { ...options, headers });
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
const bytes = (n: number) =>
  n >= 1024 ** 3
    ? (n / 1024 ** 3).toFixed(1) + " GB"
    : n >= 1024 ** 2
      ? (n / 1024 ** 2).toFixed(1) + " MB"
      : Math.round(n / 1024) + " KB";
const date = (s: string) =>
  new Date(s).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export default function Home() {
  const [user, setUser] = useState<User | null>(null),
    [boot, setBoot] = useState(true),
    [signup, setSignup] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]),
    [docs, setDocs] = useState<Doc[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [used, setUsed] = useState(0);
  const [view, setView] = useState<"projects" | "admin">("projects"),
    [users, setUsers] = useState<User[]>([]),
    [owner, setOwner] = useState<User | null>(null),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const [search, setSearch] = useState(""),
    [loading, setLoading] = useState(false),
    [modal, setModal] = useState<"project" | "document" | null>(null),
    [mode, setMode] = useState<"file" | "link">("file"),
    [file, setFile] = useState<File | null>(null),
    [notice, setNotice] = useState("");
  const [viewing, setViewing] = useState<Doc | null>(null);
  const requestId = useRef(0);
  useEffect(() => {
    api("/auth/me")
      .then((d) => setUser(d.user))
      .catch(async () => {
        try {
          await api("/auth/refresh", { method: "POST" });
          const d = await api("/auth/me");
          setUser(d.user);
        } catch {}
      })
      .finally(() => setBoot(false));
  }, []);
  async function load() {
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      if (project) {
        const d = await api("/projects/" + project.id);
        if (id === requestId.current) setDocs(d.documents);
      } else if (view === "admin" && !owner) {
        const d = await api(
          "/admin/users?search=" + encodeURIComponent(search) + "&page=" + page,
        );
        if (id === requestId.current) {
          setUsers(d.users);
          setTotal(d.total);
        }
      } else {
        const d = await api(
          "/projects" + (owner ? "?ownerId=" + owner.id : ""),
        );
        if (id === requestId.current) {
          setProjects(d.projects);
          setUsed(d.usedBytes);
        }
      }
    } catch (e) {
      if (id === requestId.current) setError((e as Error).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (user) load();
  }, [
    user,
    project,
    view,
    owner,
    page,
    view === "admin" && !owner ? search : "",
  ]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setModal(null);
      if (e.key === "Tab") {
        const nodes = document.querySelectorAll<HTMLElement>(
          ".modal button:not(:disabled), .modal input:not([type=file])",
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [modal, busy]);
  async function auth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const d = await api("/auth/" + (signup ? "signup" : "login"), {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form)),
      });
      setUser(d.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      if (modal === "project")
        await api("/projects", {
          method: "POST",
          body: JSON.stringify({ name: form.get("name") }),
        });
      else if (mode === "link")
        await api("/projects/" + project!.id + "/links", {
          method: "POST",
          body: JSON.stringify({
            name: form.get("name"),
            url: form.get("url"),
          }),
        });
      else {
        if (!file) throw Error("Choose a file to upload");
        if (file.size > 50 * 1024 ** 2)
          throw Error("Maximum file size is 50 MB");
        const body = new FormData();
        body.set("name", String(form.get("name")));
        body.set("file", file);
        await api("/projects/" + project!.id + "/files", {
          method: "POST",
          body,
        });
      }
      setModal(null);
      setFile(null);
      setNotice(modal === "project" ? "Project created" : "Document added");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function navigate(v: "projects" | "admin") {
    setView(v);
    setProject(null);
    setOwner(null);
    setSearch("");
    setPage(1);
    setError("");
  }
  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );
  const visibleDocs = docs.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase()),
  );
  const readOnly = !!project && project.ownerId !== user?.id;
  if (boot)
    return (
      <div className="boot">
        <div className="brand">
          <img
            className="brand-logo"
            src="/virtual-mechatronics-logo.png"
            alt="Virtual Mechatronics Lab"
            width={184}
            height={100}
          />
          <span className="brand-name">
            pptinit<span className="brand-dot">.</span>
          </span>
        </div>
        <LoaderCircle className="spin" />
      </div>
    );
  if (!user)
    return (
      <main className="auth-page">
        <section className="auth-story">
          <div className="auth-aurora" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="brand">
            <span className="brand-name">
              pptinit<span className="brand-dot">.</span>
            </span>
          </div>
          <div>
            <span className="eyebrow">
              A LITTLE ORDER. A LOT OF POSSIBILITY.
            </span>
            <h1>
              Your ideas deserve
              <br />a place to belong.
            </h1>
            <p>
              Bring your presentations, documents, and links together.
              <br />
              One workspace. Room for every project.
            </p>
            <div className="auth-preview">
              <FolderOpen size={40} />
              <div>
                <strong>Everything, in its place.</strong>
                <p>From your first draft to your next big idea.</p>
              </div>
            </div>
          </div>
          <span className="auth-footer">A calmer way to work.</span>
        </section>
        <section className="auth-form">
          <div className="form-wrap">
            <span className="eyebrow">YOUR WORKSPACE AWAITS</span>
            <h2>{signup ? "Make room for your ideas." : "Welcome back."}</h2>
            <p className="muted">
              {signup
                ? "Create your account to get organized."
                : "Log in to pick up where you left off."}
            </p>
            <form onSubmit={auth}>
              {signup && (
                <label>
                  Full name
                  <input
                    name="name"
                    required
                    maxLength={120}
                    autoComplete="name"
                    placeholder="Alex Morgan"
                  />
                </label>
              )}
              <label>
                Email address
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  maxLength={128}
                  required
                  autoComplete={signup ? "new-password" : "current-password"}
                  placeholder="At least 8 characters"
                />
              </label>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <button className="primary auth-submit" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <>
                    {signup ? "Create account" : "Log in"}
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
            <p className="auth-switch">
              {signup ? "Already have an account?" : "New to pptinit?"}{" "}
              <button
                onClick={() => {
                  setSignup(!signup);
                  setError("");
                }}
              >
                {signup ? "Log in" : "Create an account"}
              </button>
            </p>
          </div>
        </section>
      </main>
    );
  return (
    <div className="shell">
      {viewing && (
        <DocumentViewer
          document={viewing}
          request={api}
          onClose={() => setViewing(null)}
        />
      )}
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="pptinit home">
          <img
            className="brand-logo"
            src="/virtual-mechatronics-logo.png"
            alt="Virtual Mechatronics Lab"
            width={184}
            height={100}
          />
          <span className="brand-name">
            pptinit<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav>
          <button
            className={view === "projects" ? "active" : ""}
            onClick={() => navigate("projects")}
          >
            <LayoutDashboard size={19} />
            My projects<span className="nav-count">{projects.length}</span>
          </button>
          {user.role === "ADMIN" && (
            <button
              className={view === "admin" ? "active" : ""}
              onClick={() => navigate("admin")}
            >
              <Users size={19} />
              User directory
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="storage">
            <div>
              <span>Workspace storage</span>
              <span>{bytes(used)} / 1 GB</span>
            </div>
            <div className="storage-track">
              <i
                style={{ width: Math.min(100, (used / 1024 ** 3) * 100) + "%" }}
              />
            </div>
            <p>A little space for your big ideas.</p>
          </div>
          <div className="profile">
            <span className="avatar">{user.name.charAt(0).toUpperCase()}</span>
            <div>
              <strong>{user.name}</strong>
              <span>
                {user.role === "ADMIN" ? "Administrator" : "Personal account"}
              </span>
            </div>
            <button
              title="Log out"
              aria-label="Log out"
              onClick={async () => {
                try {
                  await api("/auth/logout", { method: "POST" });
                  setUser(null);
                  setProject(null);
                  setOwner(null);
                  setView("projects");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div>
            Workspace <ChevronRight size={14} />
            <span>{view === "admin" ? "User directory" : "My projects"}</span>
            {project && (
              <>
                <ChevronRight size={14} />
                <span>{project.name}</span>
              </>
            )}
          </div>
          <span className="private">
            <ShieldCheck size={14} />
            Private workspace
          </span>
        </header>
        <main className="content">
          {(project || owner) && (
            <button
              className="back"
              onClick={() => {
                if (project) setProject(null);
                else setOwner(null);
                setSearch("");
              }}
            >
              <ArrowLeft size={16} />
              Back to {project ? "projects" : "users"}
            </button>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "admin" ? "ADMINISTRATION" : "YOUR PERSONAL LIBRARY"}
              </div>
              <h1>
                {project
                  ? project.name
                  : owner
                    ? owner.name + "’s projects"
                    : view === "admin"
                      ? "People & their work"
                      : "My projects"}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {project
                  ? "All your project documents and links, together."
                  : view === "admin" && !owner
                    ? "A clear view of every user and their workspace."
                    : "A home for your documents. A fresh start for every idea."}
              </p>
            </div>
            {((view === "projects" && !project) || (project && !readOnly)) && (
              <button
                className="primary"
                onClick={() => {
                  setError("");
                  setFile(null);
                  setMode("file");
                  setModal(project ? "document" : "project");
                }}
              >
                <Plus size={18} />
                {project ? "Add document" : "Create project"}
              </button>
            )}
          </div>
          {!project && view === "projects" && (
            <section className="welcome-banner">
              <div>
                <span className="banner-tag">LESS CLUTTER, MORE CLARITY</span>
                <h2>Good work starts with a little organization.</h2>
                <p>
                  Keep your presentations, PDFs, and documents in one happy
                  place.
                </p>
              </div>
              <div className="banner-art" aria-hidden="true">
                <div className="art-sheet sheet-back">
                  <FileText />
                </div>
                <div className="art-sheet sheet-front">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="art-folder">
                  <Folder size={66} />
                </div>
                <i className="spark s1">✦</i>
                <i className="spark s2">✦</i>
              </div>
            </section>
          )}
          <div className="collection-bar">
            <div>
              <h3>
                {project
                  ? "Documents"
                  : view === "admin" && !owner
                    ? "All users"
                    : "All projects"}
              </h3>
              <span>
                {project
                  ? docs.length
                  : view === "admin" && !owner
                    ? total
                    : projects.length}
              </span>
            </div>
            <div className="collection-controls">
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="Search"
                  placeholder={
                    project
                      ? "Search documents…"
                      : view === "admin" && !owner
                        ? "Search users…"
                        : "Search projects…"
                  }
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <span className="grid-indicator">
                <Grid2X2 size={17} />
              </span>
            </div>
          </div>
          {error && !modal && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => load()}>Retry</button>
            </div>
          )}
          {loading ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              Loading your workspace…
            </div>
          ) : project ? (
            <div className="documents">
              {visibleDocs.length === 0 ? (
                <div className="empty">
                  <FileText size={36} />
                  <h3>
                    {search
                      ? "No documents found"
                      : "A place for your next idea"}
                  </h3>
                  <p>
                    {search
                      ? "Try another search."
                      : "Add a presentation, PDF, Word document, or link to get started."}
                  </p>
                </div>
              ) : (
                visibleDocs.map((d) => (
                  <article className="document-row" key={d.id}>
                    <span className={"doc-icon " + d.kind.toLowerCase()}>
                      {d.kind === "LINK" ? (
                        <Link2 size={23} />
                      ) : (
                        <FileText size={23} />
                      )}
                    </span>
                    <div className="doc-info">
                      <strong>{d.name}</strong>
                      <span>
                        {d.kind === "LINK"
                          ? "External link"
                          : d.kind + " · " + bytes(d.size)}
                        <i>·</i>
                        {date(d.createdAt)}
                      </span>
                    </div>
                    {d.kind !== "LINK" && (
                      <button
                        className="view-document"
                        title="View document"
                        onClick={() => setViewing(d)}
                      >
                        <Eye size={17} />
                        <span>View</span>
                      </button>
                    )}
                    {d.kind === "LINK" ? (
                      <a
                        className="icon-button"
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open link"
                      >
                        <ArrowRight size={18} />
                      </a>
                    ) : (
                      <button
                        className="icon-button"
                        title="Download"
                        onClick={async () => {
                          try {
                            await api("/auth/me");
                            window.location.assign(
                              "/api/documents/" + d.id + "/download",
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        <ArrowDownToLine size={18} />
                      </button>
                    )}
                    {!readOnly && (
                      <button
                        className="icon-button danger"
                        title="Delete document"
                        onClick={async () => {
                          if (
                            !confirm(
                              "Delete “" + d.name + "”? This cannot be undone.",
                            )
                          )
                            return;
                          try {
                            await api("/documents/" + d.id, {
                              method: "DELETE",
                            });
                            setNotice("Document deleted");
                            await load();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        <Trash2 size={17} />
                      </button>
                    )}
                  </article>
                ))
              )}
            </div>
          ) : view === "admin" && !owner ? (
            <>
              <div className="project-grid">
                {users.map((u) => (
                  <SpotlightCard
                    key={u.id}
                    className="project-spotlight"
                    theme="light"
                    spotlightColor="#93c5fd"
                    intensity={0.8}
                    borderGlow={0.8}
                  >
                    <button
                      className="project-card user-card"
                      onClick={() => {
                        setOwner(u);
                        setSearch("");
                      }}
                    >
                      <div className="card-top">
                        <span className="avatar large">
                          {u.name.charAt(0).toUpperCase()}
                        </span>
                        <ChevronRight size={18} />
                      </div>
                      <h3>{u.name}</h3>
                      <p>{u.email}</p>
                      <div className="card-footer">
                        <span>{u._count?.projects} projects</span>
                        <span>{u.role === "ADMIN" ? "Admin" : "Member"}</span>
                      </div>
                    </button>
                  </SpotlightCard>
                ))}
              </div>
              {!users.length && <div className="empty">No users found.</div>}
              <div className="pagination">
                <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <span>Page {page}</span>
                <button
                  disabled={page * 24 >= total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <div className="project-grid">
              {filtered.map((p, i) => (
                <SpotlightCard
                  key={p.id}
                  className="project-spotlight"
                  theme="light"
                  spotlightColor="#93c5fd"
                  intensity={0.8}
                  borderGlow={0.8}
                  style={{ animationDelay: `${Math.min(i, 5) * 65}ms` }}
                >
                  <button
                    className="project-card"
                    onClick={() => {
                      setProject(p);
                      setSearch("");
                    }}
                  >
                    <div className="card-top">
                      <span className={"folder-icon tone-" + (i % 4)}>
                        <Folder size={26} />
                      </span>
                      <span className="card-arrow">
                        <ArrowRight size={18} />
                      </span>
                    </div>
                    <h3>{p.name}</h3>
                    <p>
                      {p._count?.documents || 0}{" "}
                      {(p._count?.documents || 0) === 1
                        ? "document"
                        : "documents"}
                    </p>
                    <div className="card-footer">
                      <span>Created {date(p.createdAt)}</span>
                      <span className="project-badge">Project</span>
                    </div>
                  </button>
                </SpotlightCard>
              ))}
              {!owner && !search && (
                <button
                  className="new-project"
                  onClick={() => {
                    setError("");
                    setModal("project");
                  }}
                >
                  <span>
                    <Plus size={24} />
                  </span>
                  <strong>Create a new project</strong>
                  <p>A little room for something new.</p>
                </button>
              )}
              {search && !filtered.length && (
                <div className="empty">No projects match your search.</div>
              )}
            </div>
          )}
          <footer className="content-footer">
            <span>
              <ShieldCheck size={13} />
              Only you and authorized admins can access your files.
            </span>
            <span>Made for a clearer mind.</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {modal && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="modal-close"
              aria-label="Close"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            <span className="modal-symbol">
              {modal === "project" ? (
                <Folder size={25} />
              ) : (
                <FileText size={25} />
              )}
            </span>
            <h2 id="modal-title">
              {modal === "project"
                ? "A new place for your ideas."
                : "Add to your project."}
            </h2>
            <p className="muted">
              {modal === "project"
                ? "Give your project a name. Make it your own."
                : "Upload a document or save a useful link."}
            </p>
            <form onSubmit={save}>
              <label>
                {modal === "project" ? "Project name" : "Document name"}
                <input
                  name="name"
                  autoFocus
                  required
                  maxLength={120}
                  placeholder={
                    modal === "project"
                      ? "e.g. Brand strategy"
                      : "e.g. Quarterly presentation"
                  }
                />
              </label>
              {modal === "document" && (
                <>
                  <div className="tabs">
                    <button
                      type="button"
                      className={mode === "file" ? "selected" : ""}
                      onClick={() => setMode("file")}
                    >
                      <UploadCloud size={17} />
                      Upload file
                    </button>
                    <button
                      type="button"
                      className={mode === "link" ? "selected" : ""}
                      onClick={() => setMode("link")}
                    >
                      <Link2 size={17} />
                      Add link
                    </button>
                  </div>
                  {mode === "link" ? (
                    <label>
                      Document URL
                      <input
                        name="url"
                        type="url"
                        required
                        placeholder="https://example.com/document"
                      />
                      <small>Use a secure HTTPS link.</small>
                    </label>
                  ) : (
                    <label className="drop-zone">
                      <UploadCloud size={30} />
                      <strong>
                        {file ? file.name : "Choose a file to upload"}
                      </strong>
                      <span>
                        {file
                          ? bytes(file.size)
                          : "PowerPoint, PDF, or Word · Up to 50 MB"}
                      </span>
                      <input
                        type="file"
                        accept=".pptx,.pdf,.docx"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                      />
                    </label>
                  )}
                </>
              )}
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? (
                    <>
                      <LoaderCircle size={17} className="spin" />
                      {mode === "file" && modal === "document"
                        ? "Uploading…"
                        : "Saving…"}
                    </>
                  ) : modal === "project" ? (
                    "Create project"
                  ) : mode === "file" ? (
                    "Upload document"
                  ) : (
                    "Save link"
                  )}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
