// Run only after reviewed M2 fixture files have been committed by the human.
// This command only reads local Git objects and writes an ignored result on success.
import fs from 'node:fs';
import { FIXTURES } from './support/catalog';
import { loadFixture } from './support/loadFixture';
import { currentCodeCommit, verifyCommittedFixture } from './support/gitCodeState';
import { captureSnapshot } from '../../../worker/intelligence/ingestion/snapshot';
import { executeFixture } from './support/execute';
import { createSealedIntegrator } from './support/integrate';

const integrateSealed = createSealedIntegrator(verifyCommittedFixture);
const analyzedCodeCommitSha = currentCodeCommit();
const recordings = [];
for (const fixture of FIXTURES) {
  const { ingestion, record } = await executeFixture(await captureSnapshot(loadFixture(fixture.fixtureId), 'org_m2'), 'org_m2');
  const artifacts = await integrateSealed(ingestion, record, 'org_m2');
  if (artifacts.analyzedCodeCommitSha !== analyzedCodeCommitSha) throw new Error('M2_SEAL_COMMIT_CHANGED');
  recordings.push({ ingestion, record, artifacts });
}
if (currentCodeCommit() !== analyzedCodeCommitSha) throw new Error('M2_SEAL_COMMIT_CHANGED');
fs.mkdirSync('node_modules/.cache', { recursive: true });
fs.writeFileSync('node_modules/.cache/v1-m2-sealed-recordings.json', JSON.stringify({
  kind: 'COMMIT_BOUND_LOCAL_M2_BENCHMARK', engineBaselineSha: '1eda1d6bc087c3cff2f4046327dab1eb04a91eda',
  analyzedCodeCommitSha, notice: 'Local Git byte binding only; not authenticated production execution.', recordings,
}, null, 2) + '\n');
console.log(`Sealed ${recordings.length} local recordings against ${analyzedCodeCommitSha}`);
