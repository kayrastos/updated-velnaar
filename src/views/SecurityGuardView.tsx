import React, { useState } from 'react';
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
  Radio, 
  UserCheck,
  Smartphone,
  QrCode
} from 'lucide-react';
import { TenantSecurityEngine } from '../services/tenantSecurity';
import { ApiClient } from '../services/apiClient';
import { SecurityTestResult } from '../types/security';

export const SecurityGuardView: React.FC = () => {
  const { 
    retentionPolicies, 
    recordQuickCheckIn,
    currentOrg,
    t 
  } = usePlatform();

  const [testResults, setTestResults] = useState<SecurityTestResult[]>([]);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [activeTab, setActiveTab] = useState<'tests' | 'envelope' | 'rbac' | 'retention' | 'checkin'>('tests');

  // Server-Side Web Crypto API Visualizer State
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

  // Quick Check-In Form State
  const [checkInType, setCheckInType] = useState<'appointment_arrival' | 'walk_in' | 'vip_arrival'>('appointment_arrival');
  const [partySize, setPartySize] = useState<number>(1);
  const [lastLoggedCheckIn, setLastLoggedCheckIn] = useState<string | null>(null);

  const handleRunSecurityTests = async () => {
    setIsRunningTests(true);
    try {
      const results = await TenantSecurityEngine.runCrossTenantTestsAsync(currentOrg.id);
      setTestResults(results);
    } catch (err: any) {
      console.warn('Falling back to local test runner view:', err);
      setTestResults(TenantSecurityEngine.runCrossTenantTests());
    } finally {
      setIsRunningTests(false);
    }
  };

  const handleEncryptSimulation = async () => {
    setIsEncrypting(true);
    setCryptoError(null);
    try {
      // 1. Send plaintext to Worker API to encrypt with AES-GCM-256 and store in Zero-Trust Vault
      const stored = await ApiClient.storeVaultIdentity({
        fullName: plainTextInput.split('|')[0]?.replace('Customer Real Name:', '').trim() || 'Ayşe Kaya',
        email: 'ayse.kaya@customer-domain.com',
        phone: plainTextInput.split('|')[1]?.replace('Phone:', '').trim() || '+90 532 999 8877',
      }, currentOrg.id);

      setStoredVaultRecord(stored);

      // 2. Query Worker API to verify authenticated decryption under current tenant
      const decrypted = await ApiClient.decryptVaultIdentity(stored.pseudonymId, currentOrg.id);
      setDecryptedOutput(decrypted);
    } catch (e: any) {
      setCryptoError(e.message || 'API encryption / decryption error');
      console.error(e);
    } finally {
      setIsEncrypting(false);
    }
  };

  const handleLogCheckIn = (e: React.FormEvent) => {
    e.preventDefault();
    const ev = recordQuickCheckIn(checkInType, 'staff_manual', Number(partySize), 'Reception Fallback Check-In');
    setLastLoggedCheckIn(`Check-In Logged: ${ev.id} (Visitor Pseudonym: ${ev.pseudonymousVisitorId})`);
  };

  const handleSimulateTap = () => {
    const ev = recordQuickCheckIn('walk_in', 'nfc_tap', 1, 'VELNAR Tap NFC Stand');
    setLastLoggedCheckIn(`VELNAR Tap Received: Device tap_dev_front_01 (Visitor Pseudonym: ${ev.pseudonymousVisitorId})`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0D0F15] p-5 rounded-xl border border-[#232732]">
        <div>
          <div className="flex items-center space-x-2 text-[10px] font-mono tracking-widest text-[#C5A880] uppercase">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>ENTERPRISE HARDENING GATE & ZERO-TRUST VAULT</span>
          </div>
          <h1 className="text-xl font-medium text-[#F5F4F0] mt-1">
            {t.securityView.title}
          </h1>
          <p className="text-xs text-[#8E909B] mt-1 max-w-2xl">
            {t.securityView.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-[#141620] px-3.5 py-2.5 rounded-lg border border-[#272C3D] flex items-center space-x-2 text-xs font-mono text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Web Crypto AES-GCM-256 Active</span>
          </div>
        </div>
      </div>

      {/* Strict Privacy Notice Banner */}
      <div className="bg-[#090A0D] p-4 rounded-xl border border-sky-900/40 bg-gradient-to-r from-sky-950/20 to-transparent flex items-start space-x-3">
        <EyeOff className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <strong className="text-sky-300 font-mono">CALL BRIDGE PRIVACY MANDATE & VAULT SEGREGATION:</strong>
          <p className="text-[#D8D6CD] leading-relaxed">
            {t.securityView.privacyCallNotice}
          </p>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex border-b border-[#232732] gap-2 font-mono text-xs overflow-x-auto">
        <button
          onClick={() => setActiveTab('tests')}
          className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'tests'
              ? 'bg-[#090A0D] text-[#F5F4F0] border-t border-x border-[#232732] font-semibold'
              : 'text-[#8E909B] hover:text-[#E6E4DC]'
          }`}
        >
          <Play className="w-3.5 h-3.5 text-[#C5A880]" />
          <span>Security Hardening Gate Tests (10)</span>
        </button>

        <button
          onClick={() => setActiveTab('envelope')}
          className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'envelope'
              ? 'bg-[#090A0D] text-[#F5F4F0] border-t border-x border-[#232732] font-semibold'
              : 'text-[#8E909B] hover:text-[#E6E4DC]'
          }`}
        >
          <Lock className="w-3.5 h-3.5 text-emerald-400" />
          <span>Worker Web Crypto AES-GCM Vault API</span>
        </button>

        <button
          onClick={() => setActiveTab('rbac')}
          className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'rbac'
              ? 'bg-[#090A0D] text-[#F5F4F0] border-t border-x border-[#232732] font-semibold'
              : 'text-[#8E909B] hover:text-[#E6E4DC]'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5 text-purple-400" />
          <span>Canonical 5-Role RBAC Matrix</span>
        </button>

        <button
          onClick={() => setActiveTab('retention')}
          className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'retention'
              ? 'bg-[#090A0D] text-[#F5F4F0] border-t border-x border-[#232732] font-semibold'
              : 'text-[#8E909B] hover:text-[#E6E4DC]'
          }`}
        >
          <FileText className="w-3.5 h-3.5 text-amber-400" />
          <span>Retention & Anomaly Receiver</span>
        </button>

        <button
          onClick={() => setActiveTab('checkin')}
          className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'checkin'
              ? 'bg-[#090A0D] text-[#F5F4F0] border-t border-x border-[#232732] font-semibold'
              : 'text-[#8E909B] hover:text-[#E6E4DC]'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5 text-[#C5A880]" />
          <span>Quick Check-In / Tap</span>
        </button>
      </div>

      {/* Tab 1: Cross-Tenant Breach Test Runner */}
      {activeTab === 'tests' && (
        <div className="bg-[#090A0D] rounded-xl border border-[#232732] p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-[#F5F4F0]">
                {t.securityView.testSuiteTitle}
              </h3>
              <p className="text-xs text-[#8E909B] mt-0.5">
                Executes 10 automated verification tests: Cross-tenant isolation, real AES-GCM tamper detection, RBAC gate, and log redaction.
              </p>
            </div>

            <button
              onClick={handleRunSecurityTests}
              disabled={isRunningTests}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-[#C5A880] text-black font-medium text-xs hover:bg-[#D4BC98] transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRunningTests ? 'animate-spin' : ''}`} />
              <span>{isRunningTests ? 'Executing Live Crypto & Security Tests...' : 'Execute Hardening Suite (10 Tests)'}</span>
            </button>
          </div>

          {testResults.length === 0 ? (
            <div className="bg-[#141620] p-8 rounded-lg border border-[#1E2230] text-center space-y-2">
              <ShieldCheck className="w-8 h-8 text-[#C5A880] mx-auto opacity-70" />
              <div className="text-xs font-mono text-[#E6E4DC]">Security Regression Suite Ready (10 Hardening Tests)</div>
              <p className="text-[11px] text-[#717482] max-w-md mx-auto">
                Click "Execute Hardening Suite" to run cryptographic key derivation, cross-tenant isolation, tamper resistance, and RBAC boundary verification.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {testResults.map((tCase, idx) => (
                <div key={idx} className="bg-[#141620] p-3.5 rounded-lg border border-[#1E2230] flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-[#F5F4F0] flex items-center gap-2">
                      {tCase.passed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      )}
                      <span>{tCase.name}</span>
                      <span className="text-[10px] font-mono text-[#717482]">[{tCase.testId}]</span>
                    </div>
                    <p className="text-[11px] text-[#8E909B] font-mono">{tCase.details}</p>
                  </div>

                  <span className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded ${
                    tCase.passed ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/40' : 'bg-red-950 text-red-400'
                  }`}>
                    {tCase.passed ? 'PASSED' : 'FAILED'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Server-Side Web Crypto AES-GCM Envelope Visualizer via Worker API */}
      {activeTab === 'envelope' && (
        <div className="bg-[#090A0D] rounded-xl border border-[#232732] p-6 space-y-5">
          <div>
            <h3 className="text-sm font-medium text-[#F5F4F0]">
              Worker Web Crypto (crypto.subtle) AES-GCM-256 Envelope Encryption API
            </h3>
            <p className="text-xs text-[#8E909B] mt-0.5">
              Master Secret + Tenant Context → HKDF → Tenant DEK (256-bit AES-GCM + 96-bit unique IV + 128-bit authentication tag). Executed exclusively on Cloudflare Worker.
            </p>
          </div>

          <div className="space-y-3 text-xs font-mono">
            <div>
              <label className="block text-[11px] text-[#8E909B] mb-1">
                Plaintext Customer PII Input (Segregated into Zero-Knowledge Identity Vault via API)
              </label>
              <textarea
                rows={2}
                value={plainTextInput}
                onChange={(e) => setPlainTextInput(e.target.value)}
                className="w-full bg-[#151822] border border-[#2A2F3D] rounded-lg p-2.5 text-[#F5F4F0] focus:outline-none focus:border-[#C5A880]"
              />
            </div>

            <button
              onClick={handleEncryptSimulation}
              disabled={isEncrypting}
              className="px-4 py-2 rounded-lg bg-[#C5A880] text-black font-medium text-xs hover:bg-[#D4BC98] transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{isEncrypting ? 'Calling Worker Vault API...' : 'Execute Server-Side AES-GCM Vault API Call'}</span>
            </button>

            {cryptoError && (
              <div className="p-3 bg-red-950/30 border border-red-800/40 rounded text-red-400 text-xs">
                {cryptoError}
              </div>
            )}

            {storedVaultRecord && (
              <div className="space-y-3 pt-2">
                <div className="bg-[#141620] p-4 rounded-lg border border-[#1E2230] space-y-2 text-xs">
                  <div className="text-[#C5A880] font-semibold flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5" />
                    <span>Worker Stored Vault Metadata Record:</span>
                  </div>
                  <pre className="bg-[#0B0D13] p-2.5 rounded border border-[#1A1D27] text-emerald-400 break-all text-[10px] overflow-x-auto">
                    {JSON.stringify(storedVaultRecord, null, 2)}
                  </pre>
                  <div className="text-[10px] text-[#717482] flex justify-between">
                    <span>Algorithm: {storedVaultRecord.algorithm}</span>
                    <span>Pseudonym: {storedVaultRecord.pseudonymId}</span>
                  </div>
                </div>

                {decryptedOutput && (
                  <div className="bg-[#141620] p-3.5 rounded-lg border border-[#1E2230] space-y-1 text-xs">
                    <div className="text-emerald-400 font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Decrypted Plaintext from Worker (Authorized Under Tenant [{currentOrg.id}]):</span>
                    </div>
                    <div className="text-[#D8D6CD] font-mono text-[11px]">
                      Full Name: {decryptedOutput.fullName} | Email: {decryptedOutput.email} | Phone: {decryptedOutput.phone}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Canonical 5-Role RBAC Matrix */}
      {activeTab === 'rbac' && (
        <div className="bg-[#090A0D] rounded-xl border border-[#232732] p-6 space-y-4">
          <div>
            <h3 className="text-sm font-medium text-[#F5F4F0]">
              Canonical 5-Role Deterministic RBAC Permission Matrix
            </h3>
            <p className="text-xs text-[#8E909B] mt-0.5">
              Strict deterministic role enforcement. Server-side TenantGuard validates every API mutation and query.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-[#1E222D] text-[10px] text-[#717482] uppercase bg-[#0D0F15]">
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Appointments</th>
                  <th className="py-2.5 px-3">Leads & SLA</th>
                  <th className="py-2.5 px-3">Action Approval</th>
                  <th className="py-2.5 px-3">Settings & Security</th>
                  <th className="py-2.5 px-3">Identity Vault</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C202B]">
                <tr>
                  <td className="py-2.5 px-3 text-[#C5A880] font-bold">OWNER</td>
                  <td className="py-2.5 px-3 text-emerald-400">Full Access</td>
                  <td className="py-2.5 px-3 text-emerald-400">Full Access</td>
                  <td className="py-2.5 px-3 text-emerald-400">Executive Authority</td>
                  <td className="py-2.5 px-3 text-emerald-400">Full Access</td>
                  <td className="py-2.5 px-3 text-emerald-400">Read & Decrypt</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 text-blue-400 font-bold">ADMIN</td>
                  <td className="py-2.5 px-3 text-emerald-400">Full Access</td>
                  <td className="py-2.5 px-3 text-emerald-400">Full Access</td>
                  <td className="py-2.5 px-3 text-emerald-400">Approve & Execute</td>
                  <td className="py-2.5 px-3 text-emerald-400">Config Only</td>
                  <td className="py-2.5 px-3 text-zinc-600">Restricted (403)</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 text-purple-400 font-bold">MANAGER</td>
                  <td className="py-2.5 px-3 text-emerald-400">Full Access</td>
                  <td className="py-2.5 px-3 text-emerald-400">Dispatch Leads</td>
                  <td className="py-2.5 px-3 text-amber-400">Operational Only</td>
                  <td className="py-2.5 px-3 text-zinc-600">Read-Only</td>
                  <td className="py-2.5 px-3 text-zinc-600">Restricted (403)</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 text-zinc-300 font-bold">STAFF</td>
                  <td className="py-2.5 px-3 text-emerald-400">Schedule & Check-in</td>
                  <td className="py-2.5 px-3 text-emerald-400">View Inbound</td>
                  <td className="py-2.5 px-3 text-red-400">Blocked (403)</td>
                  <td className="py-2.5 px-3 text-red-400">Blocked (403)</td>
                  <td className="py-2.5 px-3 text-zinc-600">Restricted (403)</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 text-zinc-500 font-bold">VIEWER</td>
                  <td className="py-2.5 px-3 text-zinc-400">Read-Only</td>
                  <td className="py-2.5 px-3 text-zinc-400">Read-Only</td>
                  <td className="py-2.5 px-3 text-red-400">Blocked (403)</td>
                  <td className="py-2.5 px-3 text-zinc-400">Read-Only</td>
                  <td className="py-2.5 px-3 text-zinc-600">Restricted (403)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Retention Policies & Fulgor Ray Anomaly Detector */}
      {activeTab === 'retention' && (
        <div className="space-y-4">
          <div className="bg-[#090A0D] rounded-xl border border-[#232732] p-5 space-y-4">
            <h3 className="text-sm font-medium text-[#F5F4F0]">
              {t.securityView.retentionTitle}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {retentionPolicies.map((p, idx) => (
                <div key={idx} className="bg-[#141620] p-3 rounded-lg border border-[#1E2230] text-xs">
                  <div className="flex items-center justify-between font-mono">
                    <span className="text-[#C5A880] font-semibold uppercase">{p.dataClass}</span>
                    <span className="text-emerald-400">{p.retentionDays} Days</span>
                  </div>
                  <p className="text-[11px] text-[#8E909B] mt-1">{p.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#090A0D] rounded-xl border border-zinc-800 p-5 space-y-2">
            <div className="flex items-center space-x-2 text-xs font-mono text-zinc-400">
              <Radio className="w-3.5 h-3.5" />
              <span>Fulgor Ray Provider-Neutral Anomaly Telemetry Adapter</span>
            </div>
            <p className="text-xs text-[#8E909B] leading-relaxed">
              Fulgor Ray is a future offline security and anomaly telemetry receiver. In accordance with Sprint 3.1 hardening mandates, this adapter is currently <strong>DISABLED / UNCONFIGURED</strong> and possesses zero authorization or identity authorities.
            </p>
            <div className="pt-2 text-[10px] font-mono text-[#8E909B] flex items-center justify-between border-t border-[#1C202B]">
              <span>Adapter State: <strong className="text-amber-400">DISABLED (Offline Sink Only)</strong></span>
              <span className="text-zinc-500">Zero In-Path Authorization Impact</span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Fallback Quick Check-In & VELNAR Tap */}
      {activeTab === 'checkin' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Quick Staff Manual Fallback */}
          <div className="bg-[#090A0D] rounded-xl border border-[#232732] p-5 space-y-4">
            <div>
              <h3 className="text-sm font-medium text-[#F5F4F0]">
                {t.securityView.quickCheckInTitle}
              </h3>
              <p className="text-xs text-[#8E909B] mt-0.5">
                {t.securityView.quickCheckInDesc}
              </p>
            </div>

            <form onSubmit={handleLogCheckIn} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-mono text-[#8E909B] mb-1">
                  Check-In Nature
                </label>
                <select
                  value={checkInType}
                  onChange={(e) => setCheckInType(e.target.value as any)}
                  className="w-full bg-[#151822] border border-[#2A2F3D] rounded-lg px-3 py-2 text-[#F5F4F0] focus:outline-none"
                >
                  <option value="appointment_arrival">Scheduled Appointment Arrival</option>
                  <option value="walk_in">Walk-in Customer Attendance</option>
                  <option value="vip_arrival">VIP Client Fast-Track</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[#8E909B] mb-1">
                  Party Size
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={partySize}
                  onChange={(e) => setPartySize(Number(e.target.value))}
                  className="w-full bg-[#151822] border border-[#2A2F3D] rounded-lg px-3 py-2 text-[#F5F4F0] font-mono focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-lg bg-[#C5A880] text-black font-medium hover:bg-[#D4BC98] transition-colors cursor-pointer"
              >
                Log 1-Tap Attendance Event
              </button>
            </form>
          </div>

          {/* VELNAR Tap NFC / QR Simulator */}
          <div className="bg-[#090A0D] rounded-xl border border-[#232732] p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex items-center space-x-2 text-xs font-mono text-[#C5A880]">
                <QrCode className="w-3.5 h-3.5" />
                <span>VELNAR Tap (NFC / QR Desk Stand)</span>
              </div>
              <p className="text-xs text-[#8E909B]">
                Customers tap their device or scan reception QR. Zero app install required. Generates pseudonymous visitor token.
              </p>
            </div>

            <div className="bg-[#141620] p-4 rounded-lg border border-[#1E2230] text-center space-y-2">
              <Smartphone className="w-8 h-8 text-[#C5A880] mx-auto animate-bounce" />
              <div className="text-xs font-mono text-[#F5F4F0]">NFC Stand #1 Ready</div>
              <button
                onClick={handleSimulateTap}
                className="px-4 py-2 rounded-lg bg-[#1F2433] hover:bg-[#282F42] text-[#C5A880] border border-[#C5A880]/30 text-xs font-mono cursor-pointer transition-colors"
              >
                Simulate Customer NFC Tap
              </button>
            </div>

            {lastLoggedCheckIn && (
              <div className="text-[10px] font-mono text-emerald-400 bg-emerald-950/30 p-2 rounded border border-emerald-800/30">
                {lastLoggedCheckIn}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
