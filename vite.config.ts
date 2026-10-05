import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, sep } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The page's data, served at the site root (snapshots/snapshot.json → /snapshot.json).
const DATA = ["snapshot.json", "holder-origins.csv"];
// The code that produced it, published next to the page as-is at its repo path
// (the data code needs nothing but Node, so these files alone are enough to re-run every number).
const CODE = [
  "README.md",
  "scripts/snapshot.ts",
  ...readdirSync("src/core", { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `src/core/${f.split(sep).join("/")}`),
];

const publishData = (): Plugin => ({
  name: "publish-data",
  // `pnpm dev` serves snapshots/ at the root too, so the page fetches the same paths in both.
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const name = req.url?.split("?")[0]?.slice(1);
      if (!name || !DATA.includes(name) || !existsSync(`snapshots/${name}`)) return next();
      res.setHeader("Content-Type", name.endsWith(".json") ? "application/json" : "text/csv");
      res.end(readFileSync(`snapshots/${name}`));
    });
  },
  closeBundle() {
    const files: [string, string][] = [
      ...DATA.map((f): [string, string] => [`snapshots/${f}`, f]),
      ...CODE.map((f): [string, string] => [f, f]),
    ];
    for (const [from, to] of files.filter(([from]) => existsSync(from))) { // holder-origins.csv exists only after --with origins
      mkdirSync(dirname(`dist/${to}`), { recursive: true });
      copyFileSync(from, `dist/${to}`);
    }
  },
});

export default defineConfig({
  base: "./",
  plugins: [react(), publishData()],
  build: {
    // minified for a small download; the source maps let anyone read the original TypeScript in their browser
    sourcemap: true,
  },
});
