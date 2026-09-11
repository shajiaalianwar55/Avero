import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AIEvaluationCaseSchema, AIFeatureIdSchema, type AIFeatureId } from "@avero/contracts";

const directory = resolve("fixtures/ai-evaluations");
const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
const coverage = new Map<AIFeatureId, Set<string>>();

for (const file of files) {
  const raw: unknown = JSON.parse(await readFile(resolve(directory, file), "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${file} must contain an array`);
  for (const candidate of raw) {
    const evaluation = AIEvaluationCaseSchema.parse(candidate);
    const kinds = coverage.get(evaluation.feature_id) ?? new Set<string>();
    if (kinds.has(evaluation.kind)) throw new Error(`${evaluation.feature_id} repeats ${evaluation.kind}`);
    kinds.add(evaluation.kind);
    coverage.set(evaluation.feature_id, kinds);
  }
}

for (const feature of AIFeatureIdSchema.options) {
  const kinds = coverage.get(feature);
  for (const required of ["normal", "difficult", "safe_failure"]) {
    if (!kinds?.has(required)) throw new Error(`${feature} is missing ${required}`);
  }
}

console.log(`valid: ${coverage.size} AI features have normal, difficult, and safe-failure fixtures`);
