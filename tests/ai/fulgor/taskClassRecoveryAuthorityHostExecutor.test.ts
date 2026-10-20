import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  SEALED_RECOVERY_AUTHORIZER_V3_SHA256,
  SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256,
  type RecoveryAuthorityCheckExecutionRequest,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityCheckBridge';

import {
  SEALED_RECOVERY_AUTHORIZER_PATH,
  SEALED_RECOVERY_AUTHORITY_COMMON_PATH,
  validateRecoveryAuthorizerCheckOnlyRequest,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityHostExecutor';


const INTENT =
  '/tmp/velnar-recovery-check.json';


function validRequest():
RecoveryAuthorityCheckExecutionRequest {
  return {
    expectedAuthorizerSha256:
      SEALED_RECOVERY_AUTHORIZER_V3_SHA256,

    expectedCommonSha256:
      SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256,

    args: [
      '--check-only',
      INTENT,
    ],
  };
}


describe(
  'VELNAR sealed recovery authorizer host executor V2',
  () => {
    it(
      'accepts only the exact sealed check-only request',
      () => {
        expect(
          validateRecoveryAuthorizerCheckOnlyRequest(
            validRequest(),
          ),
        ).toBe(
          INTENT,
        );

        expect(
          SEALED_RECOVERY_AUTHORIZER_PATH.endsWith(
            '/.local/libexec/velnar-task-class-recovery-authorize.py',
          ),
        ).toBe(
          true,
        );

        expect(
          SEALED_RECOVERY_AUTHORITY_COMMON_PATH.endsWith(
            '/.local/libexec/velnar_recovery_authority_common.py',
          ),
        ).toBe(
          true,
        );
      },
    );


    it(
      'rejects mismatched authorizer identity',
      () => {
        const bad =
          {
            ...validRequest(),

            expectedAuthorizerSha256:
              'a'.repeat(
                64,
              ),
          } as unknown as
            RecoveryAuthorityCheckExecutionRequest;

        expect(
          () =>
            validateRecoveryAuthorizerCheckOnlyRequest(
              bad,
            ),
        ).toThrow(
          'RECOVERY_HOST_EXECUTOR_AUTHORIZER_HASH_BINDING_INVALID',
        );
      },
    );


    it(
      'rejects mismatched common authority identity',
      () => {
        const bad =
          {
            ...validRequest(),

            expectedCommonSha256:
              'b'.repeat(
                64,
              ),
          } as unknown as
            RecoveryAuthorityCheckExecutionRequest;

        expect(
          () =>
            validateRecoveryAuthorizerCheckOnlyRequest(
              bad,
            ),
        ).toThrow(
          'RECOVERY_HOST_EXECUTOR_COMMON_HASH_BINDING_INVALID',
        );
      },
    );


    it(
      'rejects every verb other than check-only',
      () => {
        const bad =
          {
            ...validRequest(),

            args: [
              '--approve-recovery',
              INTENT,
            ],
          } as unknown as
            RecoveryAuthorityCheckExecutionRequest;

        expect(
          () =>
            validateRecoveryAuthorizerCheckOnlyRequest(
              bad,
            ),
        ).toThrow(
          'RECOVERY_HOST_EXECUTOR_ARGS_INVALID',
        );
      },
    );


    it(
      'rejects widened argument lists',
      () => {
        const bad =
          {
            ...validRequest(),

            args: [
              '--check-only',
              INTENT,
              'unexpected',
            ],
          } as unknown as
            RecoveryAuthorityCheckExecutionRequest;

        expect(
          () =>
            validateRecoveryAuthorizerCheckOnlyRequest(
              bad,
            ),
        ).toThrow(
          'RECOVERY_HOST_EXECUTOR_ARGS_INVALID',
        );
      },
    );


    it(
      'rejects relative or NUL-containing intent paths',
      () => {
        for (
          const path
          of [
            'relative.json',
            '/tmp/bad\0intent.json',
          ]
        ) {
          const bad =
            {
              ...validRequest(),

              args: [
                '--check-only',
                path,
              ],
            } as unknown as
              RecoveryAuthorityCheckExecutionRequest;

          expect(
            () =>
              validateRecoveryAuthorizerCheckOnlyRequest(
                bad,
              ),
          ).toThrow(
            'RECOVERY_HOST_EXECUTOR_INTENT_PATH_INVALID',
          );
        }
      },
    );
  },
);
