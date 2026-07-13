import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const extensions = new Set([".ts", ".tsx", ".css", ".mjs", ".mdx"]);
const failures = [];

function visit(directory) {
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name);
    if (statSync(file).isDirectory()) visit(file);
    else if (extensions.has(path.extname(file))) inspect(file);
  }
}

function inspect(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n").length;
  if (lines >= 200) failures.push(`${path.relative(process.cwd(), file)} has ${lines} lines`);
  if (text.includes("\u2014")) failures.push(`${path.relative(process.cwd(), file)} contains forbidden punctuation`);
}

visit(path.join(process.cwd(), "src"));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
