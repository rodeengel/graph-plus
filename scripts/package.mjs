import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
if (manifest.id !== "graph-plus-semantic") throw new Error("Unexpected plugin identity");
const output = path.join(root, "dist", manifest.id);
await mkdir(output, { recursive: true });
for (const name of ["main.js", "manifest.json", "styles.css"]) {
  const source = path.join(root, name);
  if (!(await stat(source)).size) throw new Error(`Empty package file: ${name}`);
  await copyFile(source, path.join(output, name));
}
console.log(`Installable plugin: ${output}`);
