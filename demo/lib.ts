/**
 * Shared helpers for the demo recorders: system Chrome via playwright-core,
 * screencast capture, a visible cursor (headless has none) and frames → gif via ffmpeg.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

const exec = promisify(execFile);

export const ROOT = path.resolve(import.meta.dirname, "..");
export const DOCS_DIR = path.join(ROOT, "docs");

export interface Recording {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Stops capturing, encodes the frames and writes the gif to `docs/`. */
  finish(gifName: string, opts: GifOptions): Promise<string>;
}

interface Frame {
  png: Buffer;
  /** Seconds, from the screencast's wall clock. */
  ts: number;
}

/**
 * Launches the system Chrome headless and captures the page through CDP's screencast:
 * lossless PNG frames, emitted only when the page repaints, with real timestamps.
 * (Playwright's `recordVideo` is VP8, whose noise makes every static frame cost in the gif.)
 */
export async function record(size: { width: number; height: number }): Promise<Recording> {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, locale: "es-ES", colorScheme: "light" });
  // tsx (esbuild keepNames) wraps inner functions in `__name(...)`; Playwright ships that
  // source to the browser verbatim, so the helper must exist there.
  await context.addInitScript({ content: "globalThis.__name ??= (fn) => fn;" });
  const page = await context.newPage();

  const frames: Frame[] = [];
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", (ev: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    frames.push({ png: Buffer.from(ev.data, "base64"), ts: ev.metadata.timestamp ?? performance.now() / 1000 });
    cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });

  return {
    browser,
    context,
    page,
    async finish(gifName, opts) {
      await page.waitForTimeout(100);
      const endTs = frames.length ? frames[frames.length - 1]!.ts + (opts.tailHold ?? 1.5) : 0;
      await cdp.send("Page.stopScreencast").catch(() => {});
      await browser.close();
      if (frames.length === 0) throw new Error("no frames captured");
      const gif = path.join(DOCS_DIR, gifName);
      await framesToGif(frames, endTs, gif, opts);
      return gif;
    },
  };
}

export interface GifOptions {
  width: number;
  /** Frame-rate cap: frames closer than 1/fps to the previous kept frame are dropped. */
  fps: number;
  /** Palette size; flat UIs need far fewer than 256 and compress much better. */
  colors?: number;
  /** Dithering adds per-frame noise that inflates gifs of flat UIs; off by default. */
  dither?: "none" | "bayer";
  /** Seconds the last frame stays on screen before the loop restarts. */
  tailHold?: number;
}

/**
 * PNG frames with timestamps → gif with per-frame delays (ffmpeg concat demuxer + palette).
 * `stats_mode=full`, not `diff`: with a small palette, `diff` drops the colours of static pixels
 * (the window buttons turned grey).
 */
export async function framesToGif(frames: Frame[], endTs: number, gif: string, { width, fps, colors = 128, dither = "none" }: GifOptions): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "boe-demo-"));
  const kept: Frame[] = [];
  for (const f of frames) {
    const last = kept[kept.length - 1];
    if (!last || f.ts - last.ts >= 1 / fps) kept.push(f);
  }
  const lines: string[] = [];
  for (let i = 0; i < kept.length; i++) {
    const name = `f${String(i).padStart(5, "0")}.png`;
    await writeFile(path.join(tmp, name), kept[i]!.png);
    const next = i + 1 < kept.length ? kept[i + 1]!.ts : endTs;
    lines.push(`file '${name}'`, `duration ${Math.max(0.02, next - kept[i]!.ts).toFixed(3)}`);
  }
  // The concat demuxer ignores the last entry's duration unless the file is listed once more.
  lines.push(lines[lines.length - 2]!);
  const list = path.join(tmp, "frames.txt");
  await writeFile(list, lines.join("\n") + "\n");
  const use = dither === "bayer" ? "dither=bayer:bayer_scale=5" : "dither=none";
  const filter = [
    `scale=${width}:-1:flags=lanczos`,
    "split[a][b]",
    `[a]palettegen=stats_mode=full:max_colors=${colors}[p]`,
    `[b][p]paletteuse=${use}:diff_mode=rectangle`,
  ].join(",");
  await exec("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", filter, "-fps_mode", "passthrough", gif]);
  if (process.env.DEMO_KEEP_FRAMES) console.log(`frames kept in ${tmp}`);
  else await rm(tmp, { recursive: true, force: true });
}

/** Adds a fake cursor that follows the mouse and pulses on click. Survives navigations. */
export async function installCursor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const css = `
      #demo-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -5px 0 0 -5px;
        border-radius: 50%; background: rgba(20, 20, 20, 0.85); border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.35);
        pointer-events: none; transition: transform .12s ease; left: -100px; top: -100px; }
      #demo-cursor.down { transform: scale(0.7); }
      #demo-cursor::after { content: ""; position: absolute; inset: -14px; border-radius: 50%;
        border: 2px solid rgba(20,20,20,.5); opacity: 0; }
      #demo-cursor.down::after { animation: demo-ripple .45s ease-out; }
      @keyframes demo-ripple { from { transform: scale(.3); opacity: .9 } to { transform: scale(1.2); opacity: 0 } }
    `;
    const mount = () => {
      if (document.getElementById("demo-cursor")) return;
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
      const el = document.createElement("div");
      el.id = "demo-cursor";
      document.body.appendChild(el);
      const w = window as unknown as { __cursor?: { x: number; y: number } };
      if (w.__cursor) {
        el.style.left = `${w.__cursor.x}px`;
        el.style.top = `${w.__cursor.y}px`;
      }
      document.addEventListener("mousemove", (e) => {
        el.style.left = `${e.clientX}px`;
        el.style.top = `${e.clientY}px`;
        w.__cursor = { x: e.clientX, y: e.clientY };
      }, true);
      document.addEventListener("mousedown", () => el.classList.add("down"), true);
      document.addEventListener("mouseup", () => setTimeout(() => el.classList.remove("down"), 120), true);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
    else mount();
  });
}

/** Moves the mouse to the centre of `selector` in a visible glide, then clicks. */
export async function glideClick(page: Page, selector: string, opts: { hover?: number } = {}): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`glideClick: ${selector} not visible`);
  const x = box.x + Math.min(box.width / 2, 60);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 28 });
  await page.waitForTimeout(opts.hover ?? 350);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}

/** Scrolls the window by `dy` pixels over `ms` milliseconds with an ease-in-out curve. */
export async function smoothScroll(page: Page, dy: number, ms: number): Promise<void> {
  await page.evaluate(
    ({ dy, ms }) =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        const from = window.scrollY;
        const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
        const step = () => {
          const t = Math.min(1, (performance.now() - start) / ms);
          window.scrollTo(0, from + dy * ease(t));
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    { dy, ms },
  );
}

/** Scrolls so that `selector` sits `offset` px below the top of the viewport. */
export async function smoothScrollTo(page: Page, selector: string, offset: number, ms: number): Promise<void> {
  const top = await page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().top);
  await smoothScroll(page, top - offset, ms);
}

/** Minimal `.env` reader (KEY=VALUE, `#` comments) so the recorders can pass TYPESAFE_API_KEY to the pipeline. */
export async function loadDotenv(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = await readFile(path.join(ROOT, ".env"), "utf8");
  } catch {
    return out;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}
