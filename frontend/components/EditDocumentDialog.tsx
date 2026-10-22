"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Pencil, UploadCloud, X } from "lucide-react";

type EditableDocument = {
  id: string;
  name: string;
  kind: string;
  url?: string;
  originalName?: string;
};

export default function EditDocumentDialog({
  document: doc,
  request,
  onClose,
  onSaved,
}: {
  document: EditableDocument;
  request: (url: string, options?: RequestInit) => Promise<unknown>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isLink = doc.kind === "LINK";

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const name = String(form.get("name"));
      let body: BodyInit;
      if (file) {
        if (file.size > 50 * 1024 ** 2) throw Error("Maximum file size is 50 MB");
        const upload = new FormData();
        upload.set("name", name);
        upload.set("file", file);
        body = upload;
      } else {
        body = JSON.stringify({ name, ...(isLink ? { url: form.get("url") } : {}) });
      }
      await request("/documents/" + doc.id, { method: "PATCH", body });
      onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="modal edit-document-dialog"
      aria-labelledby="edit-document-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <button className="modal-close" aria-label="Close editor" disabled={busy} onClick={onClose}>
        <X size={20} />
      </button>
      <span className="modal-symbol"><Pencil size={24} /></span>
      <h2 id="edit-document-title">{isLink ? "Edit link" : "Edit document"}</h2>
      <p className="muted">
        {isLink ? "Update the name or destination of your link." : "Rename your document or upload a replacement."}
      </p>
      <form onSubmit={save} aria-busy={busy}>
        <fieldset disabled={busy}>
          <label>
            {isLink ? "Link name" : "Document name"}
            <input name="name" autoFocus required maxLength={120} defaultValue={doc.name} />
          </label>
          {isLink ? (
            <label>
              Document URL
              <input name="url" type="url" required maxLength={2048} defaultValue={doc.url} />
              <small>Use a secure HTTPS link.</small>
            </label>
          ) : (
            <>
              <p className="muted current-document">Current file: {doc.originalName || doc.name}</p>
              <label className="drop-zone">
                <UploadCloud size={28} />
                <strong>{file ? file.name : "Choose a replacement file (optional)"}</strong>
                <span>PowerPoint, PDF, or Word · Up to 50 MB</span>
                <input
                  ref={fileInput}
                  aria-label="Replacement file"
                  type="file"
                  accept=".pptx,.pdf,.docx"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
              </label>
              {file && (
                <button type="button" className="secondary" onClick={() => {
                  setFile(null);
                  if (fileInput.current) fileInput.current.value = "";
                }}>
                  Keep current file
                </button>
              )}
              <p className="muted replacement-note">
                A replacement permanently removes the previous file and its preview after saving.
                Leave the file unchanged to update only the name.
              </p>
            </>
          )}
          {error && <div className="error" role="alert">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button className="primary" type="submit">
              {busy && <LoaderCircle size={17} className="spin" />}
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}
