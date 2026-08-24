import React, { useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { RevenueImpactCalculation } from '../types/leakEngine';
import { 
  Radar, 
  Sparkles, 
  Filter, 
  FileText, 
  X,
  Calculator,
  PhoneCall,
  Calendar,
  CreditCard,
  Inbox,
  ArrowRight,
  HelpCircle
} from 'lucide-react';

export const RevenueLeakRadarView: React.FC = () => {
  const { 
    calculatedLeaks, 
    formatCurrency, 
    setCurrentRoute, 
    isScanning,
    runLeakScan,
    t 
  } = usePlatform();
  
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('active');
  const [activeForensicLeak, setActiveForensicLeak] = useState<RevenueImpactCalculation | null>(null);

  const filteredLeaks = calculatedLeaks.filter(leak => {
    if (selectedSeverity !== 'all' && leak.severity !== selectedSeverity) return false;
    if (selectedStatus !== 'all' && leak.status !== selectedStatus) return false;
    return true;
  });

  const totalRevenueAtRisk = filteredLeaks.reduce((sum, l) => {
    if (l.status !== 'active' || l.isDataInsufficient || l.confidenceLevel === 'INSUFFICIENT') return sum;
    return sum + (l.estimatedImpactMinor / 100);
  }, 0);

  const getSourceIcon = (source: string) => {
    const s = source.toLowerCase();
    if (s.includes('call') || s.includes('phone')) return <PhoneCall className="w-3 h-3 text-sky-400" />;
    if (s.includes('calendar') || s.includes('appointment')) return <Calendar className="w-3 h-3 text-purple-400" />;
    if (s.includes('pos') || s.includes('payment') || s.includes('cogs')) return <CreditCard className="w-3 h-3 text-emerald-400" />;
    return <Inbox className="w-3 h-3 text-[#C5A880]" />;
  };

  const getConfidenceBadge = (confidence: string, isInsufficient?: boolean) => {
    if (isInsufficient || confidence === 'INSUFFICIENT') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-amber-300 border border-amber-800/40 font-semibold flex items-center gap-1">
          <HelpCircle className="w-3 h-3" />
          <span>INSUFFICIENT DATA</span>
        </span>
      );
    }
    switch (confidence) {
      case 'HIGH':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800/40 font-semibold">CONFIDENCE: HIGH (Deterministic)</span>;
      case 'MEDIUM':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950/80 text-amber-400 border border-amber-800/40 font-semibold">CONFIDENCE: MEDIUM</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300 font-semibold">CONFIDENCE: LOW (Model Estimate)</span>;
    }
  };

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
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-950/60 text-red-400 border border-red-800/40">
              Deterministic 8-Rule Engine Live
            </span>
          </div>
          <p className="text-xs text-[#8E909B] mt-1 max-w-2xl">
            {t.leaks.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-[#141620] px-4 py-3 rounded-lg border border-[#272C3D] flex items-center space-x-4 font-mono">
            <div>
              <div className="text-[10px] text-[#7E8292] uppercase">{t.hero.revenueAtRisk}</div>
              <div className="text-lg font-bold text-red-400">
                {formatCurrency(totalRevenueAtRisk)}<span className="text-xs text-[#7E8292]">/mo</span>
              </div>
            </div>
            <div className="h-8 w-px bg-[#272C3D]" />
            <div>
              <div className="text-[10px] text-[#7E8292] uppercase">{t.leaks.activeCount}</div>
              <div className="text-lg font-bold text-[#F5F4F0]">{filteredLeaks.length}</div>
            </div>
          </div>

          <button
            onClick={() => runLeakScan()}
            disabled={isScanning}
            className="flex items-center space-x-2 px-3.5 py-3 rounded-lg bg-[#181C26] hover:bg-[#202533] text-[#C5A880] border border-[#C5A880]/30 font-mono text-xs cursor-pointer transition-all disabled:opacity-50"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'Scanning...' : 'Rescan Radar'}</span>
          </button>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0F121A] p-3 rounded-xl border border-[#232732] text-xs font-mono">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-1.5 text-[#8E909B]">
            <Filter className="w-3.5 h-3.5" />
            <span>Filter Radar:</span>
          </div>

          {/* Status Filter */}
          <div className="flex rounded-lg bg-[#161924] p-0.5 border border-[#282D3D]">
            <button
              onClick={() => setSelectedStatus('active')}
              className={`px-3 py-1 rounded text-xs transition-colors cursor-pointer ${
                selectedStatus === 'active' ? 'bg-[#C5A880] text-black font-semibold' : 'text-[#8E909B] hover:text-[#E6E4DC]'
              }`}
            >
              Active Leaks Only
            </button>
            <button
              onClick={() => setSelectedStatus('all')}
              className={`px-3 py-1 rounded text-xs transition-colors cursor-pointer ${
                selectedStatus === 'all' ? 'bg-[#C5A880] text-black font-semibold' : 'text-[#8E909B] hover:text-[#E6E4DC]'
              }`}
            >
              All Leaks
            </button>
          </div>

          {/* Severity Filter */}
          <select
            value={selectedSeverity}
            onChange={(e) => setSelectedSeverity(e.target.value)}
            className="bg-[#161924] text-[#D8D6CD] px-3 py-1 rounded-lg border border-[#282D3D] focus:outline-none cursor-pointer"
          >
            <option value="all">{t.leaks.allSeverities}</option>
            <option value="critical">{t.leaks.severities.critical}</option>
            <option value="high">{t.leaks.severities.high}</option>
            <option value="medium">{t.leaks.severities.medium}</option>
            <option value="low">{t.leaks.severities.low}</option>
          </select>
        </div>

        <div className="text-[11px] text-[#717482]">
          Principle: <strong className="text-[#C5A880]">NO EVIDENCE → NO CLAIM.</strong>
        </div>
      </div>

      {/* Leaks Grid Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredLeaks.map((leak) => {
          const isInsufficient = leak.isDataInsufficient || leak.confidenceLevel === 'INSUFFICIENT';
          const displayConfidence = leak.confidenceLevel || 'HIGH';
          const observedList = leak.observedFacts || [];
          const sourceList = leak.dataSources || ['Pipeline Ledger'];

          return (
            <div
              key={leak.leakId}
              id={`leak-card-${leak.leakId}`}
              className="bg-[#0F121A] border border-[#232732] hover:border-[#C5A880]/50 rounded-xl p-5 transition-all space-y-4 relative flex flex-col justify-between"
            >
              <div>
                {/* Top row: Severity, Loss & Confidence */}
                <div className="flex items-center justify-between gap-2 mb-3">
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
                    
                    {getConfidenceBadge(displayConfidence, isInsufficient)}
                  </div>

                  <div className="text-right">
                    {isInsufficient ? (
                      <div className="text-xs font-mono font-bold text-amber-400">
                        INSUFFICIENT DATA
                      </div>
                    ) : (
                      <div className="text-sm font-mono font-bold text-red-400">
                        -{formatCurrency(leak.estimatedImpactMinor / 100)}
                        <span className="text-[10px] font-normal text-[#8E909B]">/mo</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Title */}
                <h3 className="text-base font-semibold text-[#F5F4F0] leading-snug">
                  {leak.title}
                </h3>

                {/* Insufficient Data Explanation Banner */}
                {isInsufficient && leak.insufficientDataReason && (
                  <div className="mt-2.5 p-2.5 rounded bg-amber-950/30 border border-amber-800/40 text-amber-300 text-xs font-mono flex items-start gap-2">
                    <HelpCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                    <div>
                      <strong className="block text-[11px] uppercase">Revenue Estimate Suspended:</strong>
                      <span className="text-[11px] font-sans text-amber-200/90">{leak.insufficientDataReason}</span>
                    </div>
                  </div>
                )}

                {/* Explicit Tripartite Evidence Box: OBSERVED vs CALCULATED */}
                <div className="mt-3.5 space-y-2 text-[11px] font-mono bg-[#141620] p-3 rounded-lg border border-[#1E2230]">
                  {/* 1. Observed Facts */}
                  <div>
                    <div className="text-[#C5A880] text-[10px] font-semibold flex items-center gap-1.5 uppercase mb-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#C5A880]"></span>
                      <span>1. Observed Evidence (Deterministic Facts):</span>
                    </div>
                    <ul className="space-y-1 text-[#D8D6CD] font-sans pl-3 text-xs">
                      {observedList.map((factStr, i) => (
                        <li key={i} className="list-disc leading-tight">
                          {factStr}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* 2. Calculation Formula & Metric Components */}
                  <div className="pt-2 border-t border-[#1E2230]">
                    <div className="text-[#7E8292] text-[10px] uppercase font-semibold flex items-center gap-1 mb-0.5">
                      <Calculator className="w-3 h-3 text-[#7E8292]" />
                      <span>2. Mathematical Formula & Provenance:</span>
                    </div>
                    <div className="text-[#A1A4B2] font-mono text-[10px] bg-[#0B0D13] p-1.5 rounded border border-[#1A1D27]">
                      {leak.calculationFormula}
                    </div>

                    {/* Metric Components Chips */}
                    {leak.calculatedMetrics && leak.calculatedMetrics.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {leak.calculatedMetrics.map((m, mIdx) => (
                          <span 
                            key={mIdx} 
                            className="text-[9px] px-1.5 py-0.5 rounded bg-[#1A1E2B] text-[#D8D6CD] border border-[#2B3142]"
                            title={m.provenance ? `Source: ${m.provenance.source} (${m.provenance.sampleSize || 'N/A'} samples)` : m.sourceDataSource}
                          >
                            <span className="text-[#8E909B]">{m.label}:</span> <strong>{m.valueString}</strong>
                            <span className="ml-1 text-[8px] text-[#C5A880] uppercase">[{m.classification}]</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 3. Connected Source Systems */}
                  <div className="pt-2 border-t border-[#1E2230] flex items-center justify-between">
                    <span className="text-[10px] text-[#717482] uppercase">Source Systems:</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {sourceList.map((sys, idx) => (
                        <span key={idx} className="flex items-center gap-1 text-[10px] text-[#A1A4B2] bg-[#090A0E] px-1.5 py-0.5 rounded border border-[#1C202B]">
                          {getSourceIcon(sys)}
                          <span>{sys}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="pt-3 border-t border-[#1C202B] flex items-center justify-between gap-3 mt-4">
                <button
                  id={`inspect-forensics-${leak.leakId}`}
                  onClick={() => setActiveForensicLeak(leak)}
                  className="text-xs font-mono text-[#8E909B] hover:text-[#F5F4F0] flex items-center gap-1.5 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Inspect Evidence</span>
                </button>

                <button
                  id={`synthesize-action-${leak.leakId}`}
                  onClick={() => setCurrentRoute('/actions')}
                  className="text-xs font-mono bg-[#181C26] hover:bg-[#202533] text-[#C5A880] hover:text-[#D4AF37] px-3 py-1.5 rounded-lg border border-[#C5A880]/30 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Prepare Action</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

            </div>
          );
        })}
      </div>

      {/* Forensic Deep Dive Modal */}
      {activeForensicLeak && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#0F121A] border border-[#2A2F40] rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl relative">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center space-x-2 mb-1">
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-red-950/80 text-red-400 border border-red-800/40 font-bold">
                    REVENUE LEAK AUDIT RECORD
                  </span>
                  <span className="text-xs font-mono text-[#7E8292]">RULE: {activeForensicLeak.ruleId}</span>
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
                <span className="text-[#C5A880] font-semibold uppercase">Recommended Next Action</span>
                <p className="text-[#D8D6CD] font-sans text-sm font-medium">{activeForensicLeak.recommendedAction?.headline || 'Review and dispatch targeted growth action.'}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#141622] p-3 rounded-lg border border-[#232736]">
                  <span className="text-[#7E8292] block">Est. Annualized Leak</span>
                  <span className="text-base font-bold text-red-400">
                    {activeForensicLeak.isDataInsufficient 
                      ? 'INSUFFICIENT DATA'
                      : `${formatCurrency((activeForensicLeak.estimatedImpactMinor / 100) * 12)} / year`}
                  </span>
                </div>
                <div className="bg-[#141622] p-3 rounded-lg border border-[#232736]">
                  <span className="text-[#7E8292] block">Confidence Level</span>
                  <span className="text-base font-bold text-[#C5A880]">
                    {activeForensicLeak.confidenceLevel || 'HIGH'} (Deterministic Verification)
                  </span>
                </div>
              </div>

              <div className="bg-[#141622] p-3 rounded-lg border border-[#232736] space-y-2">
                <span className="text-[#C5A880] font-semibold uppercase">Forensic Evidence Chain</span>
                <ul className="list-disc pl-4 space-y-1 text-[#A1A4B2] font-sans text-xs">
                  {activeForensicLeak.observedFacts.map((factStr, i) => (
                    <li key={i}>
                      {factStr}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-[#141622] p-3 rounded-lg border border-[#232736] space-y-1">
                <span className="text-[#7E8292] font-semibold uppercase text-[10px]">Mathematical Formula</span>
                <p className="text-xs text-[#C5A880] font-mono">{activeForensicLeak.calculationFormula}</p>
              </div>
            </div>

            <div className="pt-3 border-t border-[#232736] flex justify-end space-x-3">
              <button
                onClick={() => setActiveForensicLeak(null)}
                className="px-4 py-2 rounded-lg text-xs font-mono text-[#8E909B] hover:text-[#FFF] border border-[#282D3D] cursor-pointer"
              >
                Close Record
              </button>
              <button
                onClick={() => {
                  setActiveForensicLeak(null);
                  setCurrentRoute('/actions');
                }}
                className="px-4 py-2 rounded-lg text-xs font-mono font-semibold bg-[#C5A880] hover:bg-[#D4AF37] text-black cursor-pointer flex items-center gap-1.5"
              >
                <Sparkles className="w-4 h-4" />
                <span>Queue Prescribed Action</span>
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
