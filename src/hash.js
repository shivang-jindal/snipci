// Dependency-free stable hash (FNV-1a, 64-bit) used for snippet ids.
// Baselines only need stability across runs on the same content — not
// cryptographic strength — and node:crypto stays out of the import list.

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

export function stableHash(input) {
  let h = FNV_OFFSET;
  const bytes = Buffer.from(String(input), 'utf8');
  for (const byte of bytes) {
    h ^= BigInt(byte);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, '0');
}

// Stable snippet id: hash(path + nearest-heading anchor + content).
export function snippetId({ path, anchor, content }) {
  const normalizedPath = String(path).replace(/\\/g, '/');
  return `snip-${stableHash(`${normalizedPath} ${anchor ?? ''} ${content}`)}`;
}
