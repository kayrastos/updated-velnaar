import React, { useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { 
  ShieldAlert, 
  ShieldCheck, 
  Lock, 
  Key, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Play, 
  Server, 
  EyeOff, 
  FileText, 
  Radio, 
  UserCheck,
  Smartphone,
  QrCode
} from 'lucide-react';
import { TenantSecurityEngine } from '../services/tenantSecurity';

export const SecurityGuardView: React.FC = () => {
  const { 
    securityEvents, 
    retentionPolicies, 
    runSecurityAuditTests, 
    recordQuickCheckIn,
    currentRole,
    currentOrg,
    t 
  } = usePlatform();

  const [testResults, setTestResults] = useState<Array<{
    testName: string;
    description: string;
    passed: boolean;
    statusText: string;
  }>>([]);

  const [isRunningTests, setIsRunningTests] = useState(false);
  const [activeTab, setActiveTab] = useState<'tests' | 'envelope' | 'rbac' | 'retention' | 'checkin'>('tests');

  // Encryption Visualizer State
  const [plainTextInput, setPlainTextInput] = useState('Customer Real Name: Ayşe Kaya | Phone: +90 532 999 8877');
  const [encryptedOutput, setEncryptedOutput] = useState<{ ciphertext: string; keyVersion: number } | null>(null);

  // Quick Check-In Form State
  const [checkInType, setCheckInType] = useState<'appointment_arrival' | 'walk_in' | 'vip_arrival'>('appointment_arrival');
  const [partySize, setPartySize] = useState<number>(1);
  const [lastLoggedCheckIn, setLastLoggedCheckIn] = useState<string | null>(null);

  const handleRunSecurityTests = () => {
    setIsRunningTests(true);
    setTimeout(() => {
      const results = runSecurityAuditTests();
      setTestResults(results);
      setIsRunningTests(false);
    }, 400);
  };

  const handleEncryptSimulation = () => {
    const res = TenantSecurityEngine.mockEnvelopeEncrypt(currentOrg.id, plainTextInput);
    setEncryptedOutput(res);
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
            <span>ENTERPRISE GOVERNANCE & IDENTITY VAULT</span>
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
            <span>Zero-Trust Vault Active</span>
          </div>
        </div>
      </div>

      {/* Strict Privacy Notice Banner */}
      <div className="bg-[#090A0D] p-4 rounded-xl border border-sky-900/40 bg-gradient-to-r from-sky-950/20 to-transparent flex items-start space-x-3">
        <EyeOff className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <strong className="text-sky-300 font-mono">CALL BRIDGE PRIVACY MANDATE:</strong>
          <p className="text-[#D8D6CD] leading-relaxed">
            {t.securityView.privacyCallNotice}
          </p>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex border-b border-[#232732] gap-2 font-mono text-xs">
        <button
          onClick={() => setActiveTab('tests')}
          className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'tests'
              ? 'bg-[#090A0D] text-[#F5F4F0] border-t border-x border-[#232732] font-semibold'
              : 'text-[#8E909B] hover:text-[#E6E4DC]'
          }`}
        >
          <Play className="w-3.5 h-3.5 text-[#C5A880]" />
          <span>Cross-Tenant Test Suite</span>
        </button>

        <button
          onClick={() => setActiveTab('envelope')}
          className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'envelope'
              ? 'bg-[#090A0D] text-[#F5F4F0] border-t border-x border-[#232732] font-semibold'
              : 'text-[#8E909B] hover:text-[#E6E4DC]'
          }`}
        >
          <Lock className="w-3.5 h-3.5 text-emerald-400" />
          <span>Envelope Encryption</span>
        </button>

        <button
          onClick={() => setActiveTab('rbac')}
          className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'rbac'
              ? 'bg-[#090A0D] text-[#F5F4F0] border-t border-x border-[#232732] font-semibold'
              : 'text-[#8E909B] hover:text-[#E6E4DC]'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5 text-purple-400" />
          <span>5-Role RBAC Matrix</span>
        </button>

        <button
          onClick={() => setActiveTab('retention')}
          className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'retention'
              ? 'bg-[#090A0D] text-[#F5F4F0] border-t border-x border-[#232732] font-semibold'
              : 'text-[#8E909B] hover:text-[#E6E4DC]'
          }`}
        >
          <FileText className="w-3.5 h-3.5 text-amber-400" />
          <span>Data Retention & Anomaly</span>
        </button>

        <button
          onClick={() => setActiveTab('checkin')}
          className={`px-4 py-2.5 rounded-t-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
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
                Executes simulated adversarial tenant boundary penetration attempts to prove zero data leakage.
              </p>
            </div>

            <button
              onClick={handleRunSecurityTests}
              disabled={isRunningTests}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-[#C5A880] text-black font-medium text-xs hover:bg-[#D4BC98] transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRunningTests ? 'animate-spin' : ''}`} />
              <span>{isRunningTests ? 'Executing Tests...' : t.securityView.runTestsBtn}</span>
            </button>
          </div>

          {testResults.length === 0 ? (
            <div className="bg-[#141620] p-8 rounded-lg border border-[#1E2230] text-center space-y-2">
              <ShieldCheck className="w-8 h-8 text-[#C5A880] mx-auto opacity-70" />
              <div className="text-xs font-mono text-[#E6E4DC]">Security Regression Suite Ready</div>
              <p className="text-[11px] text-[#717482] max-w-md mx-auto">
                Click "Execute Security Breach Tests" to simulate cross-tenant lead queries, unauthorized action approvals, and RBAC boundary checks.
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
                      <span>{tCase.testName}</span>
                    </div>
                    <p className="text-[11px] text-[#8E909B]">{tCase.description}</p>
                    <div className="text-[10px] font-mono text-[#C5A880]">{tCase.statusText}</div>
                  </div>

                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
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

      {/* Tab 2: Server-Side Envelope Encryption Simulator */}
      {activeTab === 'envelope' && (
        <div className="bg-[#090A0D] rounded-xl border border-[#232732] p-6 space-y-5">
          <div>
            <h3 className="text-sm font-medium text-[#F5F4F0]">
              {t.securityView.envelopeTitle}
            </h3>
            <p className="text-xs text-[#8E909B] mt-0.5">
              {t.securityView.envelopeDesc}
            </p>
          </div>

          <div className="space-y-3 text-xs font-mono">
            <div>
              <label className="block text-[11px] text-[#8E909B] mb-1">
                Plaintext PII Input (Segregated into Identity Vault)
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
              className="px-4 py-2 rounded-lg bg-[#C5A880] text-black font-medium text-xs hover:bg-[#D4BC98] transition-colors cursor-pointer"
            >
              Simulate Server-Side KMS & DEK Envelope Encryption
            </button>

            {encryptedOutput && (
              <div className="bg-[#141620] p-4 rounded-lg border border-[#1E2230] space-y-2 text-xs">
                <div className="text-[#C5A880] font-semibold flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5" />
                  <span>Envelope Encryption Output (Stored in DB):</span>
                </div>
                <div className="bg-[#0B0D13] p-2.5 rounded border border-[#1A1D27] text-emerald-400 break-all">
                  {encryptedOutput.ciphertext}
                </div>
                <div className="text-[10px] text-[#717482] flex justify-between">
                  <span>Tenant DEK Version: {encryptedOutput.keyVersion}</span>
                  <span>Zero Plaintext Stored in Event Telemetry</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: 5-Role RBAC Matrix */}
      {activeTab === 'rbac' && (
        <div className="bg-[#090A0D] rounded-xl border border-[#232732] p-6 space-y-4">
          <div>
            <h3 className="text-sm font-medium text-[#F5F4F0]">
              5 Enterprise Roles & Access Matrix
            </h3>
            <p className="text-xs text-[#8E909B] mt-0.5">
              Strict deterministic role enforcement. AI never decides or alters user permissions.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-[#1E222D] text-[10px] text-[#717482] uppercase bg-[#0D0F15]">
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Appointments</th>
                  <th className="py-2.5 px-3">Lead Velocity</th>
                  <th className="py-2.5 px-3">Action Approval</th>
                  <th className="py-2.5 px-3">Settings & RBAC</th>
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
                  <td className="py-2.5 px-3 text-zinc-600">Restricted</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 text-purple-400 font-bold">MANAGER</td>
                  <td className="py-2.5 px-3 text-emerald-400">Full Access</td>
                  <td className="py-2.5 px-3 text-emerald-400">Dispatch Leads</td>
                  <td className="py-2.5 px-3 text-amber-400">Operational Only</td>
                  <td className="py-2.5 px-3 text-zinc-600">Read-Only</td>
                  <td className="py-2.5 px-3 text-zinc-600">Restricted</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 text-zinc-300 font-bold">STAFF</td>
                  <td className="py-2.5 px-3 text-emerald-400">Schedule & Check-in</td>
                  <td className="py-2.5 px-3 text-emerald-400">View Inbound</td>
                  <td className="py-2.5 px-3 text-red-400">Blocked (403)</td>
                  <td className="py-2.5 px-3 text-red-400">Blocked (403)</td>
                  <td className="py-2.5 px-3 text-zinc-600">Restricted</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 text-zinc-500 font-bold">VIEWER</td>
                  <td className="py-2.5 px-3 text-zinc-400">Read-Only</td>
                  <td className="py-2.5 px-3 text-zinc-400">Read-Only</td>
                  <td className="py-2.5 px-3 text-red-400">Blocked (403)</td>
                  <td className="py-2.5 px-3 text-zinc-400">Read-Only</td>
                  <td className="py-2.5 px-3 text-zinc-600">Restricted</td>
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

          <div className="bg-[#090A0D] rounded-xl border border-purple-900/30 bg-gradient-to-br from-purple-950/10 to-[#090A0D] p-5 space-y-2">
            <div className="flex items-center space-x-2 text-xs font-mono text-purple-400">
              <Radio className="w-3.5 h-3.5" />
              <span>{t.securityView.fulgorRayTitle}</span>
            </div>
            <p className="text-xs text-[#D8D6CD] leading-relaxed">
              {t.securityView.fulgorRayDesc}
            </p>
            <div className="pt-2 text-[10px] font-mono text-[#8E909B] flex items-center justify-between">
              <span>Adapter State: <strong>Online & Streaming Anonymized Telemetry</strong></span>
              <span className="text-purple-300">Active Behavioral Score: 0.02 (Nominal)</span>
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
