// "Data & methodology": one dialog with how every number is measured, its data and where it comes from.
// Each story writes its own section into the dialog (a portal), so a number's method and data stay next to
// its chart in App.tsx; this file only owns the dialog, its navigation and the "About this data" section.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Snapshot } from "../core/stats/index.ts";
import { time } from "./format.ts";

const ABOUT = "about";

interface Methodology {
  /** Opens the dialog, scrolled to a story's section (or to "About this data"). */
  open(id?: string): void;
  nav: HTMLElement | null;
  sections: HTMLElement | null;
  active: string;
}
const Ctx = createContext<Methodology>({ open: () => {}, nav: null, sections: null, active: ABOUT });
export const useMethodology = () => useContext(Ctx);

export function MethodologyDialog({ d, repo, children }: { d: Snapshot; repo: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [nav, setNav] = useState<HTMLElement | null>(null);
  const [sections, setSections] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(ABOUT);

  const open = useCallback((id = ABOUT) => {
    const el = dialog.current, content = body.current;
    if (!el || !content) return;
    const opening = !el.open;
    if (opening) el.showModal();
    const target = content.querySelector<HTMLElement>(`[data-section="${id}"]`);
    // straight to the section when the dialog opens; a glide between sections once it is open
    const glide = !opening && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (target) content.scrollTo({ top: target.offsetTop, behavior: glide ? "smooth" : "instant" });
    // focus the content, not the first button: arrow keys and Page Down scroll it right away
    if (opening) content.focus({ preventScroll: true });
    setActive(id);
  }, []);

  // the nav follows whichever section is at the top of the scrolled content
  useEffect(() => {
    const root = body.current;
    if (!root) return;
    const onScroll = () => {
      const top = root.scrollTop + 24;
      let current = ABOUT;
      for (const s of root.querySelectorAll<HTMLElement>("[data-section]")) if (s.offsetTop <= top) current = s.dataset.section ?? current;
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) current = [...root.querySelectorAll<HTMLElement>("[data-section]")].at(-1)?.dataset.section ?? current;
      setActive(current);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <Ctx.Provider value={{ open, nav, sections, active }}>
      {children}
      <dialog ref={dialog} className="mdialog" aria-labelledby="mdialog-h"
        // a click on the backdrop lands on the <dialog> itself, never on its contents
        onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
        <div className="mdialog-frame">
          <header className="mdialog-head">
            <div>
              <h2 id="mdialog-h">How it&apos;s measured</h2>
              <p>Method, data and source for every number on the page.</p>
            </div>
            <button type="button" className="mdialog-close" aria-label="Close" onClick={() => dialog.current?.close()}>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
            </button>
          </header>
          <nav className="mdialog-nav" aria-label="Sections">
            <NavItem id={ABOUT} label="About this data" active={active} open={open} />
            <div ref={setNav} className="mdialog-nav-items" />
          </nav>
          <div ref={body} className="mdialog-body" tabIndex={-1}>
            <About d={d} repo={repo} />
            <div ref={setSections} />
          </div>
        </div>
      </dialog>
    </Ctx.Provider>
  );
}

function NavItem({ id, label, active, open }: { id: string; label: string; active: string; open: (id: string) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  // on a phone the nav is a row of tabs: keep the current one in view
  useEffect(() => { if (id === active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [id, active]);
  return (
    <button ref={ref} type="button" className={id === active ? "mnav current" : "mnav"} aria-current={id === active ? "true" : undefined} onClick={() => open(id)}>
      {label}
    </button>
  );
}

export interface BlockSource { sources: string[]; computedAt: string }
const isUrl = (s: string) => /^https:\/\/[^\s{}]+$/.test(s);

/** A story's section in the dialog, written into it from wherever the story renders. */
export function MethodSection({ id, label, stat, claim, method, data, sources }: {
  id: string; label: string; stat: ReactNode; claim: ReactNode; method: ReactNode; data?: ReactNode; sources: BlockSource[];
}) {
  const { nav, sections, active, open } = useMethodology();
  if (!nav || !sections) return null;
  return <>
    {createPortal(<NavItem id={id} label={label} active={active} open={open} />, nav)}
    {createPortal(
      <section className="msection" data-section={id} aria-labelledby={`m-${id}-h`}>
        <p className="meyebrow">{label}</p>
        <h3 id={`m-${id}-h`}><span className="num">{stat}</span> {claim}</h3>
        <h4>How it's measured</h4>
        <div className="mprose">{method}</div>
        {data && <><h4>The data</h4>{data}</>}
        <h4>Source</h4>
        <ul className="msources">
          {sources.map((s, i) => (
            <li key={i}>
              {s.sources.map((src) => <code key={src}>{isUrl(src) ? <a href={src} target="_blank" rel="noopener">{src}</a> : src}</code>)}
              <span>computed <time dateTime={s.computedAt}>{time(s.computedAt)}</time></span>
            </li>
          ))}
        </ul>
      </section>,
      sections,
    )}
  </>;
}

function About({ d, repo }: { d: Snapshot; repo: string }) {
  return (
    <section className="msection" data-section={ABOUT} aria-labelledby="m-about-h">
      <p className="meyebrow">About this data</p>
      <h3 id="m-about-h">Public data, recomputed every day.</h3>
      <div className="mprose">
        <p>Every number here is computed from public onchain data and public APIs by open-source code, and published as one file, <code>snapshot.json</code>. The page shows nothing else.</p>
        <ul>
          <li>Every number is recomputed daily at 00:00 UTC, in one public run.</li>
          <li>Holder origins, wallets reached and routed volume read hundreds of thousands to millions of transactions; each run reads only what is new since the last.</li>
          <li>Each section names its sources and when they ran.</li>
        </ul>
      </div>

      <h4>This snapshot</h4>
      <dl className="mfacts">
        <div><dt>Computed</dt><dd><time dateTime={d.computedAt}>{time(d.computedAt)}</time></dd></div>
        <div><dt>Run</dt><dd>{d.run ? <a href={d.run.log} target="_blank" rel="noopener">GitHub Actions log</a> : "outside GitHub Actions"}</dd></div>
        {d.run && <div><dt>Code</dt><dd><a href={`${d.run.repo}/tree/${d.run.commit}`} target="_blank" rel="noopener" className="mono">{d.run.commit.slice(0, 7)}</a></dd></div>}
        <div><dt>Solana RPC</dt><dd>{(d.solanaRpc ?? []).length > 1 ? `${d.solanaRpc.length} free public endpoints, in rotation` : d.solanaRpc?.[0] ?? "–"}</dd></div>
      </dl>

      <h4>Files</h4>
      <ul className="mfiles">
        <li><a href="snapshot.json" download>snapshot.json</a><span>every number on the page, with its source and time</span></li>
        {d.origins && <li><a href="holder-origins.csv" download>holder-origins.csv</a><span>one row per DKNG wallet: how it first got DKNG</span></li>}
        <li><a href={repo} target="_blank" rel="noopener">Source code</a><span>the calculations, the page, the daily run</span></li>
      </ul>

      <h4>Verify it</h4>
      <div className="mprose">
        <ul>
          <li>The sources are public and named in each section. Anyone can query them.</li>
          <li>The code is open. Runs happen on GitHub's servers; each public log shows the code at a commit fetching every source and printing its results.</li>
          <li>Recompute it: <code>node scripts/snapshot.ts</code> with Node 22.18+. No install, no keys for the daily blocks.</li>
          <li>Without a Birdeye key, volume comes from GeckoTerminal, within a few percent of the figures shown, and leaves out the DKNG markets GeckoTerminal doesn't list.</li>
          <li>Routed volume needs an RPC that serves <code>getTransactionsForAddress</code>.</li>
        </ul>
      </div>
    </section>
  );
}
