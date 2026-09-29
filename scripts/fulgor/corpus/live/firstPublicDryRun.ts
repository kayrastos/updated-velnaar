import {
  dirname,
  join,
} from 'node:path';

import {
  mkdir,
  rm,
} from 'node:fs/promises';

import {
  fetchGithubAdvisoryCandidates,
} from '../sources/githubAdvisorySource';

import {
  materializeBareRepositoryPair,
} from '../materialization/bareRepositoryMaterializer';

import {
  extractRepositoryPairEvidence,
} from '../materialization/repositoryPairEvidence';

import {
  validatePostMaterializationIdentity,
} from '../validation/exactRepositoryIdentity';

import {
  evaluateLicenseEvidence,
} from '../validation/licenseGate';

import {
  buildCorpusReviewCandidate,
} from '../review/reviewCandidate';

const GHSA =
  'GHSA-hqjg-pww4-pcgq';

const REPOSITORY =
  'google/clasp';

const VULNERABLE_SHA =
  '56f0e6274c2daa2c0928d44fe50c517b188c11f5';

const FIXED_SHA =
  'ba6bd666fe74de54950122b5d92ecf1dcc02a9d3';

const EXPECTED_LICENSE =
  'Apache-2.0';

export async function runFirstPublicDryRun(): Promise<void> {
  const workspaceRoot =
    process.env
      .FULGOR_CORPUS_DRYRUN_ROOT ??
    'D:/VELNAR-Automation/scratch/fulgor-corpus-live';

  await mkdir(
    workspaceRoot,
    {
      recursive: true,
    },
  );

  console.log(
    'LIVE_DRY_RUN=START',
  );

  console.log(
    `GHSA=${GHSA}`,
  );

  console.log(
    `REPOSITORY=${REPOSITORY}`,
  );

  const advisories =
    await fetchGithubAdvisoryCandidates({
      ghsaId:
        GHSA,

      perPage:
        1,
    });

  if (
    advisories.length !== 1 ||
    advisories[0]
      .advisoryId !== GHSA
  ) {
    throw new Error(
      'LIVE_GHSA_EXACT_MATCH_FAILED',
    );
  }

  const advisory =
    advisories[0];

  console.log(
    `ADVISORY_PROVIDER=${advisory.provider}`,
  );

  console.log(
    `ADVISORY_CWES=${advisory.cwes.join(',')}`,
  );

  if (
    !advisory.cwes.includes(
      'CWE-22',
    )
  ) {
    throw new Error(
      'LIVE_EXPECTED_CWE_MISSING',
    );
  }

  const materialized =
    await materializeBareRepositoryPair({
      repository:
        REPOSITORY,

      vulnerableCommitSha:
        VULNERABLE_SHA,

      fixedCommitSha:
        FIXED_SHA,

      workspaceRoot,

      timeoutMs:
        120_000,

      maxOutputBytes:
        2_097_152,

      retainMaterialization:
        true,
    });

  const barePath =
    materialized
      .materializationPath;

  if (barePath === null) {
    throw new Error(
      'LIVE_MATERIALIZATION_PATH_MISSING',
    );
  }

  try {
    const identity =
      validatePostMaterializationIdentity(
        {
          repository:
            REPOSITORY,

          vulnerableCommitSha:
            VULNERABLE_SHA,

          fixedCommitSha:
            FIXED_SHA,
        },

        materialized.evidence,
      );

    console.log(
      `EXACT_IDENTITY=${identity.accepted}`,
    );

    if (!identity.accepted) {
      throw new Error(
        `LIVE_IDENTITY_REJECTED:${identity.failureCodes.join(',')}`,
      );
    }

    const pairEvidence =
      await extractRepositoryPairEvidence({
        repository:
          REPOSITORY,

        bareRepositoryPath:
          barePath,

        vulnerableCommitSha:
          VULNERABLE_SHA,

        fixedCommitSha:
          FIXED_SHA,

        timeoutMs:
          120_000,

        maxMetadataBytes:
          524_288,

        maxDiffBytes:
          2_097_152,

        maxChangedFiles:
          16,
      });

    console.log(
      `FIX_RELATIONSHIP=${pairEvidence.fixRelationship}`,
    );

    console.log(
      `CHANGED_FILES=${pairEvidence.changedFiles.join(',')}`,
    );

    console.log(
      `DIFF_SHA256=${pairEvidence.diffSha256}`,
    );

    console.log(
      `DIFF_BYTES=${pairEvidence.diffByteLength}`,
    );

    console.log(
      `LICENSE_CONTINUITY=${pairEvidence.licenseContinuity}`,
    );

    console.log(
      `PAIR_REVIEW_ELIGIBLE=${pairEvidence.eligibleForCorpusReview}`,
    );

    if (
      !pairEvidence
        .eligibleForCorpusReview
    ) {
      throw new Error(
        'LIVE_PAIR_EVIDENCE_REJECTED',
      );
    }

    const fixedLicense =
      pairEvidence.fixedLicense;

    const licenseGate =
      evaluateLicenseEvidence({
        spdxId:
          EXPECTED_LICENSE,

        licenseFilePath:
          fixedLicense.path,

        licenseContentSha256:
          fixedLicense
            .contentSha256,

        detectedFromMaterializedRevision:
          fixedLicense.state ===
            'SINGLE_ROOT_LICENSE',
      });

    console.log(
      `LICENSE_GATE=${licenseGate.decision}`,
    );

    if (
      licenseGate.decision !==
        'ELIGIBLE_FOR_CORPUS_REVIEW'
    ) {
      throw new Error(
        'LIVE_LICENSE_REJECTED',
      );
    }

    const review =
      buildCorpusReviewCandidate({
        advisory,

        repository:
          REPOSITORY,

        vulnerableCommitSha:
          VULNERABLE_SHA,

        fixedCommitSha:
          FIXED_SHA,

        exactIdentity:
          identity,

        pairEvidence,

        licenseGate,

        licenseSpdxId:
          EXPECTED_LICENSE,

        createdAtUtc:
          new Date()
            .toISOString(),
      });

    console.log(
      `REVIEW_ACCEPTED=${review.accepted}`,
    );

    if (
      !review.accepted ||
      review.candidate === null
    ) {
      throw new Error(
        `LIVE_REVIEW_REJECTED:${review.failureCodes.join(',')}`,
      );
    }

    if (
      review.candidate
        .trainingAdmission !==
        false
    ) {
      throw new Error(
        'TRAINING_AUTHORITY_ESCAPE',
      );
    }

    if (
      review.candidate
        .vulnerabilityTruthAuthority !==
        false
    ) {
      throw new Error(
        'VULNERABILITY_AUTHORITY_ESCAPE',
      );
    }

    console.log(
      `FAMILY=${review.candidate.family}`,
    );

    console.log(
      `CANDIDATE_SHA256=${review.candidate.candidateSha256}`,
    );

    console.log(
      'TRAINING_ADMISSION=False',
    );

    console.log(
      'VULNERABILITY_TRUTH_AUTHORITY=False',
    );

    console.log(
      'REPOSITORY_CODE_EXECUTION=False',
    );

    console.log(
      'FIRST_PUBLIC_DRY_RUN=PASS',
    );
  }
  finally {
    await rm(
      dirname(barePath),
      {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 250,
      },
    );
  }
}
