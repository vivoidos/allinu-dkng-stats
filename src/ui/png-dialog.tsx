// "Download PNG": the whole page, or any of its parts, as one image, with a preview of exactly what will be saved.

import { useEffect, useRef, useState } from "react";
import { pngParts, renderPng, saveBlob, type PngPart } from "./screenshot.ts";

export function PngDialog({ open, onClose, caption, fileName }: { open: boolean; onClose: () => void; caption: string; fileName: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [parts, setParts] = useState<PngPart[]>([]);
  const [mode, setMode] = useState<"full" | "custom">("full");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ url: string; ready: boolean } | null>(null);
  const [saving, setSaving] = useState<"idle" | "busy" | "failed">("idle");

  const page = () => document.getElementById("top");
  const keep = mode === "full" ? new Set(parts.map((p) => p.id)) : picked;
  const keepKey = [...keep].sort().join();

  // open and close with the parent's state; read the parts each time it opens, so the labels carry today's numbers
  useEffect(() => {
    const el = dialog.current, root = page();
    if (!el || !root) return;
    if (open && !el.open) {
      const found = pngParts(root);
      setParts(found);
      setPicked((prev) => (prev.size ? prev : new Set(found.map((p) => p.id))));
      el.showModal();
    } else if (!open && el.open) el.close();
  }, [open]);

  // a small preview of exactly what will be saved, redrawn when the choice changes
  useEffect(() => {
    const root = page();
    if (!open || !root || !keep.size) { setPreview(null); return; }
    let live = true;
    setPreview((p) => (p ? { ...p, ready: false } : null));
    const timer = setTimeout(async () => {
      try {
        const blob = await renderPng(root, keep, caption, 0.6);
        if (!live) return;
        const url = URL.createObjectURL(blob);
        setPreview((p) => { if (p) URL.revokeObjectURL(p.url); return { url, ready: true }; });
      } catch { if (live) setPreview(null); }
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [open, keepKey]);

  const save = async () => {
    const root = page();
    if (!root || !keep.size || saving === "busy") return;
    setSaving("busy");
    try {
      saveBlob(await renderPng(root, keep, caption), fileName);
      setSaving("idle");
    } catch {
      setSaving("failed");
    }
  };

  const toggle = (id: string) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <dialog ref={dialog} className="pdialog" aria-labelledby="pdialog-h" onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pdialog-frame">
        <header className="mdialog-head">
          <div>
            <h2 id="pdialog-h">Download as PNG</h2>
            <p>The whole page or the parts you pick, as one image.</p>
          </div>
          <button type="button" className="mdialog-close" aria-label="Close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
          </button>
        </header>
        <div className="pdialog-body">
          <div className="pdialog-pick">
            <fieldset>
              <legend className="sr-only">What to include</legend>
              <label className="pchoice"><input type="radio" name="png-mode" checked={mode === "full"} onChange={() => setMode("full")} /> Full page</label>
              <label className="pchoice"><input type="radio" name="png-mode" checked={mode === "custom"} onChange={() => setMode("custom")} /> Custom</label>
            </fieldset>
            {mode === "custom" && (
              <fieldset className="pparts">
                <legend className="sr-only">Parts to include</legend>
                {parts.map((p) => (
                  <label key={p.id} className="ppart"><input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} /><span>{p.label}</span></label>
                ))}
              </fieldset>
            )}
            <button type="button" className="button pdialog-save" onClick={save} disabled={!keep.size || saving === "busy"}>
              {saving === "busy" ? "Saving…" : saving === "failed" ? "Try again" : keep.size ? "Download PNG" : "Pick at least one part"}
            </button>
          </div>
          <div className="pdialog-preview" aria-live="polite">
            {preview
              ? <img src={preview.url} alt="Preview of the image" className={preview.ready ? "" : "stale"} />
              : <p className="pdialog-wait">{keep.size ? "Drawing the preview…" : "Nothing picked yet."}</p>}
          </div>
        </div>
      </div>
    </dialog>
  );
}
