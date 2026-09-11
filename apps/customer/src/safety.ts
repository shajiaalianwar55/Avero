export type Safety = ReturnType<typeof safetyState>;
export const hazardRules: Record<string, RegExp> = {
  gas: /gas.{0,25}(smell|leak)|smell.{0,25}gas|rotten eggs/i,
  electrical_heat: /burn(ing|t|ed).{0,25}(socket|outlet|plug)|(?:socket|outlet|plug).{0,25}(burn|sparks|hot)/i,
  exposed_wire: /exposed.{0,15}wir|bare.{0,15}wir/i,
  water_electricity: /(?:water|flood|puddle).{0,60}(?:electric|socket|outlet|appliance|wire)|(?:electric|socket|outlet|wire).{0,60}(?:water|flood|puddle)/i,
  fire: /\b(smoke|fire|flames)\b/i,
  structural: /collaps|ceiling.{0,25}(sag|fall)|structural.{0,20}(unstable|instability)|wall.{0,25}(bulg|shift)/i,
};
// Deliberately conservative: a negated or historical red flag still needs professional clearance.
export function safetyState(flags: string[] = [], unavailable = false) {
  const unique = [...new Set(flags)];
  return { safety_level: unique.length ? 'emergency' : unavailable ? 'unknown' : 'normal', safety_flags: unique,
    safe_to_continue: !unique.length && !unavailable,
    immediate_actions: unique.length ? ['Stop troubleshooting and keep away from the affected area.', 'Move to a safe location and contact local emergency services or the relevant utility. Do not operate switches near a suspected gas leak.'] : unavailable ? ['Safety assessment is unavailable. Pause troubleshooting and contact a qualified professional.'] : [],
    prohibited_actions: unique.length || unavailable ? ['Do not touch wiring, dismantle equipment, approach standing water, or attempt repairs.'] : [],
    emergency_type: unique[0] ?? null };
}
export function detectHazards(text: string) { return Object.entries(hazardRules).filter(([, rule]) => rule.test(text)).map(([name]) => name); }
