// Fails if app code contains placeholder-data markers or imports test fixtures (see CLAUDE.md).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const banned = /\b(mock|fake|dummy|lorem|TODO)\b|test\/fixtures/i;
const problems = [];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const file = join(directory, name);
    if (statSync(file).isDirectory()) walk(file);
    else readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      if (banned.test(line)) problems.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
}

walk("src");
if (problems.length) {
  console.error(`Placeholder markers found in src/:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("src/ is free of mock, fake, dummy, lorem and TODO markers.");
