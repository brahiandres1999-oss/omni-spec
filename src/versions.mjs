const pattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
/**
 * Whether a value is a SemVer 2.0.0 version, as parseVersion and compareVersions require.
 * @param {unknown} value Candidate version.
 * @returns {boolean} false for non-strings, malformed versions and numeric pre-release
 *   identifiers with leading zeros.
 */
export function isVersion(value) {
  const match = typeof value === 'string' && value.match(pattern);
  return (
    Boolean(match) && !(match[4]?.split('.') || []).some(id => /^\d+$/.test(id) && id.length > 1 && id.startsWith('0'))
  );
}
export function parseVersion(value) {
  if (!isVersion(value)) throw new Error(`Invalid semantic version: ${value}`);
  const match = value.match(pattern);
  return { core: match.slice(1, 4), pre: match[4]?.split('.') || [] };
}
export function compareVersions(left, right) {
  const a = parseVersion(left),
    b = parseVersion(right);
  for (let i = 0; i < 3; i++)
    if (BigInt(a.core[i]) !== BigInt(b.core[i])) return BigInt(a.core[i]) > BigInt(b.core[i]) ? 1 : -1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined || b.pre[i] === undefined) return a.pre[i] === undefined ? -1 : 1;
    if (a.pre[i] === b.pre[i]) continue;
    const numericA = /^\d+$/.test(a.pre[i]),
      numericB = /^\d+$/.test(b.pre[i]);
    if (numericA && numericB) return BigInt(a.pre[i]) > BigInt(b.pre[i]) ? 1 : -1;
    if (numericA !== numericB) return numericA ? -1 : 1;
    return a.pre[i] > b.pre[i] ? 1 : -1;
  }
  return 0;
}
