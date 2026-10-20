import { readV3RecoveryIntent } from './taskClassRecoveryGateState';
import { executeSealedRecoveryAuthorizerCheckOnly, executeSealedRecoveryAuthorizationCreate } from './taskClassRecoveryAuthorityHostExecutor';
import { executeSealedRecoveryEffectGate } from './taskClassRecoveryEffectGateHostExecutor';

// Construction performs no process or state effect. Activation and the shared
// provider-capacity lease belong to the host. The orchestrator has no defaults
// that could silently substitute these live capabilities for test fakes.
export function createSealedV3RecoveryAuthorityBindings() {
  return Object.freeze({ readIntent: readV3RecoveryIntent,
    executeAuthorizer: executeSealedRecoveryAuthorizerCheckOnly,
    executeAuthorization: executeSealedRecoveryAuthorizationCreate,
    executeGate: executeSealedRecoveryEffectGate });
}
