# API contracts

All cross-owner payloads are validated at the boundary with `@avero/contracts`. Database rows may contain internal fields, but consumers receive only these versioned contracts.

## Service request handoff

Schema: `ServiceRequestContractSchema`

Producer: maintenance agent (A-09). Consumers: provider discovery, distribution, and marketplace.

## Normalized provider offer

Schema: `NormalizedOfferContractSchema`

Producer: marketplace normalization (B-04). Consumer: customer comparison UI.

Money fields are non-negative integer PKR amounts for the MVP. Unknown extracted values are `null`; they are never invented.

## Completed repair record

Schema: `RepairRecordContractSchema`

Producer: booking completion (C-01). Consumers: Home History and future diagnostic context.

Timestamps must be ISO 8601 with an explicit offset. Contract IDs are created once and preserved across retries.
