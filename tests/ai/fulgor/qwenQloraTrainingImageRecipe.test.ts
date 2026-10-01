import {
  readFileSync,
} from 'node:fs';

import {
  resolve,
} from 'node:path';

import {
  describe,
  expect,
  it,
} from 'vitest';

interface RuntimeLock {
  schemaVersion:
    string;

  state:
    string;

  platform:
    string;

  baseImage: {
    reference:
      string;

    tagProvenance:
      string;

    manifestDigest:
      string;

    cudaToolkitVersion:
      string;

    torchSourceVersionPrefix:
      string;

    pythonMajorMinor:
      string;
  };

  directPythonPins:
    Record<string, string>;

  policies: {
    floatingBaseImageAllowed:
      boolean;

    networkPackageInstallAtRuntimeAllowed:
      boolean;

    networkModelDownloadAtRuntimeAllowed:
      boolean;

    completeTransitiveWheelhouseHashLockRequired:
      boolean;

    buildAuthorized:
      boolean;

    containerPullAuthorized:
      boolean;

    containerStartAuthorized:
      boolean;

    cloudProvisioningAuthorized:
      boolean;

    trainingExecutionAuthorized:
      boolean;

    promotionAuthorized:
      boolean;

    deploymentAuthorized:
      boolean;
  };
}

const root =
  process.cwd();

const dockerfile =
  readFileSync(
    resolve(
      root,
      'deploy/fulgor/qlora/Dockerfile',
    ),
    'utf8',
  );

const runtimeLock =
  JSON.parse(
    readFileSync(
      resolve(
        root,
        'deploy/fulgor/qlora/runtime-lock.json',
      ),
      'utf8',
    ),
  ) as RuntimeLock;

const requirements =
  readFileSync(
    resolve(
      root,
      'deploy/fulgor/qlora/requirements.direct.lock',
    ),
    'utf8',
  )
    .split(/\r?\n/)
    .map(
      (line) =>
        line.trim(),
    )
    .filter(
      (line) =>
        line.length >
          0 &&
        !line.startsWith(
          '#',
        ),
    );

const executor =
  readFileSync(
    resolve(
      root,
      'scripts/fulgor/training/python/qwen_qlora_executor.py',
    ),
    'utf8',
  );

describe(
  'FULGOR pinned QLoRA training image recipe',
  () => {
    it(
      'pins the exact NGC amd64 base image by digest with no caller substitution',
      () => {
        expect(
          dockerfile,
        ).toContain(
          'FROM nvcr.io/nvidia/pytorch@sha256:' +
          'ca73b4795f0d3ae27e9cd81b1b1f1b7fc6c0a129f7d51a359d2326e95af48a3d',
        );

        expect(
          dockerfile,
        ).not.toContain(
          'ARG TRAINING_BASE_IMAGE',
        );

        expect(
          dockerfile,
        ).not.toMatch(
          /:latest\b/i,
        );

        expect(
          dockerfile,
        ).not.toMatch(
          /^\s*RUN\s+/im,
        );

        expect(
          dockerfile,
        ).not.toMatch(
          /\bpip\s+install\b/i,
        );
      },
    );

    it(
      'keeps build and execution authority disabled until a complete wheelhouse hash lock exists',
      () => {
        expect(
          runtimeLock.schemaVersion,
        ).toBe(
          'FULGOR_QWEN_QLORA_TRAINING_IMAGE_RUNTIME_LOCK_V1',
        );

        expect(
          runtimeLock.state,
        ).toBe(
          'OFFLINE_CONTRACT_ONLY_BUILD_NOT_AUTHORIZED',
        );

        expect(
          runtimeLock.platform,
        ).toBe(
          'linux/amd64',
        );

        expect(
          runtimeLock.policies,
        ).toEqual({
          floatingBaseImageAllowed:
            false,

          networkPackageInstallAtRuntimeAllowed:
            false,

          networkModelDownloadAtRuntimeAllowed:
            false,

          completeTransitiveWheelhouseHashLockRequired:
            true,

          buildAuthorized:
            false,

          containerPullAuthorized:
            false,

          containerStartAuthorized:
            false,

          cloudProvisioningAuthorized:
            false,

          trainingExecutionAuthorized:
            false,

          promotionAuthorized:
            false,

          deploymentAuthorized:
            false,
        });
      },
    );

    it(
      'binds CUDA 13.2.1 and the exact direct Hugging Face training stack',
      () => {
        expect(
          runtimeLock.baseImage,
        ).toEqual({
          reference:
            'nvcr.io/nvidia/pytorch@sha256:' +
            'ca73b4795f0d3ae27e9cd81b1b1f1b7fc6c0a129f7d51a359d2326e95af48a3d',

          tagProvenance:
            '26.05-py3',

          manifestDigest:
            'sha256:' +
            'ca73b4795f0d3ae27e9cd81b1b1f1b7fc6c0a129f7d51a359d2326e95af48a3d',

          cudaToolkitVersion:
            '13.2.1',

          torchSourceVersionPrefix:
            '2.12.0a0+5aff3928d8',

          pythonMajorMinor:
            '3.12',
        });

        expect(
          runtimeLock.directPythonPins,
        ).toEqual({
          transformers:
            '5.18.0',

          peft:
            '0.21.0',

          bitsandbytes:
            '0.50.2',

          accelerate:
            '1.15.0',

          safetensors:
            '0.8.0',
        });

        expect(
          requirements,
        ).toEqual([
          'transformers==5.18.0',
          'peft==0.21.0',
          'bitsandbytes==0.50.2',
          'accelerate==1.15.0',
          'safetensors==0.8.0',
        ]);
      },
    );

    it(
      'binds the same direct runtime versions into Python container preflight',
      () => {
        for (
          const value of [
            '"transformers": "5.18.0"',
            '"peft": "0.21.0"',
            '"bitsandbytes": "0.50.2"',
            '"accelerate": "1.15.0"',
            '"safetensors": "0.8.0"',
            '"2.12.0a0+5aff3928d8"',
            'EXPECTED_TORCH_CUDA_PREFIX = "13.2"',
            'TRAINING_STACK_VERSION_MISMATCH:',
            'TRAINING_STACK_CUDA_MISMATCH',
          ]
        ) {
          expect(
            executor,
          ).toContain(
            value,
          );
        }
      },
    );

    it(
      'does not authorize build, pull, start, download, cloud provisioning, or training',
      () => {
        expect(
          runtimeLock.policies.buildAuthorized,
        ).toBe(false);

        expect(
          runtimeLock.policies.containerPullAuthorized,
        ).toBe(false);

        expect(
          runtimeLock.policies.containerStartAuthorized,
        ).toBe(false);

        expect(
          runtimeLock.policies.networkModelDownloadAtRuntimeAllowed,
        ).toBe(false);

        expect(
          runtimeLock.policies.cloudProvisioningAuthorized,
        ).toBe(false);

        expect(
          runtimeLock.policies.trainingExecutionAuthorized,
        ).toBe(false);
      },
    );
  },
);