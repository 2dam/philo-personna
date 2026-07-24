import { readFile, writeFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../public/advisors-1000.json", import.meta.url), "utf8"));
if (catalog.count !== 1000 || catalog.records.length !== 1000) {
  throw new Error("The advisor catalog must contain exactly 1,000 records.");
}

const indexUrl = new URL("../index.html", import.meta.url);
const html = await readFile(indexUrl, "utf8");
const embedded = html.replace(
  /\/\* ADVISORS_START \*\/[\s\S]*?\/\* ADVISORS_END \*\//,
  `/* ADVISORS_START */${JSON.stringify(catalog.records)}/* ADVISORS_END */`,
);
if (embedded === html) throw new Error("Advisor embed marker was not found.");
await writeFile(indexUrl, embedded, "utf8");
console.log("Embedded 1,000 advisor records into index.html.");

