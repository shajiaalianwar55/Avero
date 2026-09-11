// One customer server process owns session mutations. Serialize by authenticated user,
// including model calls, to avoid concurrent tabs overwriting safety state.
const tails = new Map<string, Promise<void>>();
export async function acquire(key:string) {
  const previous = tails.get(key) ?? Promise.resolve(); let release!:()=>void;
  const current = new Promise<void>(resolve=>{release=resolve;}); tails.set(key,current);
  await previous;
  return () => { release(); if (tails.get(key)===current) tails.delete(key); };
}
