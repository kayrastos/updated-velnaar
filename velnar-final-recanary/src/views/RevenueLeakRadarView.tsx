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
    if (l.status !== 'active' || l.isDataInsufficient || l.confidenceLevel === 'INSUFFICIENT' || l.estimatedImpactMinor === null) return sum;
    return sum + ((l.estimatedImpactMinor || 0) / 100);
  }, 0);

  const getSourceIcon = (source: string) => {
    const s = source.toLowerCase();
    if (s.includes('call') || s.includes('phone')) return <PhoneCall className="w-3 h-3 text-sky-500" />;
    if (s.includes('calendar') || s.includes('appointment')) return <Calendar className="w-3 h-3 text-purple-500" />;
    if (s.includes('pos') || s.includes('payment') || s.includes('cogs')) return <CreditCard className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />;
    return <Inbox className="w-3 h-3 text-theme-accent" />;
  };

  const getConfidenceBadge = (confidence: string, isInsufficient?: boolean) => {
    if (isInsufficient || confidence === 'INSUFFICIENT') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold flex items-center gap-1">
          <HelpCircle className="w-3 h-3" />
          <span>INSUFFICIENT DATA</span>
        </span>
      );
    }
    switch (confidence) {
      case 'HIGH':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-semibold">CONFIDENCE: HIGH (Deterministic)</span>;
      case 'MEDIUM':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold">CONFIDENCE: MEDIUM</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-theme-surface-elevated text-theme-secondary border border-theme-border font-semibold">CONFIDENCE: LOW (Model Estimate)</span>;
    }
  };

  return (
    <div id="revenue-leak-radar-view" className="space-y-6">
      
      {/* Header & Overview */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-theme-surface p-5 rounded-xl border border-theme-border">
        <div>
          <div className="flex items-center space-x-2.5">
            <Radar className="w-5 h-5 text-red-500" />
            <h1 className="text-xl font-editorial font-bold text-theme-primary tracking-wide">
              {t.leaks.title}
            </h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-500/15 text-red-500 border border-red-500/30">
              Deterministic 8-Rule Engine Live
            </span>
          </div>
          <p className="text-xs text-theme-secondary mt-1 max-w-2xl">
            {t.leaks.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-theme-surface-elevated px-4 py-3 rounded-lg border border-theme-border flex items-center space-x-4 font-mono">
            <div>
              <div className="text-[10px] text-theme-muted uppercase">{t.hero.revenueAtRisk}</div>
              <div className="text-lg font-bold text-red-500">
                {formatCurrency(totalRevenueAtRisk)}<span className="text-xs text-theme-muted">/mo</span>
              </div>
            </div>
            <div className="h-8 w-px bg-theme-border" />
            <div>
              <div className="text-[10px] text-theme-muted uppercase">{t.leaks.activeCount}</div>
              <div className="text-lg font-bold text-theme-primary">{filteredLeaks.length}</div>
            </div>
          </div>

          <button
            onClick={() => runLeakScan()}
            disabled={isScanning}
            className="flex items-center space-x-2 px-3.5 py-3 rounded-lg bg-theme-surface-elevated hover:bg-theme-surface-muted text-theme-accent border border-theme-border font-mono text-xs cursor-pointer transition-all disabled:opacity-50"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'Scanning...' : 'Rescan Radar'}</span>
          </button>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-theme-surface p-3 rounded-xl border border-theme-border text-xs font-mono">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-1.5 text-theme-muted">
            <Filter className="w-3.5 h-3.5" />
            <span>Filter Radar:</span>
          </div>

          {/* Status Filter */}
          <div className="flex rounded-lg bg-theme-surface-elevated p-0.5 border border-theme-border">
            <button
              onClick={() => setSelectedStatus('active')}
              className={`px-3 py-1 rounded text-xs transition-colors cursor-pointer ${
                selectedStatus === 'active' ? 'bg-theme-accent text-black font-semibold' : 'text-theme-muted hover:text-theme-primary'
              }`}
            >
              Active Leaks Only
            </button>
            <button
              onClick={() => setSelectedStatus('all')}
              className={`px-3 py-1 rounded text-xs transition-colors cursor-pointer ${
                selectedStatus === 'all' ? 'bg-theme-accent text-black font-semibold' : 'text-theme-muted hover:text-theme-primary'
              }`}
            >
              All Leaks
            </button>
          </div>

          {/* Severity Filter */}
          <select
            value={selectedSeverity}
            onChange={(e) => setSelectedSeverity(e.target.value)}
            className="bg-theme-surface-elevated text-theme-primary px-3 py-1 rounded-lg border border-theme-border focus:outline-none cursor-pointer"
          >
            <option value="all">{t.leaks.allSeverities}</option>
            <option value="critical">{t.leaks.severities.critical}</option>
            <option value="high">{t.leaks.severities.high}</option>
            <option value="medium">{t.leaks.severities.medium}</option>
            <option value="low">{t.leaks.severities.low}</option>
          </select>
        </div>

        <div className="text-[11px] text-theme-muted">
          Principle: <strong className="text-theme-accent">NO EVIDENCE → NO CLAIM.</strong>
        </div>
      </div>

      {/* Leaks Grid Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredLeaks.map((leak) => {
          const isInsufficient = leak.isDataInsufficient || leak.confidenceLevel === 'INSUFFICIENT';
          const displayConfidence = leak.confidenceLevel || 'INSUFFICIENT';
          const observedList = leak.observedFacts || [];
          const sourceList = leak.dataSources?.filter(Boolean) ?? [];

          return (
            <div
              key={leak.leakId}
              id={`leak-card-${leak.leakId}`}
              className="bg-theme-surface border border-theme-border hover:border-theme-accent/50 rounded-xl p-5 transition-all space-y-4 relative flex flex-col justify-between shadow-xs"
            >
              <div>
                {/* Top row: Severity, Loss & Confidence */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center space-x-2">
                    <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded ${
                      leak.severity === 'critical' 
                        ? 'bg-red-500/15 text-red-500 border border-red-500/30' 
                        : leak.severity === 'high'
                        ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                        : 'bg-blue-500/15 text-blue-500 border border-blue-500/30'
                    }`}>
                      {t.leaks.severities[leak.severity] || leak.severity.toUpperCase()}
                    </span>
                    
                    {getConfidenceBadge(displayConfidence, isInsufficient)}
                  </div>

                  <div className="text-right">
                    {isInsufficient || leak.estimatedImpactMinor === null ? (
                      <div className="text-xs font-mono font-bold text-amber-500">
                        INSUFFICIENT DATA
                      </div>
                    ) : (
                      <div className="text-sm font-mono font-bold text-red-500">
                        -{formatCurrency(leak.estimatedImpactMinor / 100)}
                        <span className="text-[10px] font-normal text-theme-muted">/mo</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Title */}
                <h3 className="text-base font-semibold text-theme-primary leading-snug">
                  {leak.title}
                </h3>

                {/* Insufficient Data Explanation Banner */}
                {isInsufficient && leak.insufficientDataReason && (
                  <div className="mt-2.5 p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-300 text-xs font-mono flex items-start gap-2">
                    <HelpCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                    <div>
                      <strong className="block text-[11px] uppercase">Revenue Estimate Suspended:</strong>
                      <span className="text-[11px] font-sans text-theme-secondary">{leak.insufficientDataReason}</span>
                    </div>
                  </div>
                )}

                {/* Explicit Tripartite Evidence Box: OBSERVED vs CALCULATED */}
                <div className="mt-3.5 space-y-2 text-[11px] font-mono bg-theme-surface-elevated p-3 rounded-lg border border-theme-border">
                  {/* 1. Observed Facts */}
                  <div>
                    <div className="text-theme-accent text-[10px] font-semibold flex items-center gap-1.5 uppercase mb-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-theme-accent"></span>
                      <span>1. Observed Evidence (Deterministic Facts):</span>
                    </div>
                    <ul className="space-y-1 text-theme-primary font-sans pl-3 text-xs">
                      {observedList.map((factStr, i) => (
                        <li key={i} className="list-disc leading-tight">
                          {factStr}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* 2. Calculation Formula & Metric Components */}
                  <div className="pt-2 border-t border-theme-border">
                    <div className="text-theme-muted text-[10px] uppercase font-semibold flex items-center gap-1 mb-0.5">
                      <Calculator className="w-3 h-3 text-theme-muted" />
                      <span>2. Mathematical Formula & Provenance:</span>
                    </div>
                    <div className="text-theme-secondary font-mono text-[10px] bg-theme-surface p-1.5 rounded border border-theme-border">
                      {leak.calculationFormula}
                    </div>

                    {/* Metric Components Chips */}
                    {leak.calculatedMetrics && leak.calculatedMetrics.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {leak.calculatedMetrics.map((m, mIdx) => (
                          <span 
                            key={mIdx} 
                            className="text-[9px] px-1.5 py-0.5 rounded bg-theme-surface text-theme-secondary border border-theme-border"
                            title={m.provenance ? `Source: ${m.provenance.source} (${m.provenance.sampleSize || 'N/A'} samples)` : m.sourceDataSource}
                          >
                            <span className="text-theme-muted">{m.label}:</span> <strong>{m.valueString}</strong>
                            <span className="ml-1 text-[8px] text-theme-accent uppercase">[{m.classification}]</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 3. Connected Source Systems */}
                  <div className="pt-2 border-t border-theme-border flex items-center justify-between">
                    <span className="text-[10px] text-theme-muted uppercase">Source Systems:</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {sourceList.length > 0 ? (
                        sourceList.map((sys, idx) => (
                          <span key={idx} className="flex items-center gap-1 text-[10px] text-theme-secondary bg-theme-surface px-1.5 py-0.5 rounded border border-theme-border">
                            {getSourceIcon(sys)}
                            <span>{sys}</span>
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-theme-muted italic">
                          Evidence source unavailable
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="pt-3 border-t border-theme-border flex items-center justify-between gap-3 mt-4">
                <button
                  id={`inspect-forensics-${leak.leakId}`}
                  onClick={() => setActiveForensicLeak(leak)}
                  className="text-xs font-mono text-theme-secondary hover:text-theme-primary flex items-center gap-1.5 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Inspect Evidence</span>
                </button>

                <button
                  id={`synthesize-action-${leak.leakId}`}
                  onClick={() => setCurrentRoute('/actions')}
                  className="text-xs font-mono bg-theme-surface-elevated hover:bg-theme-surface-muted text-theme-accent px-3 py-1.5 rounded-lg border border-theme-border transition-all flex items-center gap-1.5 cursor-pointer"
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
          <div className="bg-theme-surface border border-theme-border rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl relative">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center space-x-2 mb-1">
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-red-500/15 text-red-500 border border-red-500/30 font-bold">
                    REVENUE LEAK AUDIT RECORD
                  </span>
                  <span className="text-xs font-mono text-theme-muted">RULE: {activeForensicLeak.ruleId}</span>
                </div>
                <h3 className="text-lg font-bold text-theme-primary">
                  {activeForensicLeak.title}
                </h3>
              </div>
              <button 
                onClick={() => setActiveForensicLeak(null)}
                className="text-theme-muted hover:text-theme-primary p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono">
              <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border space-y-1.5">
                <span className="text-theme-accent font-semibold uppercase">Recommended Next Action</span>
                <p className="text-theme-primary font-sans text-sm font-medium">{activeForensicLeak.recommendedAction?.headline || 'Review and dispatch targeted growth action.'}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border">
                  <span className="text-theme-muted block">Est. Annualized Leak</span>
                  <span className="text-base font-bold text-red-500">
                    {activeForensicLeak.isDataInsufficient || activeForensicLeak.estimatedImpactMinor === null
                      ? 'INSUFFICIENT DATA'
                      : `${formatCurrency((activeForensicLeak.estimatedImpactMinor / 100) * 12)} / year`}
                  </span>
                </div>
                <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border">
                  <span className="text-theme-muted block">Confidence Level</span>
                  <span className="text-base font-bold text-theme-accent">
                    {activeForensicLeak.confidenceLevel || 'INSUFFICIENT'}
                  </span>
                </div>
              </div>

              <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border space-y-2">
                <span className="text-theme-accent font-semibold uppercase">Forensic Evidence Chain</span>
                <ul className="list-disc pl-4 space-y-1 text-theme-secondary font-sans text-xs">
                  {activeForensicLeak.observedFacts.map((factStr, i) => (
                    <li key={i}>
                      {factStr}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border space-y-1">
                <span className="text-theme-muted font-semibold uppercase text-[10px]">Mathematical Formula</span>
                <p className="text-xs text-theme-accent font-mono">{activeForensicLeak.calculationFormula}</p>
              </div>
            </div>

            <div className="pt-3 border-t border-theme-border flex justify-end space-x-3">
              <button
                onClick={() => setActiveForensicLeak(null)}
                className="px-4 py-2 rounded-lg text-xs font-mono text-theme-secondary hover:text-theme-primary border border-theme-border cursor-pointer"
              >
                Close Record
              </button>
              <button
                onClick={() => {
                  setActiveForensicLeak(null);
                  setCurrentRoute('/actions');
                }}
                className="px-4 py-2 rounded-lg text-xs font-mono font-semibold bg-theme-accent hover:bg-theme-accent/90 text-black cursor-pointer flex items-center gap-1.5 shadow-xs"
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
