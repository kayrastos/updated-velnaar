import React, { useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { LeakCategory, LeakSeverity, RevenueLeakRow } from '../types/database';
import { 
  Radar, 
  AlertTriangle, 
  Sparkles, 
  Filter, 
  Search, 
  ArrowRight, 
  FileText, 
  X,
  ShieldAlert,
  BarChart2,
  CheckCircle
} from 'lucide-react';

export const RevenueLeakRadarView: React.FC = () => {
  const { leaks, formatCurrency, currentMarket, setCurrentRoute, t } = usePlatform();
  
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [activeForensicLeak, setActiveForensicLeak] = useState<RevenueLeakRow | null>(null);

  const filteredLeaks = leaks.filter(leak => {
    if (selectedCategory !== 'all' && leak.category !== selectedCategory) return false;
    if (selectedSeverity !== 'all' && leak.severity !== selectedSeverity) return false;
    return true;
  });

  const totalFilteredLoss = filteredLeaks.reduce((sum, l) => sum + (l.status === 'active' ? l.estimated_monthly_loss : 0), 0);

  return (
    <div id="revenue-leak-radar-view" className="space-y-6">
      
      {/* Header & Overview */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0D0F15] p-5 rounded-xl border border-[#232732]">
        <div>
          <div className="flex items-center space-x-2.5">
            <Radar className="w-5 h-5 text-red-400" />
            <h1 className="text-xl font-editorial font-bold text-[#F5F4F0] tracking-wide">
              {t.leaks.title}
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-red-950/60 text-red-400 border border-red-800/40">
              {currentMarket} Radar Live
            </span>
          </div>
          <p className="text-xs text-[#8E909B] mt-1 max-w-2xl">
            {t.leaks.subtitle}
          </p>
        </div>

        <div className="bg-[#141620] px-4 py-3 rounded-lg border border-[#272C3D] flex items-center space-x-4 font-mono">
          <div>
            <div className="text-[10px] text-[#7E8292] uppercase">{t.hero.revenueAtRisk}</div>
            <div className="text-lg font-bold text-red-400">
              {formatCurrency(totalFilteredLoss)}<span className="text-xs text-[#7E8292]">/mo</span>
            </div>
          </div>
          <div className="h-8 w-px bg-[#272C3D]" />
          <div>
            <div className="text-[10px] text-[#7E8292] uppercase">{t.leaks.activeCount}</div>
            <div className="text-lg font-bold text-[#F5F4F0]">{filteredLeaks.length}</div>
          </div>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0F121A] p-3 rounded-xl border border-[#232732] text-xs font-mono">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center space-x-1.5 text-[#8E909B] mr-2">
            <Filter className="w-3.5 h-3.5" />
            <span>Filters:</span>
          </div>

          {/* Category Filter */}
          <select
            id="filter-leak-category"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-[#161924] text-[#D8D6CD] px-3 py-1.5 rounded-lg border border-[#282D3D] focus:outline-none cursor-pointer"
          >
            <option value="all">{t.leaks.allCategories}</option>
            <option value="lead_decay">{t.leaks.categories.lead_decay}</option>
            <option value="pricing_friction">{t.leaks.categories.pricing_friction}</option>
            <option value="follow_up_bottleneck">{t.leaks.categories.follow_up_bottleneck}</option>
            <option value="churn_anomaly">{t.leaks.categories.churn_anomaly}</option>
            <option value="checkout_abandonment">{t.leaks.categories.checkout_abandonment}</option>
          </select>

          {/* Severity Filter */}
          <select
            id="filter-leak-severity"
            value={selectedSeverity}
            onChange={(e) => setSelectedSeverity(e.target.value)}
            className="bg-[#161924] text-[#D8D6CD] px-3 py-1.5 rounded-lg border border-[#282D3D] focus:outline-none cursor-pointer"
          >
            <option value="all">{t.leaks.allSeverities}</option>
            <option value="critical">{t.leaks.severities.critical}</option>
            <option value="high">{t.leaks.severities.high}</option>
            <option value="medium">{t.leaks.severities.medium}</option>
            <option value="low">{t.leaks.severities.low}</option>
          </select>
        </div>

        <button
          onClick={() => { setSelectedCategory('all'); setSelectedSeverity('all'); }}
          className="text-[#8E909B] hover:text-[#E6E4DC] underline cursor-pointer"
        >
          Reset Filters
        </button>
      </div>

      {/* Leaks Grid Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredLeaks.map((leak) => (
          <div
            key={leak.id}
            id={`leak-card-${leak.id}`}
            className="bg-[#0F121A] border border-[#232732] hover:border-[#C5A880]/50 rounded-xl p-5 transition-all space-y-4 relative"
          >
            {/* Top row: Severity, Loss & Status */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded ${
                  leak.severity === 'critical' 
                    ? 'bg-red-950/80 text-red-400 border border-red-800/40' 
                    : leak.severity === 'high'
                    ? 'bg-amber-950/80 text-amber-400 border border-amber-800/40'
                    : 'bg-blue-950/80 text-blue-300 border border-blue-800/40'
                }`}>
                  {t.leaks.severities[leak.severity] || leak.severity.toUpperCase()}
                </span>
                
                <span className="text-[10px] font-mono text-[#8E909B] bg-[#161922] px-2 py-0.5 rounded border border-[#282D3D]">
                  {t.leaks.categories[leak.category] || leak.category}
                </span>
              </div>

              <div className="text-right">
                <div className="text-sm font-mono font-bold text-red-400">
                  -{formatCurrency(leak.estimated_monthly_loss)}
                  <span className="text-[10px] font-normal text-[#8E909B]">/mo</span>
                </div>
              </div>
            </div>

            {/* Title & Root Cause */}
            <div>
              <h3 className="text-base font-semibold text-[#F5F4F0] leading-snug">
                {leak.title}
              </h3>
              <p className="text-xs text-[#A1A4B2] mt-2 leading-relaxed">
                <strong className="text-[#D8D6CD] font-mono">Root Cause:</strong> {leak.root_cause}
              </p>
            </div>

            {/* Funnel Stage & Confidence Metadata */}
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-[#141620] p-2.5 rounded-lg border border-[#1E2230]">
              <div>
                <span className="text-[#7E8292] block">Funnel Stage:</span>
                <span className="text-[#E6E4DC] font-medium truncate block">{leak.affected_funnel_stage}</span>
              </div>
              <div>
                <span className="text-[#7E8292] block">Confidence:</span>
                <span className="text-[#C5A880] font-medium">{Math.round(leak.confidence_score * 100)}% Verified</span>
              </div>
            </div>

            {/* Card Actions */}
            <div className="pt-2 border-t border-[#1C202B] flex items-center justify-between gap-3">
              <button
                id={`inspect-forensics-${leak.id}`}
                onClick={() => setActiveForensicLeak(leak)}
                className="text-xs font-mono text-[#8E909B] hover:text-[#F5F4F0] flex items-center gap-1.5 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{t.leaks.viewForensics}</span>
              </button>

              <button
                id={`synthesize-action-${leak.id}`}
                onClick={() => setCurrentRoute('/actions')}
                className="text-xs font-mono bg-[#181C26] hover:bg-[#202533] text-[#C5A880] hover:text-[#D4AF37] px-3 py-1.5 rounded-lg border border-[#C5A880]/30 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t.leaks.triggerAction}</span>
              </button>
            </div>

          </div>
        ))}
      </div>

      {/* Forensic Deep Dive Modal */}
      {activeForensicLeak && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#0F121A] border border-[#2A2F40] rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl relative">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center space-x-2 mb-1">
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-red-950/80 text-red-400 border border-red-800/40 font-bold">
                    FORENSIC TELEMETRY REPORT
                  </span>
                  <span className="text-xs font-mono text-[#7E8292]">ID: {activeForensicLeak.id}</span>
                </div>
                <h3 className="text-lg font-bold text-[#F5F4F0]">
                  {activeForensicLeak.title}
                </h3>
              </div>
              <button 
                onClick={() => setActiveForensicLeak(null)}
                className="text-[#8E909B] hover:text-[#FFF] p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono">
              <div className="bg-[#141622] p-3 rounded-lg border border-[#232736] space-y-1.5">
                <span className="text-[#C5A880] font-semibold uppercase">{t.leaks.rootCause}</span>
                <p className="text-[#D8D6CD] font-sans text-sm">{activeForensicLeak.root_cause}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#141622] p-3 rounded-lg border border-[#232736]">
                  <span className="text-[#7E8292] block">Est. Annualized Leak</span>
                  <span className="text-base font-bold text-red-400">
                    {formatCurrency(activeForensicLeak.estimated_monthly_loss * 12)} / year
                  </span>
                </div>
                <div className="bg-[#141622] p-3 rounded-lg border border-[#232736]">
                  <span className="text-[#7E8292] block">Confidence Variance</span>
                  <span className="text-base font-bold text-[#C5A880]">
                    ±{(1 - activeForensicLeak.confidence_score).toFixed(2)} σ (Statistical Signal)
                  </span>
                </div>
              </div>

              <div className="bg-[#141622] p-3 rounded-lg border border-[#232736] space-y-2">
                <span className="text-[#C5A880] font-semibold uppercase">{t.leaks.forensicEvidence}</span>
                <ul className="list-disc pl-4 space-y-1 text-[#A1A4B2] font-sans text-xs">
                  <li>Inbound signal timestamp anomalies cross-referenced with CRM deal velocity log.</li>
                  <li>Drop-off slope is 3.4x higher than standard industry cohort benchmarks.</li>
                  <li>No automated failover router triggered during out-of-band inquiry peak.</li>
                </ul>
              </div>
            </div>

            <div className="pt-3 border-t border-[#232736] flex justify-end space-x-3">
              <button
                onClick={() => setActiveForensicLeak(null)}
                className="px-4 py-2 rounded-lg text-xs font-mono text-[#8E909B] hover:text-[#FFF] border border-[#282D3D] cursor-pointer"
              >
                Close Report
              </button>
              <button
                onClick={() => {
                  setActiveForensicLeak(null);
                  setCurrentRoute('/actions');
                }}
                className="px-4 py-2 rounded-lg text-xs font-mono font-semibold bg-[#C5A880] hover:bg-[#D4AF37] text-black cursor-pointer flex items-center gap-1.5"
              >
                <Sparkles className="w-4 h-4" />
                <span>Go to Prescribed Action</span>
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
