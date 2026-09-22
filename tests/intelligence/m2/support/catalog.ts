// Input identifiers and locations only. No outcome/answer fields or oracle import.
export const FIXTURES = Object.freeze([
  ['m2-case-001', 'f01'],
  ['m2-case-002', 'f02'],
  ['m2-case-003', 'f03'],
  ['m2-case-004', 'f04'],
  ['m2-case-005', 'f05'],
  ['m2-case-006', 'f06'],
  ['m2-case-007', 'f07'],
  ['m2-case-008', 'f08'],
].map(([fixtureId, directory]) => Object.freeze({ fixtureId, directory })));
export function validateCatalog(raw: unknown): typeof FIXTURES {
  if (!Array.isArray(raw) || raw.length !== FIXTURES.length) throw new Error('M2_CATALOG_REJECTED');
  const seen = new Set();
  for (const row of raw) {
    if (!row || Object.getPrototypeOf(row) !== Object.prototype || Reflect.ownKeys(row).length !== 2
      || !['fixtureId', 'directory'].every(k => Object.getOwnPropertyDescriptor(row, k)?.enumerable
        && 'value' in Object.getOwnPropertyDescriptor(row, k)!)) throw new Error('M2_CATALOG_REJECTED');
    if (seen.has(row.fixtureId) || !FIXTURES.some(f => f.fixtureId === row.fixtureId && f.directory === row.directory)) throw new Error('M2_CATALOG_REJECTED');
    seen.add(row.fixtureId);
  }
  return FIXTURES;
}
