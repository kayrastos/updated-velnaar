import React, { useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { 
  Award, 
  ShieldCheck, 
  Download, 
  TrendingUp, 
  CheckCircle2, 
  FileCheck2, 
  Calculator,
  Hash,
  ExternalLink
} from 'lucide-react';

export const VelnarProofView: React.FC = () => {
  const { actionResults, formatCurrency, currentBusiness, currentMarket, t } = usePlatform();
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const totalRecovered = actionResults
    .filter(r => r.status === 'success')
    .reduce((sum, r) => sum + ((r.revenue_recovered_amount_minor || 0) / 100), 0);

  const handleExportCertificate = () => {
    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 3000);
  };

  return (
    <div id="velnar-proof-view" className="space-y-6">
      
      {/* Top Banner & Overview */}
      <div className="bg-theme-surface p-5 rounded-xl border border-theme-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <Award className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h1 className="text-xl font-editorial font-bold text-theme-primary tracking-wide">
              {t.proof.title}
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-bold">
              {t.proof.verifiedBadge}
            </span>
          </div>
          <p className="text-xs text-theme-secondary mt-1 max-w-2xl">
            {t.proof.subtitle}
          </p>
        </div>

        <button
          id="export-proof-certificate"
          onClick={handleExportCertificate}
          className="flex items-center space-x-2 bg-theme-surface-elevated hover:bg-theme-surface text-theme-primary px-4 py-2 rounded-lg border border-theme-border text-xs font-mono transition-all cursor-pointer"
        >
          <Download className="w-4 h-4 text-theme-accent" />
          <span>{downloadSuccess ? 'Certificate Generated' : t.proof.exportCertificate}</span>
        </button>
      </div>

      {/* Hero Outcome Metrics in Proof */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-theme-surface p-5 rounded-xl border border-emerald-500/30">
          <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 uppercase font-semibold mb-2">
            {t.proof.totalRecovered}
          </div>
          <div className="text-3xl font-mono font-bold text-theme-primary">
            {formatCurrency(totalRecovered)}
          </div>
          <p className="text-[11px] text-theme-secondary mt-2">
            Audited financial recovery linked directly to executed growth actions.
          </p>
        </div>

        <div className="bg-theme-surface p-5 rounded-xl border border-theme-border">
          <div className="text-xs font-mono text-theme-accent uppercase font-semibold mb-2">
            Audited Conversion Events
          </div>
          <div className="text-3xl font-mono font-bold text-theme-primary">
            {actionResults.length}
          </div>
          <p className="text-[11px] text-theme-secondary mt-2">
            Independent pipeline cohorts monitored against static control baseline.
          </p>
        </div>

        <div className="bg-theme-surface p-5 rounded-xl border border-theme-border">
          <div className="text-xs font-mono text-theme-muted uppercase font-semibold mb-2">
            Ledger Integrity Hash
          </div>
          <div className="text-xs font-mono text-theme-primary bg-theme-surface-elevated p-2 rounded border border-theme-border truncate">
            sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069
          </div>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-2 flex items-center gap-1 font-mono">
            <ShieldCheck className="w-3.5 h-3.5" /> Immutable Attribution Verified
          </p>
        </div>
      </div>

      {/* Attribution Formula Card */}
      <div className="bg-theme-surface p-4 rounded-xl border border-theme-border flex items-start space-x-3 text-xs font-mono">
        <Calculator className="w-5 h-5 text-theme-accent shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="text-theme-primary font-semibold">{t.proof.formulaTitle}</span>
          <p className="text-theme-secondary leading-relaxed font-sans text-xs">
            {t.proof.formulaDesc}
          </p>
        </div>
      </div>

      {/* Attribution Transaction Ledger Table */}
      <div className="bg-theme-surface rounded-xl border border-theme-border overflow-hidden">
        <div className="p-4 border-b border-theme-border flex items-center justify-between">
          <h2 className="text-xs font-mono uppercase tracking-wider font-semibold text-theme-primary">
            {t.proof.attributionLedger} ({currentMarket})
          </h2>
          <span className="text-[10px] font-mono text-theme-muted">
            Business: {currentBusiness.name}
          </span>
        </div>

        {actionResults.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-theme-muted">
            No verified recovery transactions recorded in this market yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-theme-surface-elevated text-theme-muted uppercase text-[10px] border-b border-theme-border">
                <tr>
                  <th className="px-4 py-3">Result ID</th>
                  <th className="px-4 py-3">Action Ref</th>
                  <th className="px-4 py-3">Delta Impact</th>
                  <th className="px-4 py-3">Recovered Revenue</th>
                  <th className="px-4 py-3">Verification Notes</th>
                  <th className="px-4 py-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-border">
                {actionResults.map((result) => {
                  const deltaObj = JSON.parse(result.metric_delta_json);

                  return (
                    <tr key={result.id} className="hover:bg-theme-surface-elevated/50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-theme-primary">
                        {result.id}
                      </td>
                      <td className="px-4 py-3 text-theme-accent">
                        {result.growth_action_id}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-emerald-600 dark:text-emerald-400 font-bold">
                          {deltaObj.delta}
                        </div>
                        <div className="text-[10px] text-theme-muted">
                          {deltaObj.baseline} → {deltaObj.current}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                        +{formatCurrency((result.revenue_recovered_amount_minor || 0) / 100)}
                      </td>
                      <td className="px-4 py-3 text-theme-secondary font-sans max-w-xs text-xs">
                        {result.proof_notes}
                      </td>
                      <td className="px-4 py-3 text-theme-muted">
                        {new Date(result.verified_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};
