// Deterministic cross-check for Nemotron's extraction: assistants are asked for a numbered list,
// so the venue names can also be read straight off the list items and compared.
import { matchesBrand, normalizeName } from "./taste.mjs";

const ITEM = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(\d{1,2})\s*[.)]\s*(.+)$/;

function cleanName(text) {
  let line = text.trim();
  const bold = line.match(/^\*\*(.+?)\*\*/) ?? line.match(/^__(.+?)__/);
  if (bold) line = bold[1];
  else {
    line = line.replace(/^\*\*/, "");
    // Name ends at the first separator: an en/em dash or hyphen with spaces, a colon or an opening bracket.
    line = line.split(/\s[–—-]\s|:\s|\s\(|\s\[/)[0];
  }
  line = line.replace(/\[(.+?)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/[\s:–—-]+$/, "").trim();
  return line;
}

// Names from "1. Name – why", "2) **Name** (area): why", "### 3. Name" and similar lines.
export function parseNumberedList(answer) {
  const names = [];
  for (const raw of String(answer ?? "").split(/\r?\n/)) {
    const match = raw.match(ITEM);
    if (!match) continue;
    const name = cleanName(match[2]);
    if (name && name.length <= 80 && !names.some((existing) => normalizeName(existing) === normalizeName(name))) names.push(name);
  }
  return names;
}

const covers = (list, name) => list.some((item) => matchesBrand(item, name) || matchesBrand(name, item));

// Compares the two readings of one answer. `list` is empty when the answer had no numbered list.
export function crossCheck(entities, list, brand, city) {
  if (!list.length) return { listed: false, brandAgrees: true, setAgrees: true, onlyInList: [], onlyInExtraction: [] };
  const onlyInList = list.filter((name) => !covers(entities, name));
  const onlyInExtraction = entities.filter((name) => !covers(list, name));
  const listBrand = list.some((name) => matchesBrand(name, brand, { city }));
  const extractedBrand = entities.some((name) => matchesBrand(name, brand, { city }));
  return { listed: true, brandAgrees: listBrand === extractedBrand, setAgrees: !onlyInList.length && !onlyInExtraction.length, onlyInList, onlyInExtraction };
}

// Per assistant: how often the deterministic parser and Nemotron disagree, over answers that had a list.
export function summarizeCrossCheck(rows, brand, city) {
  const byModel = new Map();
  for (const row of rows) {
    const current = byModel.get(row.model) ?? { model: row.model, answers: 0, listed: 0, brandDisagreements: 0, setDisagreements: 0 };
    const check = crossCheck(row.entities, row.listEntities ?? parseNumberedList(row.answer), brand, city);
    current.answers += 1;
    if (check.listed) {
      current.listed += 1;
      if (!check.brandAgrees) current.brandDisagreements += 1;
      if (!check.setAgrees) current.setDisagreements += 1;
    }
    byModel.set(row.model, current);
  }
  return [...byModel.values()].map((item) => ({
    ...item,
    brandDisagreementRate: item.listed ? item.brandDisagreements / item.listed : null,
    setDisagreementRate: item.listed ? item.setDisagreements / item.listed : null,
  })).sort((a, b) => a.model.localeCompare(b.model));
}
