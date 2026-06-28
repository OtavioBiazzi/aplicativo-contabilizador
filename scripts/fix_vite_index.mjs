import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const indexPath = path.resolve("dist", "index.html");
const html = await readFile(indexPath, "utf8");

await writeFile(indexPath, html.replaceAll(" crossorigin", ""), "utf8");

