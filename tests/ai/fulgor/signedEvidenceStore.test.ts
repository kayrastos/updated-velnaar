import {
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  canonicalSignedEvidenceJson,
} from '../../../scripts/fulgor/evidence/signedEvidence';

import {
  persistSignedEvidenceEnvelope,
} from '../../../scripts/fulgor/evidence/signedEvidenceStore';

import type {
  SignedEvidenceEnvelopeV1,
} from '../../../scripts/fulgor/evidence/signedEvidence';

const roots: string[] = [];

async function tempRoot():
Promise<string> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        'fulgor-signed-store-',
      ),
    );

  roots.push(root);
  return root;
}

function envelope(
  jobId = 'JOB-6D2-001',
): SignedEvidenceEnvelopeV1 {
  return {
    schemaVersion: 'test',
    authority: 'test',
    algorithm: 'test',
    keyId: 'test',

    evidence: {
      jobId,
    },

    provenanceManifestSha256:
      '00',

    signatureBase64:
      'AA==',
  } as unknown as
    SignedEvidenceEnvelopeV1;
}

afterEach(
  async () => {
    await Promise.all(
      roots.splice(0)
        .map(
          (root) =>
            rm(
              root,
              {
                recursive: true,
                force: true,
              },
            ),
        ),
    );
  },
);

describe(
  'signed evidence store',
  () => {
    it(
      'persists canonical envelope',
      async () => {
        const root =
          await tempRoot();

        const value =
          envelope();

        const path =
          await persistSignedEvidenceEnvelope(
            root,
            value,
          );

        const raw =
          await readFile(
            path,
            'utf8',
          );

        expect(raw).toBe(
          canonicalSignedEvidenceJson(
            value,
          ) + '\n',
        );
      },
    );

    it(
      'never overwrites existing evidence',
      async () => {
        const root =
          await tempRoot();

        const value =
          envelope();

        await persistSignedEvidenceEnvelope(
          root,
          value,
        );

        await expect(
          persistSignedEvidenceEnvelope(
            root,
            value,
          ),
        ).rejects.toMatchObject({
          code:
            'EVIDENCE_ALREADY_EXISTS',
        });
      },
    );

    it(
      'rejects unsafe job id',
      async () => {
        const root =
          await tempRoot();

        await expect(
          persistSignedEvidenceEnvelope(
            root,
            envelope('../escape'),
          ),
        ).rejects.toMatchObject({
          code:
            'INVALID_JOB_ID',
        });
      },
    );
  },
);