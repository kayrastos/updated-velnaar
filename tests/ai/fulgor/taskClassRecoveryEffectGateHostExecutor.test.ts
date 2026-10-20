import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  SEALED_RECOVERY_AUTHORITY_COMMON_V2_SHA256,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityCheckBridge';

import {
  SEALED_RECOVERY_CALL_GATE_V2_SHA256,
  type RecoveryEffectGateExecutionRequest,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryEffectGateBridge';

import {
  SEALED_RECOVERY_EFFECT_GATE_COMMON_PATH,
  SEALED_RECOVERY_EFFECT_GATE_PATH,
  validateRecoveryEffectGateExecutionRequest,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryEffectGateHostExecutor';


function validRequest():
RecoveryEffectGateExecutionRequest {
  return {
    expectedGateSha256:
      SEALED_RECOVERY_CALL_GATE_V2_SHA256,

    expectedCommonSha256:
      SEALED_RECOVERY_AUTHORITY_COMMON_V2_SHA256,

    args: [
      '--consume-call',
      'offline-gate-batch',
      '1',
    ],
  };
}


describe(
  'VELNAR sealed recovery effect-gate host executor V1',
  () => {
    it(
      'accepts exact consume-call request',
      () => {
        expect(
          validateRecoveryEffectGateExecutionRequest(
            validRequest(),
          ),
        ).toEqual({
          batchId:
            'offline-gate-batch',

          ordinalText:
            '1',

          ordinal:
            1,
        });

        expect(
          SEALED_RECOVERY_EFFECT_GATE_PATH.endsWith(
            '/.local/libexec/velnar-task-class-recovery-call-gate.py',
          ),
        ).toBe(
          true,
        );

        expect(
          SEALED_RECOVERY_EFFECT_GATE_COMMON_PATH.endsWith(
            '/.local/libexec/velnar_recovery_authority_common.py',
          ),
        ).toBe(
          true,
        );
      },
    );


    it(
      'rejects mismatched gate hash',
      () => {
        const bad =
          {
            ...validRequest(),

            expectedGateSha256:
              'a'.repeat(
                64,
              ),
          } as unknown as
            RecoveryEffectGateExecutionRequest;

        expect(
          () =>
            validateRecoveryEffectGateExecutionRequest(
              bad,
            ),
        ).toThrow(
          'RECOVERY_GATE_EXECUTOR_GATE_HASH_BINDING_INVALID',
        );
      },
    );


    it(
      'rejects mismatched common hash',
      () => {
        const bad =
          {
            ...validRequest(),

            expectedCommonSha256:
              'b'.repeat(
                64,
              ),
          } as unknown as
            RecoveryEffectGateExecutionRequest;

        expect(
          () =>
            validateRecoveryEffectGateExecutionRequest(
              bad,
            ),
        ).toThrow(
          'RECOVERY_GATE_EXECUTOR_COMMON_HASH_BINDING_INVALID',
        );
      },
    );


    it(
      'rejects commands other than consume-call',
      () => {
        const bad =
          {
            ...validRequest(),

            args: [
              '--check-only',
              'offline-gate-batch',
              '1',
            ],
          } as unknown as
            RecoveryEffectGateExecutionRequest;

        expect(
          () =>
            validateRecoveryEffectGateExecutionRequest(
              bad,
            ),
        ).toThrow(
          'RECOVERY_GATE_EXECUTOR_ARGS_INVALID',
        );
      },
    );


    it(
      'rejects widened arguments',
      () => {
        const bad =
          {
            ...validRequest(),

            args: [
              '--consume-call',
              'offline-gate-batch',
              '1',
              'unexpected',
            ],
          } as unknown as
            RecoveryEffectGateExecutionRequest;

        expect(
          () =>
            validateRecoveryEffectGateExecutionRequest(
              bad,
            ),
        ).toThrow(
          'RECOVERY_GATE_EXECUTOR_ARGS_INVALID',
        );
      },
    );


    it(
      'rejects unsafe batch ids',
      () => {
        for (
          const batchId
          of [
            '',
            '../escape',
            'batch with spaces',
            'a'.repeat(
              65,
            ),
          ]
        ) {
          const bad =
            {
              ...validRequest(),

              args: [
                '--consume-call',
                batchId,
                '1',
              ],
            } as unknown as
              RecoveryEffectGateExecutionRequest;

          expect(
            () =>
              validateRecoveryEffectGateExecutionRequest(
                bad,
              ),
          ).toThrow(
            'RECOVERY_GATE_EXECUTOR_BATCH_ID_INVALID',
          );
        }
      },
    );


    it(
      'rejects malformed or out-of-envelope ordinals',
      () => {
        for (
          const ordinal
          of [
            '',
            '0',
            '-1',
            '01',
            '8',
            '999',
            '1.5',
            'x',
          ]
        ) {
          const bad =
            {
              ...validRequest(),

              args: [
                '--consume-call',
                'offline-gate-batch',
                ordinal,
              ],
            } as unknown as
              RecoveryEffectGateExecutionRequest;

          expect(
            () =>
              validateRecoveryEffectGateExecutionRequest(
                bad,
              ),
          ).toThrow(
            'RECOVERY_GATE_EXECUTOR_ORDINAL_INVALID',
          );
        }
      },
    );


    it(
      'accepts ordinals one through seven',
      () => {
        for (
          let ordinal =
            1;

          ordinal <=
            7;

          ordinal +=
            1
        ) {
          const current =
            {
              ...validRequest(),

              args: [
                '--consume-call',
                'offline-certification',
                String(
                  ordinal,
                ),
              ],
            } as RecoveryEffectGateExecutionRequest;

          expect(
            validateRecoveryEffectGateExecutionRequest(
              current,
            ).ordinal,
          ).toBe(
            ordinal,
          );
        }
      },
    );
  },
);
