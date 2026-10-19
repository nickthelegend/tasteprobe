// Reasoning models may wrap JSON in prose or <think> blocks; take the last parseable object.
export function parseJsonObject(text) {
  const cleaned = String(text).replace(/<think>[\s\S]*?<\/think>/g, "");
  for (let end = cleaned.lastIndexOf("}"); end >= 0; end = cleaned.lastIndexOf("}", end - 1)) {
    for (let start = cleaned.lastIndexOf("{", end); start >= 0; start = start > 0 ? cleaned.lastIndexOf("{", start - 1) : -1) {
      try {
        const value = JSON.parse(cleaned.slice(start, end + 1));
        if (value && typeof value === "object" && !Array.isArray(value)) return value;
      } catch { /* keep widening */ }
    }
  }
  throw new Error(`Nemotron returned no JSON object: ${String(text).slice(0, 160)}`);
}
