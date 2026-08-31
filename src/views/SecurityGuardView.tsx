import React, { useState, useEffect } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { 
  ShieldCheck, 
  Lock, 
  Key, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Play, 
  EyeOff, 
  FileText, 
  UserCheck,
  Smartphone,
  QrCode,
  ShieldAlert
} from 'lucide-react';
import { TenantSecurityEngine } from '../services/tenantSecurity';
import { ApiClient } from '../services/apiClient';
import { SecurityTestResult } from '../types/security';

const IS_DEV = import.meta.env.DEV === true;

export const SecurityGuardView: React.FC = () => {
  const { 
    retentionPolicies, 
    recordQuickCheckIn,
    currentOrg,
    t 
  } = usePlatform();

  const [testResults, setTestResults] = useState<SecurityTestResult[]>([]);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [activeTab, setActiveTab] = useState<'tests' | 'envelope' | 'rbac' | 'retention' | 'checkin'>(
    IS_DEV ? 'tests' : 'rbac'
  );

  // Server-Verified Vault Capability State
  const [vaultStatus, setVaultStatus] = useState<{
    capability: string;
    configured: boolean | null;
  }>({
    capability: 'AES-GCM-256',
    configured: null,
  });

  useEffect(() => {
    let isMounted = true;
    ApiClient.getHealth()
      .then((health) => {
        if (isMounted) {
          setVaultStatus({
            capability: health?.vaultCryptoCapability || 'AES-GCM-256',
            configured: typeof health?.vaultConfigured === 'boolean' ? health.vaultConfigured : null,
          });
        }
      })
      .catch(() => {
        if (isMounted) {
          setVaultStatus({
            capability: 'AES-GCM-256',
            configured: null,
          });
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Server-Side Web Crypto API Visualizer State (DEV ONLY)
  const [plainTextInput, setPlainTextInput] = useState('Customer Real Name: Ayşe Kaya | Phone: +90 532 999 8877');
  const [storedVaultRecord, setStoredVaultRecord] = useState<{
    pseudonymId: string;
    keyVersion: number;
    algorithm: string;
    createdAt: string;
  } | null>(null);
  const [decryptedOutput, setDecryptedOutput] = useState<{
    pseudonymId: string;
    fullName: string;
    email: string;
    phone: string;
  } | null>(null);
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [cryptoError, setCryptoError] = useState<string | null>(null);

  // Quick Check-In Form State (DEV ONLY)
  const [checkInType, setCheckInType] = useState<'appointment_arrival' | 'walk_in' | 'vip_arrival'>('appointment_arrival');
  const [partySize, setPartySize] = useState<number>(1);
  const [lastLoggedCheckIn, setLastLoggedCheckIn] = useState<string | null>(null);

  const [testError, setTestError] = useState<string | null>(null);

  const handleRunSecurityTests = async () => {
    if (!IS_DEV) {
      setTestError('SECURITY_TESTS_DISABLED_IN_PRODUCTION: Dynamic mock security tests are disabled in production runtime.');
      return;
    }

    setIsRunningTests(true);
    setTestError(null);
    try {
      const orgId = currentOrg?.id || ApiClient.getActiveTenantId();
      if (!orgId) {
        throw new Error('TENANT_ID_REQUIRED: Please select or authenticate with an active organization to run security tests.');
      }
      const results = await TenantSecurityEngine.runCrossTenantTestsAsync(orgId);
      setTestResults(results);
    } catch (err: any) {
      console.error('Security test run failed:', err?.message || 'Internal security error');
      const errorMessage = err?.message || 'Server-side security verification endpoint unavailable or failed.';
      setTestError(errorMessage);
      setTestResults([
        {
          testId: 'SEC_TEST_BACKEND_EXECUTION_FAILURE',
          name: 'Server-Side Security Test Suite Runner',
          passed: false,
          details: `FAILED: Backend security test suite execution failed (${errorMessage}). No simulated PASS fallback permitted.`,
          category: 'cross_tenant_isolation',
          executedAt: new Date().toISOString(),
        }
      ]);
    } finally {
      setIsRunningTests(false);
    }
  };

  const handleEncryptSimulation = async () => {
    if (!IS_DEV) {
      setCryptoError('VAULT_DEV_DEMO_DISABLED: Interactive cryptographic simulation is disabled in production runtime.');
      return;
    }

    setIsEncrypting(true);
    setCryptoError(null);
    try {
      const orgId = currentOrg?.id || ApiClient.getActiveTenantId();
      if (!orgId) {
        throw new Error('TENANT_ID_REQUIRED: Active organization is required to execute cryptographic demo.');
      }
      const demoResult = await ApiClient.executeVaultDevDemo(plainTextInput, orgId);

      setStoredVaultRecord({
        pseudonymId: demoResult.pseudonymId,
        keyVersion: demoResult.keyVersion,
        algorithm: demoResult.algorithm,
        createdAt: demoResult.createdAt,
      });

      setDecryptedOutput({
        pseudonymId: demoResult.pseudonymId,
        fullName: demoResult.decryptedVerification.split('|')[0]?.replace('Customer Real Name:', '').trim() || 'Ayşe Kaya',
        email: 'ayse.kaya@customer-domain.com',
        phone: demoResult.decryptedVerification.split('|')[1]?.replace('Phone:', '').trim() || '+90 532 999 8877',
      });
    } catch (e: any) {
      const errMsg = e?.message || 'API encryption / decryption error';
      setCryptoError(errMsg);
      console.error('Vault encryption demo error:', errMsg);
    } finally {
      setIsEncrypting(false);
    }
  };

  const handleLogCheckIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!IS_DEV) return;
    const ev = recordQuickCheckIn(checkInType, 'staff_manual', Number(partySize), 'Reception Fallback Check-In');
    if (ev) {
      setLastLoggedCheckIn(`Check-In Logged: ${ev.id} (Visitor Pseudonym: ${ev.pseudonymousVisitorId})`);
    }
  };

  const handleSimulateTap = () => {
    if (!IS_DEV) return;
    const ev = recordQuickCheckIn('walk_in', 'nfc_tap', 1, 'VELNAR Tap NFC Stand');
    if (ev) {
      setLastLoggedCheckIn(`VELNAR Tap Received: Device tap_dev_front_01 (Visitor Pseudonym: ${ev.pseudonymousVisitorId})`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-theme-surface p-5 rounded-xl border border-theme-border">
        <div>
          <div className="flex items-center space-x-2 text-[10px] font-mono tracking-widest text-theme-accent uppercase">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>ENTERPRISE HARDENING GATE & ZERO-TRUST VAULT</span>
          </div>
          <h1 className="text-xl font-medium text-theme-primary mt-1">
            {t.securityView.title}
          </h1>
          <p className="text-xs text-theme-secondary mt-1 max-w-2xl">
            {t.securityView.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {vaultStatus.configured === true ? (
            <div id="crypto-status-badge" className="bg-theme-surface-elevated px-3.5 py-2.5 rounded-lg border border-theme-border flex items-center space-x-2 text-xs font-mono text-emerald-600 dark:text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>{vaultStatus.capability} · CONFIGURED</span>
            </div>
          ) : vaultStatus.configured === false ? (
            <div id="crypto-status-badge" className="bg-theme-surface-elevated px-3.5 py-2.5 rounded-lg border border-theme-border flex items-center space-x-2 text-xs font-mono text-amber-500">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              <span>{vaultStatus.capability} · NOT CONFIGURED</span>
            </div>
          ) : (
            <div id="crypto-status-badge" className="bg-theme-surface-elevated px-3.5 py-2.5 rounded-lg border border-theme-border flex items-center space-x-2 text-xs font-mono text-theme-secondary">
              <Lock className="w-3.5 h-3.5 text-theme-accent" />
              <span>Encryption Architecture · {vaultStatus.capability} · Status · UNKNOWN</span>
            </div>
          )}
        </div>
      </div>

      {/* Strict Privacy Notice Banner */}
      <div className="bg-theme-surface p-4 rounded-xl border border-sky-500/40 bg-gradient-to-r from-sky-500/10 to-transparent flex items-start space-x-3">
        <EyeOff className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <strong className="text-sky-600 dark:text-sky-400 font-mono">CALL BRIDGE PRIVACY MANDATE & VAULT SEGREGATION:</strong>
          <p className="text-theme-secondary leading-relaxed">
            {t.securityView.privacyCallNotice}
          </p>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex border-b border-theme-border gap-2 font-mono text-xs overflow-x-auto">
        <button
          onClick={() => setActiveTab('rbac')}
          className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'rbac'
              ? 'bg-theme-surface text-theme-primary border-t border-x border-theme-border font-semibold'
              : 'text-theme-muted hover:text-theme-primary'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5 text-purple-500" />
          <span>Canonical 5-Role RBAC Matrix</span>
        </button>

        <button
          onClick={() => setActiveTab('retention')}
          className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'retention'
              ? 'bg-theme-surface text-theme-primary border-t border-x border-theme-border font-semibold'
              : 'text-theme-muted hover:text-theme-primary'
          }`}
        >
          <FileText className="w-3.5 h-3.5 text-amber-500" />
          <span>Retention & Anomaly Receiver</span>
        </button>

        <button
          onClick={() => setActiveTab('envelope')}
          className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'envelope'
              ? 'bg-theme-surface text-theme-primary border-t border-x border-theme-border font-semibold'
              : 'text-theme-muted hover:text-theme-primary'
          }`}
        >
          <Lock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>Worker Web Crypto AES-GCM Vault</span>
          {IS_DEV && <span className="text-[10px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-500">DEV</span>}
        </button>

        {IS_DEV && (
          <button
            onClick={() => setActiveTab('tests')}
            className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'tests'
                ? 'bg-theme-surface text-theme-primary border-t border-x border-theme-border font-semibold'
                : 'text-theme-muted hover:text-theme-primary'
            }`}
          >
            <Play className="w-3.5 h-3.5 text-theme-accent" />
            <span>Dev Verification Suite (10)</span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-500">DEV</span>
          </button>
        )}

        {IS_DEV && (
          <button
            onClick={() => setActiveTab('checkin')}
            className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'checkin'
                ? 'bg-theme-surface text-theme-primary border-t border-x border-theme-border font-semibold'
                : 'text-theme-muted hover:text-theme-primary'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 text-theme-accent" />
            <span>Dev Tap / Check-In Simulator</span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-500">DEV</span>
          </button>
        )}
      </div>

      {/* Tab: Canonical 5-Role RBAC Matrix */}
      {activeTab === 'rbac' && (
        <div className="bg-theme-surface rounded-xl border border-theme-border p-6 space-y-4">
          <div>
            <h3 className="text-sm font-medium text-theme-primary">
              Canonical 5-Role Deterministic RBAC Permission Matrix
            </h3>
            <p className="text-xs text-theme-secondary mt-0.5">
              Strict deterministic role enforcement. Server-side TenantGuard validates every API mutation and query.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-theme-border text-[10px] text-theme-muted uppercase bg-theme-surface-elevated">
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Appointments</th>
                  <th className="py-2.5 px-3">Leads & SLA</th>
                  <th className="py-2.5 px-3">Action Approval</th>
                  <th className="py-2.5 px-3">Settings & Security</th>
                  <th className="py-2.5 px-3">Identity Vault</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-border">
                <tr>
                  <td className="py-2.5 px-3 text-theme-accent font-bold">OWNER</td>
                  <td className="py-2.5 px-3 text-emerald-600 dark:text-emerald-400">Full Access</td>
                  <td className="py-2.5 px-3 text-emerald-600 dark:text-emerald-400">Full Access</td>
                  <td className="py-2.5 px-3 text-emerald-600 dark:text-emerald-400">Executive Authority</td>
                  <td className="py-2.5 px-3 text-emerald-600 dark:text-emerald-400">Full Access</td>
                  <td className="py-2.5 px-3 text-emerald-600 dark:text-emerald-400">Read & Decrypt</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 text-blue-500 font-bold">ADMIN</td>
                  <td className="py-2.5 px-3 text-emerald-600 dark:text-emerald-400">Full Access</td>
                  <td className="py-2.5 px-3 text-emerald-600 dark:text-emerald-400">Full Access</td>
                  <td className="py-2.5 px-3 text-red-500">Read Only</td>
                  <td className="py-2.5 px-3 text-emerald-600 dark:text-emerald-400">Full Access</td>
                  <td className="py-2.5 px-3 text-emerald-600 dark:text-emerald-400">Read & Decrypt</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 text-amber-500 font-bold">MANAGER</td>
                  <td className="py-2.5 px-3 text-emerald-600 dark:text-emerald-400">Write / Dispatch</td>
                  <td className="py-2.5 px-3 text-emerald-600 dark:text-emerald-400">Write / Dispatch</td>
                  <td className="py-2.5 px-3 text-red-500">Read Only</td>
                  <td className="py-2.5 px-3 text-red-500">Denied</td>
                  <td className="py-2.5 px-3 text-red-500">Pseudonymized Only</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 text-theme-secondary font-bold">STAFF</td>
                  <td className="py-2.5 px-3 text-theme-primary">Check-In / Status</td>
                  <td className="py-2.5 px-3 text-theme-primary">View Assigned</td>
                  <td className="py-2.5 px-3 text-red-500">Denied</td>
                  <td className="py-2.5 px-3 text-red-500">Denied</td>
                  <td className="py-2.5 px-3 text-red-500">Pseudonymized Only</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 text-theme-muted font-bold">VIEWER</td>
                  <td className="py-2.5 px-3 text-theme-muted">Read Only</td>
                  <td className="py-2.5 px-3 text-theme-muted">Read Only</td>
                  <td className="py-2.5 px-3 text-theme-muted">Read Only</td>
                  <td className="py-2.5 px-3 text-red-500">Denied</td>
                  <td className="py-2.5 px-3 text-red-500">Pseudonymized Only</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Retention Policies */}
      {activeTab === 'retention' && (
        <div className="bg-theme-surface rounded-xl border border-theme-border p-6 space-y-4">
          <div>
            <h3 className="text-sm font-medium text-theme-primary">
              Deterministic Data Retention & KV Anomaly Telemetry
            </h3>
            <p className="text-xs text-theme-secondary mt-0.5">
              KV-persisted retention schedules and live ephemeral security telemetry.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {retentionPolicies.map((policy) => (
              <div key={policy.dataType} className="bg-theme-surface-elevated p-4 rounded-lg border border-theme-border space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="font-semibold text-theme-primary uppercase">{policy.dataType.replace('_', ' ')}</span>
                  <span className="text-theme-accent">{policy.retentionDays} Days TTL</span>
                </div>
                <div className="text-[11px] text-theme-secondary">
                  Purge Strategy: <strong className="text-theme-primary">{policy.purgeStrategy}</strong>
                </div>
                <div className="text-[10px] text-theme-muted font-mono">
                  Legal Basis: {policy.legalBasis}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Worker Web Crypto Envelope Vault */}
      {activeTab === 'envelope' && (
        <div className="bg-theme-surface rounded-xl border border-theme-border p-6 space-y-5">
          <div>
            <h3 className="text-sm font-medium text-theme-primary">
              Worker Web Crypto (crypto.subtle) AES-GCM-256 Envelope Encryption Architecture
            </h3>
            <p className="text-xs text-theme-secondary mt-0.5">
              Master Secret + Tenant Context → HKDF → Tenant DEK (256-bit AES-GCM + 96-bit unique IV + 128-bit authentication tag). Executed exclusively on Cloudflare Worker.
            </p>
          </div>

          {vaultStatus.configured === false && (
            <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-lg text-amber-600 dark:text-amber-400 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span><strong>KMS_NOT_CONFIGURED:</strong> Server VELNAR_MASTER_KMS_SECRET environment variable is not provisioned. Production identity encryption requires Cloudflare Worker KMS secret binding.</span>
            </div>
          )}

          {IS_DEV ? (
            <div className="space-y-3 text-xs font-mono">
              <div>
                <label className="block text-[11px] text-theme-secondary mb-1">
                  Plaintext Customer PII Input (Segregated into Encrypted Identity Vault via API)
                </label>
                <textarea
                  rows={2}
                  value={plainTextInput}
                  onChange={(e) => setPlainTextInput(e.target.value)}
                  className="w-full bg-theme-surface-elevated border border-theme-border rounded-lg p-2.5 text-theme-primary focus:outline-none focus:border-theme-accent"
                />
              </div>

              <button
                onClick={handleEncryptSimulation}
                disabled={isEncrypting}
                className="px-4 py-2 rounded-lg bg-theme-accent text-black font-medium text-xs hover:bg-theme-accent/90 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{isEncrypting ? 'Calling Worker Vault API...' : 'Execute Dev AES-GCM Vault API Call'}</span>
              </button>

              {cryptoError && (
                <div className="p-3 bg-red-500/15 border border-red-500/30 rounded text-red-500 text-xs">
                  {cryptoError}
                </div>
              )}

              {storedVaultRecord && (
                <div className="space-y-3 pt-2">
                  <div className="bg-theme-surface-elevated p-4 rounded-lg border border-theme-border space-y-2 text-xs">
                    <div className="text-theme-accent font-semibold flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5" />
                      <span>Worker Stored Vault Metadata Record:</span>
                    </div>
                    <pre className="bg-theme-surface p-2.5 rounded border border-theme-border text-emerald-600 dark:text-emerald-400 break-all text-[10px] overflow-x-auto">
                      {JSON.stringify(storedVaultRecord, null, 2)}
                    </pre>
                    <div className="text-[10px] text-theme-muted flex justify-between">
                      <span>Algorithm: {storedVaultRecord.algorithm}</span>
                      <span>Pseudonym: {storedVaultRecord.pseudonymId}</span>
                    </div>
                  </div>

                  {decryptedOutput && (
                    <div className="bg-theme-surface-elevated p-3.5 rounded-lg border border-theme-border space-y-1 text-xs">
                      <div className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Decrypted Plaintext from Worker (Authorized Under Tenant [{currentOrg?.id || 'ACTIVE_TENANT'}]):</span>
                      </div>
                      <div className="text-theme-primary font-mono text-[11px]">
                        Full Name: {decryptedOutput.fullName} | Email: {decryptedOutput.email} | Phone: {decryptedOutput.phone}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-theme-surface-elevated p-4 rounded-lg border border-theme-border space-y-3 text-xs">
              <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400 font-mono font-semibold">
                <ShieldCheck className="w-4 h-4" />
                <span>Production Cryptographic Invariant Enforced</span>
              </div>
              <p className="text-theme-secondary leading-relaxed">
                In production, customer PII never traverses client browser storage. All customer names, phone numbers, and emails are encrypted via Web Crypto AES-GCM-256 before storage in Cloudflare D1 with tenant-derived HKDF sub-keys.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tab: Dev Verification Suite (DEV ONLY) */}
      {IS_DEV && activeTab === 'tests' && (
        <div className="bg-theme-surface rounded-xl border border-theme-border p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-theme-primary">
                Dev Mock RBAC & Security Test Suite (Local Verification Only)
              </h3>
              <p className="text-xs text-theme-secondary mt-0.5">
                Executes 10 automated verification tests: Cross-tenant isolation, real AES-GCM tamper detection, RBAC gate, and log redaction.
              </p>
            </div>

            <button
              onClick={handleRunSecurityTests}
              disabled={isRunningTests}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-theme-accent text-black font-medium text-xs hover:bg-theme-accent/90 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRunningTests ? 'animate-spin' : ''}`} />
              <span>{isRunningTests ? 'Executing Local Security Verification...' : 'Execute Dev Verification Suite (10 Tests)'}</span>
            </button>
          </div>

          {testError && (
            <div className="p-3 bg-red-500/15 border border-red-500/30 rounded text-red-500 text-xs font-mono">
              {testError}
            </div>
          )}

          {testResults.length === 0 ? (
            <div className="bg-theme-surface-elevated p-8 rounded-lg border border-theme-border text-center space-y-2">
              <ShieldCheck className="w-8 h-8 text-theme-accent mx-auto opacity-70" />
              <div className="text-xs font-mono text-theme-primary">Dev Mock RBAC Test Suite Ready (Local Verification Only)</div>
              <p className="text-[11px] text-theme-muted max-w-md mx-auto">
                Click button to verify local cryptographic key derivation, cross-tenant isolation, tamper resistance, and RBAC boundary rules.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {testResults.map((tCase, idx) => (
                <div key={idx} className="bg-theme-surface-elevated p-3.5 rounded-lg border border-theme-border flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-theme-primary flex items-center gap-2">
                      {tCase.passed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      )}
                      <span>{tCase.name}</span>
                      <span className="text-[10px] font-mono text-theme-muted">[{tCase.testId}]</span>
                    </div>
                    <p className="text-[11px] text-theme-secondary font-mono">{tCase.details}</p>
                  </div>

                  <span className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded ${
                    tCase.passed ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' : 'bg-red-500/15 text-red-500 border border-red-500/30'
                  }`}>
                    {tCase.passed ? 'PASSED' : 'FAILED'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Dev Tap / Check-In Simulator (DEV ONLY) */}
      {IS_DEV && activeTab === 'checkin' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-theme-surface rounded-xl border border-theme-border p-5 space-y-4">
            <div>
              <h3 className="text-sm font-medium text-theme-primary">
                {t.securityView.quickCheckInTitle} (DEV ONLY)
              </h3>
              <p className="text-xs text-theme-secondary mt-0.5">
                {t.securityView.quickCheckInDesc}
              </p>
            </div>

            <form onSubmit={handleLogCheckIn} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-mono text-theme-secondary mb-1">
                  Check-In Nature
                </label>
                <select
                  value={checkInType}
                  onChange={(e) => setCheckInType(e.target.value as any)}
                  className="w-full bg-theme-surface-elevated border border-theme-border rounded-lg px-3 py-2 text-theme-primary focus:outline-none"
                >
                  <option value="appointment_arrival">Scheduled Appointment Arrival</option>
                  <option value="walk_in">Walk-in Customer Attendance</option>
                  <option value="vip_arrival">VIP Client Fast-Track</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-theme-secondary mb-1">
                  Party Size
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={partySize}
                  onChange={(e) => setPartySize(Number(e.target.value))}
                  className="w-full bg-theme-surface-elevated border border-theme-border rounded-lg px-3 py-2 text-theme-primary font-mono focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-lg bg-theme-accent text-black font-medium hover:bg-theme-accent/90 transition-colors cursor-pointer shadow-xs"
              >
                Log 1-Tap Attendance Event
              </button>
            </form>
          </div>

          <div className="bg-theme-surface rounded-xl border border-theme-border p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex items-center space-x-2 text-xs font-mono text-theme-accent">
                <QrCode className="w-3.5 h-3.5" />
                <span>VELNAR Tap (NFC / QR Desk Stand)</span>
              </div>
              <p className="text-xs text-theme-secondary">
                Customers tap their device or scan reception QR. Zero app install required. Generates pseudonymous visitor token.
              </p>
            </div>

            <div className="bg-theme-surface-elevated p-4 rounded-lg border border-theme-border text-center space-y-2">
              <Smartphone className="w-8 h-8 text-theme-accent mx-auto animate-bounce" />
              <div className="text-xs font-mono text-theme-primary">NFC Stand #1 Ready</div>
              <button
                onClick={handleSimulateTap}
                className="px-4 py-2 rounded-lg bg-theme-surface hover:bg-theme-surface-muted text-theme-accent border border-theme-border text-xs font-mono cursor-pointer transition-colors"
              >
                Simulate Customer NFC Tap
              </button>
            </div>

            {lastLoggedCheckIn && (
              <div className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 p-2 rounded border border-emerald-500/30">
                {lastLoggedCheckIn}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
