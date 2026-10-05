// "Download PNG": the page as one image: the headline and every story, without the open-code section and footer.
// html-to-image is loaded only when someone asks for the image, so it adds nothing to opening the page.

/** Browsers refuse canvases past ~16.7M pixels (iOS Safari): a tall page is drawn at a lower pixel ratio. */
const MAX_PIXELS = 16_000_000;
/** What the image leaves out. */
const SKIP = "footer, dialog, .no-capture";

/** `caption`: one line drawn under the last story (date, how to verify, "not financial advice"); the page never shows it. */
export async function downloadPagePng(page: HTMLElement, fileName: string, caption: string) {
  const { toBlob } = await import("html-to-image");
  const left = (node: Element) => !node.matches(SKIP);
  const line = Object.assign(document.createElement("p"), { className: "png-caption wrap", textContent: caption });
  [...page.children].filter(left).at(-1)?.after(line);
  try {
    await draw(page, fileName, toBlob, left);
  } finally {
    line.remove();
  }
}

async function draw(page: HTMLElement, fileName: string, toBlob: typeof import("html-to-image").toBlob, left: (node: Element) => boolean) {
  // as tall as what is drawn: the page's top to the bottom of its last part that isn't left out
  const top = page.getBoundingClientRect().top;
  const height = Math.ceil(Math.max(0, ...[...page.children].filter(left).map((c) => c.getBoundingClientRect().bottom - top)));
  const width = page.scrollWidth;
  const blob = await toBlob(page, {
    width,
    height,
    pixelRatio: Math.min(2, Math.sqrt(MAX_PIXELS / (width * height))),
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    filter: (node) => !(node instanceof HTMLElement && node.matches(SKIP)),
  });
  if (!blob) throw new Error("the browser could not draw the page");
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
