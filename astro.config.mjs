// @ts-check
import { defineConfig } from "astro/config";

// GitHub Pages serves project sites under /<repo>/. The workflow sets these
// from the repository name; local dev falls back to the root.
const site = process.env.SITE_URL ?? "http://localhost:4321";
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  site,
  base,
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
});
