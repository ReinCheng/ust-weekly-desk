import { build } from "esbuild";

await build({
  entryPoints: ["refresh.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "calendar-refresh.mjs",
});
await import("./calendar-refresh.mjs");
