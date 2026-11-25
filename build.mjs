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
  readFile("replays.json", "utf8").then(raw => writeFile("dist/replays.json", JSON.stringify(JSON.parse(raw)))),
  readFile("market-history.json", "utf8").then(raw => writeFile("dist/market-history.json", JSON.stringify(JSON.parse(raw)))),
  readFile("alpha-paper.json", "utf8").then(raw => writeFile("dist/alpha-paper.json", JSON.stringify(JSON.parse(raw)))),
  readFile("alpha-ledger.json", "utf8").then(raw => writeFile("dist/alpha-ledger.json", JSON.stringify(JSON.parse(raw)))),
]);
