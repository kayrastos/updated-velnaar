import {
  createHash,
} from 'node:crypto';

import {
  readFileSync,
  readdirSync,
} from 'node:fs';

import {
  resolve,
} from 'node:path';

import {
  describe,
  expect,
  it,
} from 'vitest';

const root =
  process.cwd();

const manifestPath =
  resolve(
    root,
    'deploy/fulgor/qlora/wheelhouse.manifest.json',
  );

const manifestText =
  readFileSync(
    manifestPath,
    'utf8',
  );

const manifest =
  JSON.parse(
    manifestText,
  );

const detached =
  readFileSync(
    resolve(
      root,
      'deploy/fulgor/qlora/wheelhouse.manifest.sha256',
    ),
    'utf8',
  ).trim();

const lockLines =
  readFileSync(
    resolve(
      root,
      'deploy/fulgor/qlora/requirements.transitive.lock',
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
        line.length > 0 &&
        !line.startsWith('#'),
    );

describe(
  'FULGOR complete QLoRA wheelhouse lock',
  () => {
    it(
      'binds the target compatibility envelope',
      () => {
        expect(
          manifest.target.platform,
        ).toBe(
          'manylinux_2_28_x86_64',
        );

        expect(
          manifest.target.compatiblePlatforms,
        ).toContain(
          'manylinux_2_24_x86_64',
        );

        expect(
          manifest.target.compatiblePlatforms,
        ).toContain(
          'manylinux_2_17_x86_64',
        );

        expect(
          manifest.target.compatibleAbis,
        ).toEqual([
          'cp312',
          'abi3',
          'none',
        ]);
      },
    );

    it(
      'binds official bitsandbytes 0.50.2 Linux artifact',
      () => {
        const matches =
          manifest.packages.filter(
            (
              entry: {
                name:
                  string;
              },
            ) =>
              entry.name ===
                'bitsandbytes',
          );

        expect(matches)
          .toHaveLength(1);

        expect(matches[0])
          .toMatchObject({
            version:
              '0.50.2',

            filename:
              'bitsandbytes-0.50.2-py3-none-manylinux_2_24_x86_64.whl',

            sha256:
              '55348a9a4a21bfd99cf8c7b32fe67b4030ae5c2a05738e03c1747f65fa6ec283',
          });
      },
    );

    it(
      'excludes PyPI torch CUDA graph',
      () => {
        const names =
          manifest.packages.map(
            (
              entry: {
                name:
                  string;
              },
            ) =>
              entry.name,
          );

        expect(names)
          .not.toContain(
            'torch',
          );

        expect(names)
          .not.toContain(
            'triton',
          );

        expect(
          names.some(
            (name: string) =>
              name.startsWith(
                'nvidia-',
              ),
          ),
        ).toBe(false);

        expect(
          manifest.baseProvided.torch,
        ).toEqual({
          version:
            '2.12.0a0+5aff3928d8',

          wheelIncluded:
            false,

          source:
            'IMMUTABLE_NGC_BASE_IMAGE',
        });
      },
    );

    it(
      'hash-locks every resolved wheel',
      () => {
        expect(
          manifest.packages.length,
        ).toBeGreaterThan(5);

        const expected =
          manifest.packages
            .map(
              (
                entry: {
                  name:
                    string;

                  version:
                    string;

                  sha256:
                    string;
                },
              ) => {
                expect(
                  entry.sha256,
                ).toMatch(
                  /^[a-f0-9]{64}$/,
                );

                return (
                  entry.name +
                  '==' +
                  entry.version +
                  ' --hash=sha256:' +
                  entry.sha256
                );
              },
            )
            .sort();

        expect(
          [...lockLines].sort(),
        ).toEqual(
          expected,
        );
      },
    );

    it(
      'binds manifest itself and commits no wheel binaries',
      () => {
        const digest =
          createHash(
            'sha256',
          )
            .update(
              manifestText,
              'utf8',
            )
            .digest(
              'hex',
            );

        expect(detached)
          .toBe(
            digest +
            '  wheelhouse.manifest.json',
          );

        const directory =
          readdirSync(
            resolve(
              root,
              'deploy/fulgor/qlora',
            ),
          );

        expect(
          directory.some(
            (name) =>
              name.endsWith(
                '.whl',
              ),
          ),
        ).toBe(false);

        expect(
          manifest
            .policies
            .completeTransitiveWheelhouseHashLock,
        ).toBe(true);

        expect(
          manifest
            .policies
            .buildAuthorized,
        ).toBe(false);

        expect(
          manifest
            .policies
            .containerStartAuthorized,
        ).toBe(false);

        expect(
          manifest
            .policies
            .trainingExecutionAuthorized,
        ).toBe(false);
      },
    );
  },
);