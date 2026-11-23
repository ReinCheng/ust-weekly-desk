import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
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
  ...["index.html", "favicon.svg"].map(file => copyFile(file, "dist/" + file)),
  readFile("calendar.json", "utf8").then(raw => writeFile("dist/calendar.json", JSON.stringify(JSON.parse(raw)))),
]);
