import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AITraceEventSchema } from "@avero/contracts";
import { InMemoryAIEventSink, createAITraceEvent, recordAITrace } from "@avero/ai-observability";

const fixture = (name: string): unknown => JSON.parse(readFileSync(resolve(`fixtures/ai-events/${name}.json`), "utf8"));

describe("AI trace events", () => {
  it.each(["success", "ambiguous", "safe-failure"])("validates the %s record", (name) => {
    expect(AITraceEventSchema.safeParse(fixture(name)).success).toBe(true);
  });

  it("records a validated event through the shared sink", async () => {
    const sink = new InMemoryAIEventSink();
    const source = AITraceEventSchema.parse(fixture("success"));
    const { event_id: _eventId, occurred_at: _occurredAt, ...input } = source;
    const event = await recordAITrace(sink, input);
    expect(sink.events).toEqual([event]);
  });

  it("refuses hidden chain-of-thought fields at any depth", () => {
    const source = AITraceEventSchema.parse(fixture("success"));
    const { event_id: _eventId, occurred_at: _occurredAt, ...input } = source;
    expect(() => createAITraceEvent({
      ...input,
      structured_evidence: { safe: true, nested: { chain_of_thought: "private" } },
    })).toThrow(/private model reasoning/);
  });

  it("requires explicit fallback context", () => {
    const source = AITraceEventSchema.parse(fixture("safe-failure"));
    expect(AITraceEventSchema.safeParse({ ...source, fallback_reason: null }).success).toBe(false);
  });
});
