/**
 * Records docs/demo-pipeline.gif: a terminal page where the real output of
 * `pnpm pipeline --date <day> --dry-run --verbose` is streamed as it happens,
 * so the gif shows Jev's actual per-item latency and the day's wall time.
 *
 *   pnpm demo:pipeline [--date 2026-09-17]
 *
 * Needs TYPESAFE_API_KEY (read from .env). Costs one real day of Jev calls (~$0.01).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadDotenv, record, ROOT } from "./lib.ts";

const { values } = parseArgs({ options: { date: { type: "string", default: "2026-09-17" } } });
const date = values.date!;
const shownCommand = `pnpm pipeline --date ${date} --dry-run --verbose`;

const rec = await record({ width: 1100, height: 640 });
const { page } = rec;
await page.goto(`file://${path.join(ROOT, "demo", "terminal.html")}`);
await page.evaluate(() => document.fonts.ready.then(() => true));
await page.waitForTimeout(800);

// Type the command.
await page.evaluate(() => (window as any).term.prompt());
for (const ch of shownCommand) {
  await page.evaluate((c) => (window as any).term.type(c), ch);
  await page.waitForTimeout(ch === " " ? 90 : 38);
}
await page.waitForTimeout(500);
await page.evaluate(() => (window as any).term.run());

// Run it for real and mirror every line into the page the moment it arrives.
const env = { ...process.env, ...(await loadDotenv()) };
const child = spawn("pnpm", ["--silent", "pipeline", "--date", date, "--dry-run", "--verbose"], { cwd: ROOT, env });
const push = (s: string) => page.evaluate((l) => (window as any).term.line(l), s);
let queue: Promise<unknown> = Promise.resolve();
const pipe = (stream: NodeJS.ReadableStream) => {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) queue = queue.then(() => push(l));
  });
  stream.on("end", () => {
    if (buf) queue = queue.then(() => push(buf));
  });
};
pipe(child.stdout);
pipe(child.stderr);
const code = await new Promise<number>((resolve) => child.on("close", (c) => resolve(c ?? 1)));
await queue;
if (code !== 0) {
  await rec.browser.close();
  throw new Error(`pipeline exited with code ${code}`);
}

await page.evaluate(() => (window as any).term.prompt());
await page.waitForTimeout(3500);

const gif = await rec.finish("demo-pipeline.gif", { width: 960, fps: 10, colors: 128, tailHold: 2 });
console.log(`wrote ${gif}`);
