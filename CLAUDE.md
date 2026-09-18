# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Demo of Jev (TypeSafe's System One model) applied to Spain's official gazette (BOE). A TypeScript pipeline reads each day's BOE, asks Jev closed questions per disposition, and stores the answers plus latency as JSON in `data/`. An Astro static site renders one page per day. GitHub Actions runs it daily and deploys to GitHub Pages. UI copy is Spanish; code, comments and Jev instructions are English.

## Commands

```sh
pnpm install                       # pnpm 11; esbuild build script is allowed via pnpm-workspace.yaml
set -a; . ./.env; set +a           # pipeline reads TYPESAFE_API_KEY from env (see .env.example)

pnpm pipeline --today              # analyze today's BOE → data/days/YYYY-MM-DD.json + data/index.json
pnpm pipeline --date 2026-09-17    # one day; add --force to reanalyze an existing file
pnpm pipeline --backfill 7         # last N calendar days, skipping days without a BOE
pnpm pipeline --date 2026-09-17 --dry-run --verbose   # analyze, print one line per item as it lands, write nothing
pnpm calibrate --date 2026-09-17 --limit 15 [--section 1|2B|3] [--ids BOE-A-...,...] [--lang es|en] [--full]
                                   # prints scores/categories/excerpts for eyeballing; never writes data/
pnpm check                         # tsc over pipeline/ (tsconfig.pipeline.json)
pnpm dev | pnpm build | pnpm preview
BASE_PATH=/repo/ SITE_URL=https://user.github.io pnpm build   # what the workflow does for GitHub Pages
pnpm demo:web | pnpm demo:pipeline   # re-record docs/demo-*.gif (demo/, playwright-core on system Chrome + ffmpeg)
```

There are no automated tests. Quality is checked with `pnpm calibrate` against real BOE days; the plan file in `~/.claude/plans/` lists expected outcomes (e.g. RD 731/2026 should score ≤ 1, regional budget laws ≈ 2).

Scratch scripts outside the project must use `.mts` (top-level await needs ESM; only the project's `package.json` has `"type": "module"`).

## Architecture

Data flow: `pipeline/boe.ts` → `pipeline/questions.ts` + `pipeline/analyze.ts` → `pipeline/run.ts` writes `data/` → `src/lib/data.ts` loads it at build time → Astro pages.

### Jev constraints that shape the design
- **Jev does not generate text.** Only `score` (ordered rubric), `noul` (yes/no probability) and `choice` (pick one label). The per-item "summary" is therefore an original BOE paragraph that Jev *selects* via a `choice` over paragraph ids (`p1`…`pN`); code maps the id back to text.
- **State limit 32k tokens, context rot.** Items are cut to `MAX_CHARS` (20k) after `stripIndex()` removes the table of contents that opens long laws (without that, the first 80 paragraphs of a Ley were all ÍNDICE lines). `choice` accepts ≤ 255 options, hence `MAX_PARAGRAPHS = 200`.
- **English-first model.** Question instructions are English; `state` is Spanish BOE text. `questions.ts` keeps an `es` variant only for `calibrate --lang es` comparisons.
- Jev reads literally: earlier wording made it pick promulgation boilerplate ("Sea notorio… a todos los ciudadanos") as the excerpt. `isHeading()` in `questions.ts` filters headings/boilerplate out of the candidate set, and the instruction explicitly excludes them.

### Where the policy lives
- `pipeline/questions.ts`: `CATEGORIES` (id, Spanish label, en/es description), `RELEVANCE_LEVELS`, question wording. Category noul wording is deliberately "contains at least one concrete measure about X": "centrally about" was too strict for omnibus laws, "materially affect" too loose.
- `pipeline/analyze.ts`: `CATEGORY_THRESHOLD` (0.6), `RELEVANT_SCORE` (2.0), `LOW_CONFIDENCE` (0.4). Day files store raw probabilities (`categoriasRaw`, `relevancia.probabilities`), so thresholds can change and the site rebuilt without calling Jev again; the site imports these constants directly from the pipeline.
- `pipeline/boe.ts`: `SECTIONS` = I, II-B, III only (nombramientos, contratación and anuncios are excluded on purpose).

### BOE API quirks (handled in `boe.ts`)
- Sumario: `https://www.boe.es/datosabiertos/api/boe/sumario/YYYYMMDD` with `Accept: application/json`. No auth. Sundays/holidays return HTTP 404 → `fetchSumario` returns `null` and the pipeline exits 0.
- Every list level (`diario`, `seccion`, `departamento`, `epigrafe`, `item`) is an object when it has one element: always go through `asArray`.
- Item XML (`xml.php?id=BOE-A-…`): `<texto>` also appears inside `<analisis><referencias>`, so the body is the `<texto>` after `</analisis>`. `<rango>` carries attributes, so parsed nodes are objects (`nodeText`). Tables are dropped because their cells contain `<p>` too.

### Data files
`data/days/YYYY-MM-DD.json` is a `DayFile` (`pipeline/types.ts`): `stats` (wall_ms, jev_ms_sum/avg/max/min, input_tokens, concurrency) and `items` sorted by relevance score. `data/index.json` is regenerated from all day files on every run. `data/` is committed by the workflow bot; it is the database.

### Site
- `src/lib/data.ts` globs `/data/days/*.json`; `neighbours()` derives prev/next from existing files, so gaps (Sundays) are skipped automatically.
- `src/components/DayView.astro` holds the only client JS: filters read/write `?todos=1&cat=a,b` and toggle `hidden` on `article.item` using `data-cats` / `data-score`. Everything else is build-time.
- Links must use `import.meta.env.BASE_URL` because GitHub Pages serves under `/<repo>/`.
- Astro collapses whitespace around line breaks before inline elements; keep `a <a>` on one line or use `{" "}`.

### Demo GIFs (`demo/`)
- `record-web.ts` builds the site, serves it with `astro preview --ignore-lock` on port 4399 and scripts a walkthrough; `record-pipeline.ts` types the command into `terminal.html` and streams the real stdout of `pnpm pipeline --dry-run --verbose` into it, so latencies in the gif are real (and vary per run; re-record if the API has a slow moment).
- Capture is CDP `Page.startScreencast` (lossless PNG frames only on repaint), not Playwright `recordVideo`: VP8 noise made every static frame cost in the gif. `framesToGif` caps fps, writes an ffmpeg concat list with per-frame durations and encodes with a small palette and no dither.
- `tsx` compiles with esbuild `keepNames`, which injects `__name(...)` into functions Playwright serializes for the browser; `record()` polyfills it with an init script.

### Workflow (`.github/workflows/daily.yml`)
One job: analyze (skipped on `push`) → commit `data/` if changed → decide → build → upload; a `deploy` job runs when `deploy=true`. On `schedule` it deploys only if data changed; `workflow_dispatch` and `push` always deploy. Bot pushes use `GITHUB_TOKEN`, so they do not retrigger the workflow.
