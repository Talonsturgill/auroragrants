#!/usr/bin/env node
// Validates hand-curated funder rubrics in supabase/seed/rubrics/ against
// the schema described in docs/04-funder-graph.md.
//
// Exits 0 if every rubric parses and matches the schema. Exits 1 on the first
// failure, printing the file path and the offending property.
//
// Intentionally uses no dependencies beyond Node's stdlib. Do not add `ajv`
// or any new package. If the schema grows, extend the check() calls below.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rubricsDir = resolve(__dirname, "..", "supabase", "seed", "rubrics");

const WEIGHT_TOLERANCE = 0.001;

/** @type {string[]} */
const errors = [];

function fail(file, msg) {
  errors.push(`[${file}] ${msg}`);
}

function isString(v) {
  return typeof v === "string" && v.length > 0;
}

function isNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function validateScoring(file, rubricIndex, scoring) {
  if (!Array.isArray(scoring) || scoring.length !== 3) {
    fail(
      file,
      `rubric[${rubricIndex}].scoring must be an array of length 3 (one entry each for scores 0, 1, 2)`
    );
    return;
  }
  const seen = new Set();
  for (let i = 0; i < scoring.length; i++) {
    const s = scoring[i];
    if (!s || typeof s !== "object") {
      fail(file, `rubric[${rubricIndex}].scoring[${i}] must be an object`);
      continue;
    }
    if (![0, 1, 2].includes(s.score)) {
      fail(
        file,
        `rubric[${rubricIndex}].scoring[${i}].score must be 0, 1, or 2 (got ${JSON.stringify(s.score)})`
      );
    } else if (seen.has(s.score)) {
      fail(file, `rubric[${rubricIndex}].scoring has duplicate score ${s.score}`);
    } else {
      seen.add(s.score);
    }
    if (!isString(s.desc)) {
      fail(file, `rubric[${rubricIndex}].scoring[${i}].desc must be a non-empty string`);
    }
  }
}

function validateCommonFailures(file, rubricIndex, cf) {
  if (!Array.isArray(cf)) {
    fail(file, `rubric[${rubricIndex}].common_failures must be an array`);
    return;
  }
  if (cf.length < 3) {
    fail(
      file,
      `rubric[${rubricIndex}].common_failures must have at least 3 entries (schema requires 3)`
    );
  }
  for (let i = 0; i < cf.length; i++) {
    if (!isString(cf[i])) {
      fail(file, `rubric[${rubricIndex}].common_failures[${i}] must be a non-empty string`);
    }
  }
}

function validateRubric(file, rubric) {
  if (!Array.isArray(rubric)) {
    fail(file, `top-level JSON must be an array of rubric items`);
    return;
  }
  if (rubric.length < 3 || rubric.length > 6) {
    fail(file, `rubric must have 3-6 items (got ${rubric.length})`);
  }
  const ids = new Set();
  let weightSum = 0;
  for (let i = 0; i < rubric.length; i++) {
    const item = rubric[i];
    if (!item || typeof item !== "object") {
      fail(file, `rubric[${i}] must be an object`);
      continue;
    }
    if (!isString(item.id)) {
      fail(file, `rubric[${i}].id must be a non-empty string`);
    } else if (ids.has(item.id)) {
      fail(file, `rubric[${i}].id "${item.id}" is duplicated`);
    } else {
      ids.add(item.id);
    }
    if (!isString(item.label)) {
      fail(file, `rubric[${i}].label must be a non-empty string`);
    }
    if (!isNumber(item.weight)) {
      fail(file, `rubric[${i}].weight must be a finite number`);
    } else {
      if (item.weight < 0 || item.weight > 1) {
        fail(file, `rubric[${i}].weight must be in [0, 1] (got ${item.weight})`);
      }
      weightSum += item.weight;
    }
    if (!isString(item.description)) {
      fail(file, `rubric[${i}].description must be a non-empty string`);
    }
    validateScoring(file, i, item.scoring);
    validateCommonFailures(file, i, item.common_failures);
  }
  if (Math.abs(weightSum - 1.0) > WEIGHT_TOLERANCE) {
    fail(
      file,
      `weights must sum to 1.0 +/- ${WEIGHT_TOLERANCE} (got ${weightSum.toFixed(4)})`
    );
  }
}

function main() {
  let files;
  try {
    files = readdirSync(rubricsDir).filter((f) => f.endsWith(".json"));
  } catch (err) {
    console.error(`Could not read ${rubricsDir}: ${err.message}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`No rubric JSON files found in ${rubricsDir}`);
    process.exit(1);
  }
  files.sort();
  for (const f of files) {
    const path = join(rubricsDir, f);
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      fail(f, `could not read: ${err.message}`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      fail(f, `invalid JSON: ${err.message}`);
      continue;
    }
    validateRubric(f, parsed);
  }
  if (errors.length > 0) {
    console.error(`Rubric validation FAILED with ${errors.length} error(s):`);
    for (const e of errors) console.error("  " + e);
    process.exit(1);
  }
  console.log(`Rubric validation OK (${files.length} file(s)):`);
  for (const f of files) console.log("  " + f);
}

main();
