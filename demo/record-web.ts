/**
 * Records docs/demo-web.gif: builds the site, serves it with `astro preview` and walks
 * through one day (stats, relevant items with their excerpt, filters, next day, how it works).
 *
 *   pnpm demo:web [--date 2026-09-17]
 */
import { spawn, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { glideClick, installCursor, record, ROOT, smoothScroll, smoothScrollTo } from "./lib.ts";

const { values } = parseArgs({ options: { date: { type: "string", default: "2026-09-17" } } });
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;

// Fresh build so the gif always matches the current design.
const build = spawnSync("pnpm", ["build"], { cwd: ROOT, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);
const server = spawn("pnpm", ["exec", "astro", "preview", "--ignore-lock", "--port", String(PORT), "--host", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => server.kill());
await waitForServer(`${BASE}/`);

const rec = await record({ width: 1180, height: 740 });
const { page } = rec;
await installCursor(page);
// The site scrolls smoothly on its own; the recorder drives the scroll itself.
await page.addInitScript({ content: 'document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.scrollBehavior = "auto"; });' });
const pause = (ms: number) => page.waitForTimeout(ms);

// 1. The day: masthead + performance stats + relevant items.
await page.goto(`${BASE}/dia/${values.date}/`);
await page.mouse.move(700, 420, { steps: 1 });
await pause(2600);

// 2. Relevant items with the excerpt Jev picked.
await smoothScroll(page, 470, 800);
await pause(2600);
await smoothScrollTo(page, "#hidden-note", 560, 800);
await pause(1800);

// 3. "Mostrar todas": the whole day, not only what is relevant.
await glideClick(page, "#show-all");
await pause(1800);

// 4. Category chips (any of the selected ones), then clear.
await smoothScrollTo(page, ".filters", 70, 800);
await pause(500);
await glideClick(page, '.chip[data-cat="oposiciones-y-empleo-publico"]');
await pause(1800);
await smoothScroll(page, 420, 700);
await pause(1600);
await smoothScroll(page, -420, 600);
await pause(300);
await glideClick(page, '.chip[data-cat="vivienda"]');
await pause(1600);
await glideClick(page, "#clear-cats");
await pause(1000);

// 5. Next day (gaps such as Sundays are skipped automatically).
await smoothScrollTo(page, "body", 0, 600);
await pause(300);
await glideClick(page, 'a[rel="next"]');
await page.waitForLoadState("load");
await page.mouse.move(700, 430, { steps: 1 });
await pause(2600);

// 6. How it works.
await smoothScrollTo(page, "#como-funciona", 40, 1000);
await pause(3500);

const gif = await rec.finish("demo-web.gif", { width: 1000, fps: 12, colors: 64, tailHold: 2 });
server.kill();
console.log(`wrote ${gif}`);

async function waitForServer(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`preview server did not start at ${url}`);
}
