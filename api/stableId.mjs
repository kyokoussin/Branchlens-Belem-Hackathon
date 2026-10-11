// Deterministic, browser-compatible identifier for deduplicating demo records.
// It is not used for authentication or financial calculations.
export function stableId(value) {
  let first = 0xcbf29ce484222325n;
  let second = 0x84222325cbf29ce4n;
  for (const byte of new TextEncoder().encode(value)) {
    first = BigInt.asUintN(64, (first ^ BigInt(byte)) * 0x100000001b3n);
    second = BigInt.asUintN(64, (second ^ BigInt(byte)) * 0x100000001b3n);
  }
  return `${first.toString(16).padStart(16, '0')}${second.toString(16).padStart(16, '0')}`.slice(0, 20);
}
