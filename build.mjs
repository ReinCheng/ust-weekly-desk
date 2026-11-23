import { copyFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });
await Promise.all([
  build({
    entryPoints: ["main.tsx"],
    bundle: true,
    outfile: "dist/desk.js",
    jsx: "automatic",
    format: "esm",
    minify: true,
  }),
  ...["index.html", "favicon.svg", "calendar.json"].map(file => copyFile(file, "dist/" + file)),
]);
