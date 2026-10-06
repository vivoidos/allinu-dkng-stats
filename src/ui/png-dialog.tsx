// "Download PNG": the whole page, or any of its parts in any order, as one image, with a preview of exactly what will be saved.

import { useEffect, useRef, useState } from "react";
import { pngIdle, pngParts, renderPng, saveBlob, type PngPart } from "./screenshot.ts";

export function PngDialog({ open, onClose, caption, fileName }: { open: boolean; onClose: () => void; caption: string; fileName: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [parts, setParts] = useState<PngPart[]>([]);
  const [mode, setMode] = useState<"full" | "custom">("full");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState<string[]>([]); // the stories as they go in the image; the hero is always first
  const [preview, setPreview] = useState<{ url: string; ready: boolean } | null>(null);
  const [saving, setSaving] = useState<"idle" | "busy" | "failed">("idle");

  const page = () => document.getElementById("top");
  const keep = mode === "full" ? parts.map((p) => p.id) : ["hero", ...order].filter((id) => picked.has(id) && parts.some((p) => p.id === id));
  const keepKey = keep.join();

  // open and close with the parent's state; read the parts each time it opens, so the labels carry today's numbers
  useEffect(() => {
    const el = dialog.current, root = page();
    if (!el || !root) return;
    if (open && !el.open) {
      const found = pngParts(root);
      setParts(found);
      setPicked((prev) => (prev.size ? prev : new Set(found.map((p) => p.id))));
      const stories = found.map((p) => p.id).filter((id) => id !== "hero");
      setOrder((prev) => (prev.length === stories.length && prev.every((id) => stories.includes(id)) ? prev : stories));
      el.showModal();
    } else if (!open && el.open) el.close();
  }, [open]);

  // a small preview of exactly what will be saved, redrawn when the choice changes
  useEffect(() => {
    const root = page();
    if (!open || !root || !keep.length) { setPreview(null); return; }
    const stop = new AbortController();
    setPreview((p) => (p ? { ...p, ready: false } : null));
    const timer = setTimeout(async () => {
      try {
        const blob = await renderPng(root, keep, caption, { maxPixelRatio: 0.6, signal: stop.signal });
        if (!stop.signal.aborted) setPreview({ url: URL.createObjectURL(blob), ready: true });
      } catch { if (!stop.signal.aborted) setPreview(null); }
    }, 250);
    return () => { stop.abort(); clearTimeout(timer); };
  }, [open, keepKey]);
  // each preview's image is let go once it is replaced or the dialog closes
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview?.url]);

  // drawing rearranges the page behind the dialog for a moment: close only once it is put back
  const [closing, setClosing] = useState(false);
  const requestClose = async () => {
    if (closing) return;
    setClosing(true);
    await pngIdle();
    setClosing(false);
    onClose();
  };

  const save = async () => {
    const root = page();
    if (!root || !keep.length || saving === "busy") return;
    setSaving("busy");
    try {
      saveBlob(await renderPng(root, keep, caption), fileName);
      setSaving("idle");
    } catch {
      setSaving("failed");
    }
  };

  const move = (id: string, by: -1 | 1) => setOrder((prev) => {
    const i = prev.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  });
  const listed = [...parts.filter((p) => p.id === "hero"), ...order.flatMap((id) => parts.filter((p) => p.id === id))];

  const toggle = (id: string) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <dialog ref={dialog} className="pdialog" aria-labelledby="pdialog-h" onClose={onClose}
      onCancel={(e) => { e.preventDefault(); void requestClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) void requestClose(); }}>
      <div className="pdialog-frame">
        <header className="mdialog-head">
          <div>
            <h2 id="pdialog-h">Download as PNG</h2>
            <p>The whole page or the parts you pick, as one image.</p>
          </div>
          <button type="button" className="mdialog-close" aria-label="Close" onClick={() => void requestClose()}>
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
                {listed.map((p) => {
                  const i = order.indexOf(p.id);
                  return (
                    <div key={p.id} className="prow">
                      <label className="ppart"><input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} /><span>{p.label}</span></label>
                      {i >= 0 && (
                        <div className="pmove">
                          <button type="button" aria-label={`Move up: ${p.label}`} disabled={i === 0} onClick={() => move(p.id, -1)}>
                            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 8.5L7 5l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                          <button type="button" aria-label={`Move down: ${p.label}`} disabled={i === order.length - 1} onClick={() => move(p.id, 1)}>
                            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 5.5L7 9l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </fieldset>
            )}
            <button type="button" className="button pdialog-save" onClick={save} disabled={!keep.length || saving === "busy"}>
              {saving === "busy" ? "Saving…" : saving === "failed" ? "Try again" : keep.length ? "Download PNG" : "Pick at least one part"}
            </button>
          </div>
          <div className="pdialog-preview" aria-live="polite">
            {preview
              ? <img src={preview.url} alt="Preview of the image" className={preview.ready ? "" : "stale"} />
              : <p className="pdialog-wait">{keep.length ? "Drawing the preview…" : "Nothing picked yet."}</p>}
          </div>
        </div>
      </div>
    </dialog>
  );
}
