// Optional enhancement path: a Lambda Function URL running the Strands
// Orchestrator (see caremap/agents.py). If VITE_AGENT_URL isn't set, or the
// call fails/times out, callers should fall back to the instant local
// summary -- the map and eligibility answer must never depend on this.
// Only ever send the REDACTED message + tier/zip/insured hints, never raw
// income or household size.
export interface MapCommand {
  type: "flyTo" | "highlight" | "filter";
  payload: Record<string, unknown>;
}

export interface AgentResponse {
  reply: string;
  map_commands: MapCommand[];
}

const AGENT_URL = import.meta.env.VITE_AGENT_URL as string | undefined;
// Measured against the live Lambda: a multi-tool query (facility search +
// cost lookup + tier math) legitimately takes 20-45s end to end. This is an
// enhancement with a "thinking" indicator already shown, not a blocking
// call, so it can afford to wait rather than discard a good answer that
// was about to arrive.
const TIMEOUT_MS = 50000;

export async function askAgent(
  redactedMessage: string,
  hints: { zipCode: string | null; insured: boolean | null; tierPct: number | null },
): Promise<AgentResponse | null> {
  if (!AGENT_URL) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(AGENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: redactedMessage, ...hints }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as AgentResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
