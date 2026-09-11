import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  NormalizedOfferContractSchema,
  RepairRecordContractSchema,
  ServiceRequestContractSchema,
} from "@avero/contracts";

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

const checks = [
  ["service request", ServiceRequestContractSchema, "fixtures/service-requests/valid.json"],
  ["offer", NormalizedOfferContractSchema, "fixtures/offers/valid.json"],
  ["repair record", RepairRecordContractSchema, "fixtures/repair-records/valid.json"],
] as const;

for (const [label, schema, path] of checks) {
  schema.parse(await json(path));
  console.log(`valid: ${label} (${path})`);
}
