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
  const relative = path.relative(process.cwd(), file);
  const lines = text.split("\n").length;
  if (lines >= 200) failures.push(`${relative} has ${lines} lines`);
  if (text.includes("\u2014")) failures.push(`${relative} contains forbidden punctuation`);
  if (
    path.extname(file) === ".tsx" &&
    !relative.endsWith(path.join("components", "Button", "Button.tsx")) &&
    /<button\b/.test(text)
  ) {
    failures.push(`${relative} bypasses the shared Button component`);
  }
}

visit(path.join(process.cwd(), "src"));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
