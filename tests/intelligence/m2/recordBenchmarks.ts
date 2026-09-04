// Fixed offline recording command; no ground-truth evaluator is loaded here.
import fs from 'node:fs';
import { FIXTURES } from './support/catalog';
import { loadFixture } from './support/loadFixture';
import { captureSnapshot } from '../../../worker/intelligence/ingestion/snapshot';
import { executeFixture } from './support/execute';
import { integrateExecution } from './support/integrate';

const recordings = [];
for (const fixture of FIXTURES) {
  const snapshot = await captureSnapshot(loadFixture(fixture.fixtureId), 'org_m2');
  const { ingestion, record } = await executeFixture(snapshot, 'org_m2');
  const artifacts = await integrateExecution(ingestion, record, 'org_m2');
  recordings.push({ ingestion, record, integration: artifacts });
}
fs.mkdirSync('node_modules/.cache', { recursive: true });
const output = 'node_modules/.cache/v1-m2-recordings.json';
fs.writeFileSync(output, JSON.stringify({ kind: 'PRE_SEAL_LOCAL_M2_BENCHMARK',
  engineBaselineSha: '1eda1d6bc087c3cff2f4046327dab1eb04a91eda', analyzedCodeCommitSha: null,
  notice: 'PRE-SEAL / NOT FINAL. Captured byte observations only; no commit-bound M1 artifacts.', recordings }, null, 2) + '\n');
console.log(`Recorded ${recordings.length} offline fixtures to ${output}`);
