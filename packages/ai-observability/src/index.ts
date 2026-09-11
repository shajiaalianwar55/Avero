import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { AITraceEventSchema, type AITraceEvent } from "@avero/contracts";

const forbiddenKey = /^(chain[_-]?of[_-]?thought|reasoning|internal[_-]?reasoning|hidden[_-]?reasoning|scratchpad)$/i;

function assertSafeToRetain(value: unknown, path = "structured_evidence"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeToRetain(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey.test(key)) {
      throw new Error(`Refusing to retain private model reasoning at ${path}.${key}`);
    }
    assertSafeToRetain(child, `${path}.${key}`);
  }
}

export type NewAITraceEvent = Omit<AITraceEvent, "event_id" | "occurred_at"> & {
  event_id?: string;
  occurred_at?: string;
};

export function createAITraceEvent(input: NewAITraceEvent): AITraceEvent {
  assertSafeToRetain(input.structured_output, "structured_output");
  assertSafeToRetain(input.structured_evidence);
  return AITraceEventSchema.parse({
    ...input,
    event_id: input.event_id ?? randomUUID(),
    occurred_at: input.occurred_at ?? new Date().toISOString(),
  });
}

export interface AIEventSink {
  append(event: AITraceEvent): Promise<void>;
}

export class InMemoryAIEventSink implements AIEventSink {
  readonly events: AITraceEvent[] = [];

  async append(event: AITraceEvent): Promise<void> {
    this.events.push(AITraceEventSchema.parse(event));
  }
}

export class JsonlAIEventSink implements AIEventSink {
  constructor(private readonly path: string) {}

  async append(event: AITraceEvent): Promise<void> {
    const validated = AITraceEventSchema.parse(event);
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(validated)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

export async function recordAITrace(sink: AIEventSink, input: NewAITraceEvent): Promise<AITraceEvent> {
  const event = createAITraceEvent(input);
  await sink.append(event);
  return event;
}
