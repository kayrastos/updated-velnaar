"""Execute COPIES only, with HOME and an audit-enforced filesystem sandbox.

The Vitest launcher copies all sealed sources and this harness to a disposable
root. No production module is imported. Subprocesses/network and all filesystem
access outside that root are forbidden after the fixture modules are loaded.
Host policy evaluation/runtime inputs are offline fakes; real file persistence,
digest admission, replay and per-call gate logic run solely in the fixture root.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
sandbox = Path(__file__).resolve().parent
assert sandbox.name.startswith('velnar-v3-')
assert Path(os.environ['HOME']).resolve() == sandbox
sys.path.insert(0, str(sandbox))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, sandbox / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


common = load('velnar_recovery_authority_common', 'velnar_recovery_authority_common.py')
authorizer = load('fixture_authorizer', 'velnar-task-class-recovery-authorize.py')
gate = load('fixture_gate', 'velnar-task-class-recovery-call-gate.py')
assert common.canonical_paths()['home'] == sandbox


def confined(path):
    if isinstance(path, int) or path is None:
        return
    resolved = Path(os.fsdecode(path)).resolve()
    if not resolved.is_relative_to(sandbox):
        raise RuntimeError('FIXTURE_FILESYSTEM_ESCAPE: ' + str(resolved))


def guard(event, args):
    if event == 'subprocess.Popen' or event.startswith('socket.') or event in ('os.system', 'os.exec', 'os.posix_spawn'):
        raise RuntimeError('FIXTURE_PROCESS_OR_NETWORK_FORBIDDEN')
    if event == 'open':
        confined(args[0])
    elif event in ('os.mkdir', 'os.remove', 'os.rmdir', 'os.chmod', 'os.chdir', 'os.listdir', 'os.scandir'):
        confined(args[0])
    elif event in ('os.rename', 'os.link', 'os.symlink'):
        confined(args[0]); confined(args[1])


sys.addaudithook(guard)
CREATIONS = 0


class V3Contract(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix='case-', dir=sandbox))
        os.environ['HOME'] = str(self.home)
        self.paths = common.canonical_paths()
        assert all(p.is_relative_to(self.home) for p in self.paths.values())
        lib = self.home / '.local/libexec'
        lib.mkdir(parents=True)
        for name in ('velnar_recovery_authority_common.py', 'velnar-task-class-recovery-authorize.py', 'velnar-task-class-recovery-call-gate.py'):
            shutil.copy2(sandbox / name, lib / name)
        shutil.copy2(sandbox / 'velnar-recovery-foundation-v3.json', self.paths['foundationTrust'])
        self.paths['foundationTrust'].chmod(0o600)
        fixture_trust = json.loads(self.paths['foundationTrust'].read_text())
        self.trusted = fixture_trust['commit']
        # Enroll the isolated fixture's complete current file set. Production
        # trust is never changed by this harness, including during development.
        fixture_trust['foundationHashes'] = {
            name: fixture_trust['foundationHashes'].get(name, 'a' * 64)
            for name in common.FOUNDATION_FILES
        }
        self.paths['foundationTrust'].write_text(json.dumps(fixture_trust))
        self.phase = 'PROBATION_BOOTSTRAP'; self.calls = 1; self.progress = 0
        self.raw = {
            'schemaVersion': common.INTENT_SCHEMA, 'batchId': 'fixture-batch',
            'baseline': self.trusted, 'provider': 'antigravity', 'taskClass': 'GENERAL',
            'phase': self.phase, 'requestedModel': 'gemini-3.8-flash-high', 'requestedProviderCalls': 1,
            'requestedConcurrency': 1, 'latestTransportFailureObservedAtMs': 1000,
            **{key: 'a' * 64 for key in ('antigravityExecutableSha256', 'codexExecutableSha256',
                'nodeExecutableSha256', 'tsxCliSha256', 'liveEnvSha256', 'liveUnitSha256')},
            'foundationHashes': {name: 'a' * 64 for name in common.FOUNDATION_FILES},
            'jobs': [self.job(0)],
        }
        self.intent = self.home / 'input.json'
        self.write_intent()
        self.patches = [
            patch.object(common, 'validate_foundation_seal', return_value=None),
            patch.object(common, 'verify_runtime_bindings', return_value={}),
            patch.object(common, 'validate_evidence_binding', return_value=None),
            patch.object(common, 'successful_probation_evidence_context', return_value='old-context'),
            patch.object(common, 'evaluate_policy', side_effect=self.policy),
            patch.object(common, 'hash_identity', return_value='b' * 64),
        ]
        # Keep the unpatched foundation function for dedicated boundary tests.
        self.successful_probation = common.successful_probation_evidence_context
        self.foundation = common.validate_foundation_seal
        for item in self.patches: item.start()

    def tearDown(self):
        for item in reversed(self.patches): item.stop()
        os.environ['HOME'] = str(sandbox)
        shutil.rmtree(self.home)

    def job(self, index):
        return {'jobId': 'job-' + str(index), 'provider': 'antigravity', 'taskClass': 'GENERAL',
                'task': 'Offline fixture only', 'evidence': [
                    {'id': f'e-{index}-{i}', 'path': f'fixture/{index}-{i}',
                     'sha256': hashlib.sha256(f'{index}-{i}'.encode()).hexdigest()} for i in range(2)]}

    def policy(self, baseline, calls, concurrency):
        initial = 0 if self.phase == 'PROBATION_BOOTSTRAP' else 8 - self.calls
        return ({'lane': {'provider': 'antigravity', 'taskClass': 'GENERAL', 'certified': False},
                 'recovery': {'latestTransportFailureObservedAtMs': 1000,
                     'postFailureAttempts': initial + self.progress,
                     'postFailureUsefulUnique': initial + self.progress, 'postFailureNonUseful': 0},
                 'decision': {'status': 'ELIGIBLE', 'reason': 'BOUNDED_TRANSPORT_RECOVERY',
                     'phase': self.phase, 'requiredProviderCalls': self.calls - self.progress,
                     'maxConcurrency': 1, 'authorityGranted': False, 'executionGranted': False,
                     'verificationGranted': False, 'automaticPromotionAllowed': False}}, 'c' * 64)

    def write_intent(self):
        self.data = json.dumps(self.raw, separators=(',', ':')).encode()
        self.intent.write_bytes(self.data); self.intent.chmod(0o600)
        self.digest = hashlib.sha256(self.data).hexdigest()

    def invoke(self, module, args):
        output = io.StringIO()
        with patch.object(sys, 'argv', ['fixture', *args]), contextlib.redirect_stdout(output):
            try: code = module.main()
            except SystemExit as error: code = error.code
            except common.RecoveryAuthorityError: code = 2
        global CREATIONS
        if module is authorizer and code == 0 and args[0] == '--approve-recovery': CREATIONS += 1
        return code, output.getvalue()

    def approve(self, digest=None):
        return self.invoke(authorizer, ['--approve-recovery', str(self.intent), digest or self.digest])

    def pending(self):
        return self.paths['state'] / 'recovery-authority/pending' / self.raw['batchId']

    def receipt(self):
        return json.loads((self.pending() / 'receipt.json').read_text())

    def rewrite_receipt(self, **changes):
        value = self.receipt(); value.update(changes)
        (self.pending() / 'receipt.json').write_text(json.dumps(value))

    def consume(self, ordinal='1', batch=None):
        return self.invoke(gate, ['--consume-call', batch or self.raw['batchId'], ordinal])

    def test_missing_digest(self):
        self.assertEqual(self.invoke(authorizer, ['--approve-recovery', str(self.intent)])[0], 2)
        self.assertFalse(self.paths['state'].exists())

    def test_wrong_digest_before_parse_or_state(self):
        with patch.object(authorizer, 'parse_json_bytes', side_effect=AssertionError('must not parse')):
            self.assertEqual(self.approve('f' * 64)[0], 2)
        self.assertFalse(self.paths['state'].exists())

    def test_changed_path_after_check(self):
        code, output = self.invoke(authorizer, ['--check-only', str(self.intent)])
        self.assertEqual(code, 0); self.assertIn(self.digest, output)
        old = self.digest; self.raw['batchId'] = 'replacement'; self.write_intent()
        self.assertEqual(self.approve(old)[0], 2); self.assertFalse(self.paths['state'].exists())

    def test_digest_parse_persist_same_single_read(self):
        original = authorizer.secure_read_bytes
        def mutate_after_read(path):
            data = original(path)
            self.intent.write_text('{"changed":true}')
            return data
        with patch.object(authorizer, 'secure_read_bytes', side_effect=mutate_after_read) as reader:
            self.assertEqual(self.approve()[0], 0); self.assertEqual(reader.call_count, 1)
        self.assertEqual((self.pending() / 'intent.json').read_bytes(), self.data)
        self.assertEqual(self.receipt()['intentSha256'], self.digest)

    def test_malformed_digest(self):
        for digest in ('x', 'a' * 63, 'a' * 65, 'a' * 63 + '\n'):
            self.assertEqual(self.approve(digest)[0], 2)
        self.assertFalse(self.paths['state'].exists())

    def test_uppercase_digest(self):
        self.assertEqual(self.approve('A' * 64)[0], 2); self.assertFalse(self.paths['state'].exists())

    def test_duplicate_json_rejected(self):
        self.intent.write_text(self.data.decode().replace('{', '{"batchId":"other",', 1))
        digest = hashlib.sha256(self.intent.read_bytes()).hexdigest()
        self.assertEqual(self.approve(digest)[0], 2); self.assertFalse(self.paths['state'].exists())

    def test_check_only_non_authoritative(self):
        code, output = self.invoke(authorizer, ['--check-only', str(self.intent)])
        self.assertEqual(code, 0); self.assertIn('RECOVERY_AUTHORIZATION_CREATED=NO', output)
        self.assertIn('PROVIDER_EXECUTION=NO', output); self.assertFalse(self.paths['state'].exists())

    def test_exact_probation_binding_and_ttl(self):
        self.assertEqual(self.approve()[0], 0)
        receipt = self.receipt()
        for key in ('batchId', 'baseline', 'provider', 'taskClass', 'phase', 'requestedModel'):
            self.assertEqual(receipt[key], self.raw[key])
        self.assertEqual(receipt['schemaVersion'], 'VELNAR_TASK_CLASS_RECOVERY_AUTHORIZATION_V3')
        self.assertEqual(receipt['authorizedProviderCalls'], 1)
        self.assertEqual(receipt['remainingProviderCalls'], 1)
        self.assertEqual(receipt['consumedProviderCalls'], 0)
        self.assertEqual(receipt['expiresAtMs'] - receipt['issuedAtMs'], 600000)

    def test_probation_widening(self):
        self.raw['requestedProviderCalls'] = 2; self.raw['jobs'].append(self.job(1)); self.write_intent()
        self.assertEqual(self.approve()[0], 2); self.assertFalse(self.paths['state'].exists())

    def certification(self):
        self.phase = 'BOUNDED_CERTIFICATION'; self.calls = 3
        self.raw.update(phase=self.phase, requestedProviderCalls=3, jobs=[self.job(i) for i in range(3)])
        self.write_intent()

    def test_certification_exact_remaining(self):
        self.certification(); self.assertEqual(self.approve()[0], 0)
        self.assertEqual(self.receipt()['authorizedProviderCalls'], 3)
        for ordinal in range(1, 4):
            self.assertEqual(self.consume(str(ordinal))[0], 0); self.progress += 1
        spent = self.paths['state'] / 'recovery-authority/consumed' / self.raw['batchId']
        value = json.loads((spent / 'receipt.json').read_text())
        self.assertEqual(value['remainingProviderCalls'], 0)
        self.assertEqual(value['intentSha256'], self.digest)
        self.assertEqual(self.consume('3')[0], 2)

    def test_certification_budget_widening(self):
        self.certification(); self.raw['requestedProviderCalls'] = 4
        self.raw['jobs'].append(self.job(3)); self.write_intent()
        self.assertEqual(self.approve()[0], 2)

    def test_strict_provider_task_model_phase_concurrency(self):
        for key, value in [('provider', 'codex'), ('taskClass', 'CODE'), ('requestedModel', 'other'),
                           ('phase', 'UNKNOWN'), ('requestedConcurrency', 2), ('requestedConcurrency', True)]:
            original = self.raw[key]; self.raw[key] = value; self.write_intent()
            self.assertEqual(self.approve()[0], 2, key); self.assertFalse(self.paths['state'].exists())
            self.raw[key] = original

    def test_phase_mismatch_fresh_policy(self):
        self.raw['phase'] = 'BOUNDED_CERTIFICATION'; self.write_intent()
        self.assertEqual(self.approve()[0], 2)

    def test_failure_identity_fresh_recheck(self):
        self.raw['latestTransportFailureObservedAtMs'] = 2000; self.write_intent()
        self.assertEqual(self.approve()[0], 2)

    def test_replay_creation(self):
        self.assertEqual(self.approve()[0], 0); before = self.receipt()
        self.assertEqual(self.approve()[0], 2); self.assertEqual(self.receipt(), before)

    def test_v2_intent_rejected(self):
        self.raw['schemaVersion'] = 'VELNAR_TASK_CLASS_RECOVERY_INTENT_V2'; self.write_intent()
        self.assertEqual(self.approve()[0], 2)

    def test_v2_authorization_rejected(self):
        self.assertEqual(self.approve()[0], 0)
        self.rewrite_receipt(schemaVersion='VELNAR_TASK_CLASS_RECOVERY_AUTHORIZATION_V2', source='HOST_EXPLICIT_TASK_CLASS_RECOVERY_V2')
        self.assertEqual(self.consume()[0], 2); self.assertEqual(self.receipt()['consumedProviderCalls'], 0)

    def test_gate_digest_tamper_rejected(self):
        self.assertEqual(self.approve()[0], 0); self.rewrite_receipt(intentSha256='f' * 64)
        self.assertEqual(self.consume()[0], 2); self.assertEqual(self.receipt()['consumedProviderCalls'], 0)

    def test_gate_identity_tamper(self):
        self.assertEqual(self.approve()[0], 0); original = self.receipt()
        for key, value in [('batchId','other'), ('baseline','b'*40), ('provider','codex'),
                           ('taskClass','CODE'), ('phase','BOUNDED_CERTIFICATION'), ('requestedModel','other')]:
            self.rewrite_receipt(**{key: value}); self.assertEqual(self.consume()[0], 2, key)
            (self.pending()/'receipt.json').write_text(json.dumps(original))

    def test_gate_budget_widening(self):
        self.assertEqual(self.approve()[0], 0)
        self.rewrite_receipt(authorizedProviderCalls=2, remainingProviderCalls=2)
        self.assertEqual(self.consume()[0], 2)

    def test_gate_invalid_ordinals(self):
        self.assertEqual(self.approve()[0], 0)
        for ordinal in ('0', '-1', '01', '2', '8', '999'):
            self.assertEqual(self.consume(ordinal)[0], 2, ordinal)
        self.assertEqual(self.receipt()['consumedProviderCalls'], 0)

    def test_gate_duplicate_and_spent(self):
        self.certification(); self.assertEqual(self.approve()[0], 0)
        self.assertEqual(self.consume()[0], 0); self.progress += 1
        self.assertEqual(self.consume()[0], 2); self.assertEqual(self.receipt()['consumedProviderCalls'], 1)

    def test_gate_revoked_and_expired(self):
        self.assertEqual(self.approve()[0], 0)
        self.rewrite_receipt(issuedAtMs=0, expiresAtMs=600000)
        self.assertEqual(self.consume()[0], 2)
        revoked=self.paths['state']/'recovery-authority/revoked'/self.raw['batchId']; revoked.mkdir()
        self.assertEqual(self.consume()[0], 2)

    def test_actual_v3_consumed_probation_context_and_v2_rejection(self):
        self.assertEqual(self.approve()[0], 0)
        self.assertEqual(self.consume()[0], 0)
        records = [{'jobId': self.raw['jobs'][0]['jobId'], 'baseline': self.raw['baseline'],
            'provider': 'antigravity', 'taskClass': 'GENERAL', 'source': 'HOST_RUNTIME',
            'outcome': 'USEFUL_UNIQUE', 'observedAtMs': 2000}]
        with patch.object(common, 'read_ledger_json', return_value=({'records': records}, None)):
            context = self.successful_probation(self.raw, self.paths)
            self.assertEqual(context, common.recovery_evidence_context(self.raw['jobs'][0]['evidence']))
            spent = self.paths['state'] / 'recovery-authority/consumed' / self.raw['batchId']
            receipt = json.loads((spent / 'receipt.json').read_text())
            receipt['schemaVersion'] = 'VELNAR_TASK_CLASS_RECOVERY_AUTHORIZATION_V2'
            receipt['source'] = 'HOST_EXPLICIT_TASK_CLASS_RECOVERY_V2'
            (spent / 'receipt.json').write_text(json.dumps(receipt))
            with self.assertRaisesRegex(common.RecoveryAuthorityError, 'NOT_EXACT_ONE'):
                self.successful_probation(self.raw, self.paths)

    def test_gate_initial_ledger_changed(self):
        self.assertEqual(self.approve()[0], 0)
        snapshot, _ = self.policy(self.raw['baseline'], 1, 1)
        with patch.object(common, 'evaluate_policy', return_value=(snapshot, 'd' * 64)):
            self.assertEqual(self.consume()[0], 2)
        self.assertEqual(self.receipt()['consumedProviderCalls'], 0)

    def test_gate_non_useful_progress(self):
        self.assertEqual(self.approve()[0], 0)
        snapshot, digest = self.policy(self.raw['baseline'], 1, 1)
        snapshot['recovery']['postFailureNonUseful'] = 1
        with patch.object(common, 'evaluate_policy', return_value=(snapshot, digest)):
            self.assertEqual(self.consume()[0], 2)
        self.assertEqual(self.receipt()['consumedProviderCalls'], 0)

    def foundation_case(self, baseline=None, dirty=(), corrupt=False, committed_corrupt=False):
        baseline = baseline or self.trusted
        hashes = {name: 'a'*64 for name in common.FOUNDATION_FILES}
        def git(repo, args, binary=False):
            if args == ['rev-parse','HEAD']: return baseline + '\n'
            if args[0] == 'status': return '\n'.join(' M '+path for path in dirty)
            if args[0] == 'show':
                self.assertTrue(args[1].startswith(baseline+':')); return b'committed-fixture'
            raise AssertionError(args)
        digest = hashlib.sha256(b'committed-fixture').hexdigest()
        hashes = {key: digest for key in hashes}
        trust = {'schemaVersion': common.FOUNDATION_TRUST_SCHEMA_V3, 'commit': self.trusted,
                 'foundationHashes': dict(hashes)}
        self.paths['foundationTrust'].write_text(json.dumps(trust))
        with patch.object(common, 'git', side_effect=git), patch.object(common, 'foundation_hashes',
             return_value={key: ('f'*64 if corrupt else digest) for key in hashes}):
            if committed_corrupt: hashes[next(iter(hashes))] = 'f'*64
            self.foundation(self.paths['repo'], baseline, hashes)

    def test_committed_clean_foundation_accepted(self):
        self.foundation_case()

    def test_old_fifteen_dirty_paths_rejected(self):
        with self.assertRaisesRegex(common.RecoveryAuthorityError, 'WORKTREE_DIRTY'):
            self.foundation_case(dirty=common.FOUNDATION_FILES)

    def test_any_dirty_foundation_rejected(self):
        with self.assertRaisesRegex(common.RecoveryAuthorityError, 'WORKTREE_DIRTY'):
            self.foundation_case(dirty=['untracked.ts'])

    def test_arbitrary_clean_untrusted_commit_rejected(self):
        with self.assertRaisesRegex(common.RecoveryAuthorityError, 'COMMIT_UNTRUSTED'):
            self.foundation_case(baseline='b'*40)

    def test_working_and_committed_foundation_hashes(self):
        for kwargs in ({'corrupt':True}, {'committed_corrupt':True}):
            with self.assertRaisesRegex(common.RecoveryAuthorityError, 'HASH_MISMATCH'):
                self.foundation_case(**kwargs)

    def test_explicit_host_enrollment_accepts_an_exact_future_commit(self):
        # Fixture-only control-plane change, never inferred from current HEAD.
        self.trusted = 'b' * 40
        self.foundation_case()

    def test_clean_matching_intent_and_files_still_require_host_hash_approval(self):
        data = b'committed-fixture'
        digest = hashlib.sha256(data).hexdigest()
        expected = {key: digest for key in common.FOUNDATION_FILES}
        def git(repo, args, binary=False):
            if args[0] == 'rev-parse': return self.trusted + '\n'
            if args[0] == 'status': return ''
            return data
        with patch.object(common, 'git', side_effect=git), patch.object(common, 'foundation_hashes', return_value=expected):
            with self.assertRaisesRegex(common.RecoveryAuthorityError, 'HASH_MISMATCH'):
                self.foundation(self.paths['repo'], self.trusted, expected)

    def test_creation_fresh_policy_recheck_after_successful_check_only(self):
        self.assertEqual(self.invoke(authorizer, ['--check-only', str(self.intent)])[0], 0)
        snapshot, digest = self.policy(self.raw['baseline'], 1, 1)
        snapshot['decision']['status'] = 'HOLD'
        with patch.object(common, 'evaluate_policy', return_value=(snapshot, digest)):
            self.assertEqual(self.approve()[0], 2)
        self.assertFalse(self.paths['state'].exists())

    def test_host_trust_record_required_and_strict(self):
        self.paths['foundationTrust'].unlink()
        with self.assertRaisesRegex(common.RecoveryAuthorityError, 'SECURE_FILE_MISSING'):
            self.foundation(self.paths['repo'], self.trusted, self.raw['foundationHashes'])
        self.paths['foundationTrust'].write_text('{"schemaVersion":"wrong","commit":"arbitrary"}')
        self.paths['foundationTrust'].chmod(0o600)
        with self.assertRaisesRegex(common.RecoveryAuthorityError, 'TRUST_INVALID'):
            self.foundation(self.paths['repo'], self.trusted, self.raw['foundationHashes'])

    def test_host_trust_record_private_and_not_a_caller_override(self):
        self.paths['foundationTrust'].chmod(0o666)
        with self.assertRaisesRegex(common.RecoveryAuthorityError, 'SENSITIVE_FILE_WRITABLE'):
            self.foundation(self.paths['repo'], self.trusted, self.raw['foundationHashes'])

    def test_fixture_escape_and_execution_forbidden(self):
        with self.assertRaisesRegex(RuntimeError, 'FILESYSTEM_ESCAPE'):
            Path('/home/kayrastos/.local/state/velnar/forbidden').write_text('never')
        with self.assertRaisesRegex(RuntimeError, 'PROCESS_OR_NETWORK_FORBIDDEN'):
            common.subprocess.run(['/bin/true'])


suite = unittest.defaultTestLoader.loadTestsFromTestCase(V3Contract)
stream = io.StringIO()
result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
print(json.dumps({'tests': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
                  'fixtureAuthorizationCreations': CREATIONS, 'details': stream.getvalue() if not result.wasSuccessful() else ''}))
raise SystemExit(0 if result.wasSuccessful() else 1)
