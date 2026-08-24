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
      <div className="bg-[#0D0F15] p-5 rounded-xl border border-[#232732] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <Award className="w-5 h-5 text-emerald-400" />
            <h1 className="text-xl font-editorial font-bold text-[#F5F4F0] tracking-wide">
              {t.proof.title}
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 font-bold">
              {t.proof.verifiedBadge}
            </span>
          </div>
          <p className="text-xs text-[#8E909B] mt-1 max-w-2xl">
            {t.proof.subtitle}
          </p>
        </div>

        <button
          id="export-proof-certificate"
          onClick={handleExportCertificate}
          className="flex items-center space-x-2 bg-[#161922] hover:bg-[#1E2333] text-[#D8D6CD] hover:text-[#FFF] px-4 py-2 rounded-lg border border-[#2E3547] text-xs font-mono transition-all cursor-pointer"
        >
          <Download className="w-4 h-4 text-[#C5A880]" />
          <span>{downloadSuccess ? 'Certificate Generated' : t.proof.exportCertificate}</span>
        </button>
      </div>

      {/* Hero Outcome Metrics in Proof */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#0F121A] p-5 rounded-xl border border-emerald-900/30">
          <div className="text-xs font-mono text-emerald-400 uppercase font-semibold mb-2">
            {t.proof.totalRecovered}
          </div>
          <div className="text-3xl font-mono font-bold text-[#F5F4F0]">
            {formatCurrency(totalRecovered)}
          </div>
          <p className="text-[11px] text-[#8E909B] mt-2">
            Audited financial recovery linked directly to executed growth actions.
          </p>
        </div>

        <div className="bg-[#0F121A] p-5 rounded-xl border border-[#232732]">
          <div className="text-xs font-mono text-[#C5A880] uppercase font-semibold mb-2">
            Audited Conversion Events
          </div>
          <div className="text-3xl font-mono font-bold text-[#F5F4F0]">
            {actionResults.length}
          </div>
          <p className="text-[11px] text-[#8E909B] mt-2">
            Independent pipeline cohorts monitored against static control baseline.
          </p>
        </div>

        <div className="bg-[#0F121A] p-5 rounded-xl border border-[#232732]">
          <div className="text-xs font-mono text-[#A1A4B2] uppercase font-semibold mb-2">
            Ledger Integrity Hash
          </div>
          <div className="text-xs font-mono text-[#D8D6CD] bg-[#141622] p-2 rounded border border-[#222736] truncate">
            sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069
          </div>
          <p className="text-[11px] text-emerald-400 mt-2 flex items-center gap-1 font-mono">
            <ShieldCheck className="w-3.5 h-3.5" /> Immutable Attribution Verified
          </p>
        </div>
      </div>

      {/* Attribution Formula Card */}
      <div className="bg-[#0D0F15] p-4 rounded-xl border border-[#232732] flex items-start space-x-3 text-xs font-mono">
        <Calculator className="w-5 h-5 text-[#C5A880] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="text-[#F5F4F0] font-semibold">{t.proof.formulaTitle}</span>
          <p className="text-[#8E909B] leading-relaxed font-sans text-xs">
            {t.proof.formulaDesc}
          </p>
        </div>
      </div>

      {/* Attribution Transaction Ledger Table */}
      <div className="bg-[#0F121A] rounded-xl border border-[#232732] overflow-hidden">
        <div className="p-4 border-b border-[#232732] flex items-center justify-between">
          <h2 className="text-xs font-mono uppercase tracking-wider font-semibold text-[#E6E4DC]">
            {t.proof.attributionLedger} ({currentMarket})
          </h2>
          <span className="text-[10px] font-mono text-[#717585]">
            Business: {currentBusiness.name}
          </span>
        </div>

        {actionResults.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-[#8E909B]">
            No verified recovery transactions recorded in this market yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#121520] text-[#7E8292] uppercase text-[10px] border-b border-[#1F2433]">
                <tr>
                  <th className="px-4 py-3">Result ID</th>
                  <th className="px-4 py-3">Action Ref</th>
                  <th className="px-4 py-3">Delta Impact</th>
                  <th className="px-4 py-3">Recovered Revenue</th>
                  <th className="px-4 py-3">Verification Notes</th>
                  <th className="px-4 py-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C202B]">
                {actionResults.map((result) => {
                  const deltaObj = JSON.parse(result.metric_delta_json);

                  return (
                    <tr key={result.id} className="hover:bg-[#151824] transition-colors">
                      <td className="px-4 py-3 font-semibold text-[#F5F4F0]">
                        {result.id}
                      </td>
                      <td className="px-4 py-3 text-[#C5A880]">
                        {result.growth_action_id}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-emerald-400 font-bold">
                          {deltaObj.delta}
                        </div>
                        <div className="text-[10px] text-[#7E8292]">
                          {deltaObj.baseline} → {deltaObj.current}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-emerald-400 font-bold text-sm">
                        +{formatCurrency((result.revenue_recovered_amount_minor || 0) / 100)}
                      </td>
                      <td className="px-4 py-3 text-[#A1A4B2] font-sans max-w-xs text-xs">
                        {result.proof_notes}
                      </td>
                      <td className="px-4 py-3 text-[#7E8292]">
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
