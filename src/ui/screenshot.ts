// The PNG download: the hero and any of the stories, in the order picked, as one image, with one line under them
// (date, how to verify, "not financial advice"). The open-code section, the footer and dialogs are never drawn.
// html-to-image is loaded only when someone asks for an image, so it adds nothing to opening the page.

/** Browsers refuse canvases past ~16.7M pixels (iOS Safari): a tall image is drawn at a lower pixel ratio. */
const MAX_PIXELS = 16_000_000;
/** What an image never includes. */
const SKIP = "footer, dialog, .no-capture";

/** A part of the page an image can be made of. */
export interface PngPart { id: string; label: string }

/** The hero and every story, in page order. */
export function pngParts(page: HTMLElement): PngPart[] {
  const parts: PngPart[] = [];
  const hero = page.querySelector<HTMLElement>("section.intro");
  if (hero) parts.push({ id: "hero", label: (hero.querySelector("h1")?.textContent ?? "Headline").replace(/\s+/g, " ").trim() });
  for (const s of page.querySelectorAll<HTMLElement>("section.story")) {
    const stat = s.querySelector(".stat")?.textContent ?? "", claim = s.querySelector(".claim")?.textContent ?? "";
    parts.push({ id: s.id, label: `${stat} ${claim}`.trim() });
  }
  return parts;
}

const partElement = (page: HTMLElement, id: string) =>
  id === "hero" ? page.querySelector<HTMLElement>("section.intro") : page.querySelector<HTMLElement>(`section.story#${CSS.escape(id)}`);

// one image at a time: drawing hides parts of the live page, so two draws must never overlap
let queue: Promise<unknown> = Promise.resolve();
// the page's web fonts, fetched and embedded once and reused by every image (refetching per image can fail quietly,
// and the image then falls back to a system font)
let fonts: Promise<string | undefined> | undefined;

/**
 * Draws the parts in `keep` as one PNG, in that order (the hero, if kept, always comes first). The other parts are
 * hidden and the kept stories reordered while it draws, with CSS only (the page is put back right after), so the
 * image is exactly what the browser renders, charts and the bulb-lit amount included.
 */
export function renderPng(page: HTMLElement, keep: readonly string[], caption: string, maxPixelRatio = 2): Promise<Blob> {
  const job = queue.then(() => draw(page, keep, caption, maxPixelRatio));
  queue = job.catch(() => undefined);
  return job;
}

async function draw(page: HTMLElement, keep: readonly string[], caption: string, maxPixelRatio: number): Promise<Blob> {
  const { toBlob, getFontEmbedCSS } = await import("html-to-image");
  fonts ??= getFontEmbedCSS(page).catch(() => { fonts = undefined; return undefined; });
  const fontEmbedCSS = await fonts;
  const scrollY = window.scrollY;
  // every inline style changed while drawing, with its old value, to put back afterwards
  const changed: [HTMLElement, string, string][] = [];
  const set = (el: HTMLElement | null | undefined, prop: string, value: string) => {
    if (!el) return;
    changed.push([el, prop, el.style.getPropertyValue(prop)]);
    el.style.setProperty(prop, value);
  };
  for (const part of pngParts(page)) if (!keep.includes(part.id)) set(partElement(page, part.id), "display", "none");
  const stories = page.querySelector<HTMLElement>(".stories");
  const kept = keep.filter((id) => id !== "hero").map((id) => partElement(page, id)).filter((el): el is HTMLElement => !!el);
  // the stories in the picked order, still zigzagging left and right: the page alternates them by their place in it,
  // which no longer matches once some are left out or moved (on a narrow page they are stacked, nothing to alternate)
  set(stories, "display", kept.length ? "flex" : "none");
  set(stories, "flex-direction", "column");
  const wide = matchMedia("(min-width: 961px)").matches;
  kept.forEach((el, i) => {
    set(el, "order", String(i));
    if (!wide) return;
    set(el, "grid-template-columns", i % 2 ? "minmax(0, 7fr) minmax(0, 5fr)" : "minmax(0, 5fr) minmax(0, 7fr)");
    set(el.querySelector<HTMLElement>(".story-text"), "order", i % 2 ? "2" : "0");
  });
  // without the hero, the stories' top margin would sit outside what is measured and push the image down
  if (!keep.includes("hero")) set(stories, "margin-top", "0");
  const shown = () => [...page.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !c.matches(SKIP) && c.style.display !== "none");
  const line = Object.assign(document.createElement("p"), { className: "png-caption wrap", textContent: caption });
  shown().at(-1)?.after(line);
  try {
    // as tall as what is drawn: the page's top to the bottom of its last visible part
    const top = page.getBoundingClientRect().top;
    const height = Math.ceil(Math.max(0, ...shown().map((c) => c.getBoundingClientRect().bottom - top)));
    const width = page.scrollWidth;
    const blob = await toBlob(page, {
      width,
      height,
      pixelRatio: Math.min(maxPixelRatio, Math.sqrt(MAX_PIXELS / (width * height))),
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      ...(fontEmbedCSS ? { fontEmbedCSS } : {}),
      filter: (node) => !(node instanceof HTMLElement && (node.matches(SKIP) || node.style.display === "none")),
    });
    if (!blob) throw new Error("the browser could not draw the page");
    return blob;
  } finally {
    line.remove();
    for (const [el, prop, value] of changed.reverse()) el.style.setProperty(prop, value);
    window.scrollTo({ top: scrollY, behavior: "instant" });
  }
}

/** Hands the image to the browser as a download. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
