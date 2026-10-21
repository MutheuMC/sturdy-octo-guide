"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ExternalLink,
  LoaderCircle,
  Maximize2,
  RefreshCw,
  X,
} from "lucide-react";
type Document = { id: string; name: string; kind: string };
type Props = {
  document: Document;
  request: (url: string, options?: RequestInit) => Promise<any>;
  onClose: () => void;
};
export default function DocumentViewer({
  document: doc,
  request,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState("Preparing your document…"),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  useEffect(() => {
    let cancelled = false,
      objectUrl = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setUrl("");
    setError("");
    setStatus("Preparing your document…");
    async function check() {
      try {
        const state = await request(
          "/documents/" + doc.id + "/preview/status",
          { signal: controller.signal },
        );
        if (cancelled) return;
        if (!state.available)
          throw Error(
            "PowerPoint and Word previews are not configured on this server. You can still download the original document.",
          );
        if (state.status === "FAILED")
          throw Error(
            state.error ||
              "The preview could not be created. Try again or download the original.",
          );
        if (state.status === "READY") {
          let response = await fetch("/api/documents/" + doc.id + "/preview", {
            signal: controller.signal,
            cache: "no-store",
          });
          if (response.status === 401) {
            await request("/auth/me");
            response = await fetch("/api/documents/" + doc.id + "/preview", {
              signal: controller.signal,
              cache: "no-store",
            });
          }
          if (!response.ok) {
            const data = await response.json();
            throw Error(data.error || "Could not load the preview");
          }
          const blob = await response.blob();
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
          return;
        }
        if (state.status === "NONE")
          await request("/documents/" + doc.id + "/preview", {
            method: "POST",
            signal: controller.signal,
          });
        if (cancelled) return;
        setStatus(
          state.status === "PROCESSING"
            ? "Creating a PDF preview…"
            : "Your preview is queued…",
        );
        timer = setTimeout(check, 1800);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    async function begin() {
      try {
        if (attempt > 0)
          await request("/documents/" + doc.id + "/preview", {
            method: "POST",
            signal: controller.signal,
          });
        if (!cancelled) await check();
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    void begin();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc.id, request, attempt]);
  return (
    <dialog
      ref={dialog}
      className="document-viewer"
      aria-labelledby="viewer-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header className="viewer-toolbar">
        <div>
          <h2 id="viewer-title">{doc.name}</h2>
          <p>
            {doc.kind === "PDF"
              ? "PDF document"
              : "Static preview · Animations and embedded media are not included"}
          </p>
        </div>
        <div className="viewer-actions">
          {url && (
            <>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="icon-button"
                aria-label="Open preview in a new tab"
                title="Open preview"
              >
                <ExternalLink size={19} />
              </a>
              <button
                className="icon-button"
                title="Fullscreen"
                aria-label="Fullscreen"
                onClick={() => {
                  if (globalThis.document.fullscreenElement)
                    void globalThis.document.exitFullscreen();
                  else void dialog.current?.requestFullscreen().catch(() => {});
                }}
              >
                <Maximize2 size={19} />
              </button>
            </>
          )}
          <button
            className="icon-button"
            title="Download original"
            aria-label="Download original"
            onClick={async () => {
              try {
                await request("/auth/me");
                window.location.assign(
                  "/api/documents/" + doc.id + "/download",
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <ArrowDownToLine size={19} />
          </button>
          <button
            autoFocus
            className="icon-button"
            aria-label="Close preview"
            title="Close preview"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
      </header>
      <div className="viewer-body">
        {error ? (
          <div className="viewer-message" role="alert">
            <h3>Preview unavailable</h3>
            <p>{error}</p>
            <button
              className="primary"
              onClick={() => setAttempt((v) => v + 1)}
            >
              <RefreshCw size={16} />
              Try again
            </button>
          </div>
        ) : url ? (
          <iframe
            src={url + "#toolbar=1&navpanes=0"}
            title={"Preview of " + doc.name}
          />
        ) : (
          <div className="viewer-message" role="status">
            <LoaderCircle className="spin" size={28} />
            <h3>{status}</h3>
            <p>You can close this window and come back later.</p>
          </div>
        )}
      </div>
      <footer className="viewer-footer">
        {url
          ? "Use the PDF toolbar to browse pages and zoom. If your browser cannot display PDFs, use Open preview or download the original."
          : "Your files stay private. Conversion does not change the original document."}
      </footer>
    </dialog>
  );
}
