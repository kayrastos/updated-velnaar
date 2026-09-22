import { FIXTURES } from '../../m2/support/catalog';
import { loadFixture } from '../../m2/support/loadFixture';
import { captureSnapshot, type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';

export const ORG = 'org_m3';
export function input(index = 0): SnapshotInput { return structuredClone(loadFixture(FIXTURES[index].fixtureId, ORG)); }
export function replaceSource(raw: SnapshotInput, change: (content: string) => string): SnapshotInput {
  return { ...raw, files: raw.files.map(file => file.path === 'src/routes.ts' ? { ...file, content: change(file.content) } : file) };
}
export async function analyzeInput(raw: SnapshotInput = input()) {
  const snapshot = await captureSnapshot(raw, ORG), ingestion = await ingestExpress(snapshot, ORG);
  const result = await detectSqlInjection(snapshot, ingestion, ORG);
  return { snapshot, ingestion, result };
}
