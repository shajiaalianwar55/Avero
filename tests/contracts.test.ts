import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NormalizedOfferContractSchema,
  RepairRecordContractSchema,
  ServiceRequestContractSchema,
} from "@avero/contracts";

const fixture = (path: string): unknown => JSON.parse(readFileSync(resolve(path), "utf8"));

describe("shared integration contracts", () => {
  it("accepts the canonical service request", () => {
    expect(ServiceRequestContractSchema.safeParse(fixture("fixtures/service-requests/valid.json")).success).toBe(true);
  });

  it("rejects private enum variants and invalid confidence", () => {
    expect(ServiceRequestContractSchema.safeParse(fixture("fixtures/service-requests/invalid.json")).success).toBe(false);
  });

  it("accepts the canonical normalized offer", () => {
    expect(NormalizedOfferContractSchema.safeParse(fixture("fixtures/offers/valid.json")).success).toBe(true);
  });

  it("rejects inconsistent or malformed money fields", () => {
    expect(NormalizedOfferContractSchema.safeParse(fixture("fixtures/offers/invalid.json")).success).toBe(false);
  });

  it("accepts the canonical repair record with an offset timestamp", () => {
    expect(RepairRecordContractSchema.safeParse(fixture("fixtures/repair-records/valid.json")).success).toBe(true);
  });
});
