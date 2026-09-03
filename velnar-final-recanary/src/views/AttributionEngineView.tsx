import React, { useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { CustomerJourney, AttributionResult } from '../types/attribution';
import { 
  GitMerge, 
  ShieldCheck, 
  ArrowRight, 
  Sparkles, 
  CheckCircle2, 
  Clock, 
  CreditCard, 
  PhoneCall, 
  Globe, 
  MapPin, 
  Info,
  Calendar,
  Layers,
  ChevronDown
} from 'lucide-react';

export const AttributionEngineView: React.FC = () => {
  const { 
    customerJourneys, 
    attributionResults, 
    activeTemplate, 
    formatCurrency, 
    t 
  } = usePlatform();

  const [selectedJourney, setSelectedJourney] = useState<CustomerJourney | null>(null);
  const [lookbackDays, setLookbackDays] = useState<number>(30);

  const totalAttributed = attributionResults
    .filter(r => r.confidenceGrade === 'HIGH')
    .reduce((sum, r) => sum + (r.attributedAmountMinor / 100), 0);

  const totalInfluenced = attributionResults
    .filter(r => r.confidenceGrade !== 'HIGH')
    .reduce((sum, r) => sum + (r.attributedAmountMinor / 100), 0);

  const getChannelIcon = (type: string) => {
    switch (type) {
      case 'ad_click':
        return <Globe className="w-3.5 h-3.5 text-blue-500" />;
      case 'phone_call':
        return <PhoneCall className="w-3.5 h-3.5 text-sky-500" />;
      case 'appointment_booking':
        return <Calendar className="w-3.5 h-3.5 text-purple-500" />;
      case 'physical_checkin':
        return <MapPin className="w-3.5 h-3.5 text-amber-500" />;
      case 'pos_transaction':
        return <CreditCard className="w-3.5 h-3.5 text-emerald-500" />;
      default:
        return <Layers className="w-3.5 h-3.5 text-theme-accent" />;
    }
  };

  const getConfidenceBadge = (grade: 'HIGH' | 'MEDIUM' | 'LOW') => {
    switch (grade) {
      case 'HIGH':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-semibold flex items-center gap-1"><ShieldCheck className="w-2.5 h-2.5" /> HIGH (Token Match)</span>;
      case 'MEDIUM':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold">MEDIUM (Temporal)</span>;
      case 'LOW':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-theme-surface-elevated text-theme-muted border border-theme-border font-semibold">LOW (Proximity)</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-theme-surface p-5 rounded-xl border border-theme-border">
        <div>
          <div className="flex items-center space-x-2 text-[10px] font-mono tracking-widest text-theme-accent uppercase">
            <GitMerge className="w-3.5 h-3.5" />
            <span>ONLINE → OFFLINE ATTRIBUTION TELEMETRY</span>
          </div>
          <h1 className="text-xl font-medium text-theme-primary mt-1">
            {t.attribution.title}
          </h1>
          <p className="text-xs text-theme-secondary mt-1 max-w-2xl">
            {t.attribution.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-theme-surface-elevated px-3.5 py-2.5 rounded-lg border border-theme-border flex items-center gap-2 text-xs font-mono text-theme-secondary">
            <Clock className="w-3.5 h-3.5" />
            <span>Lookback:</span>
            <select
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Number(e.target.value))}
              className="bg-theme-surface text-theme-primary px-2 py-1 rounded border border-theme-border focus:outline-none"
            >
              <option value={7}>7 Days</option>
              <option value={14}>14 Days</option>
              <option value={30}>30 Days</option>
              <option value={90}>90 Days</option>
            </select>
          </div>
        </div>
      </div>

      {/* Attribution Principle Card */}
      <div className="bg-theme-surface p-3.5 rounded-xl border border-theme-accent/30 bg-gradient-to-r from-theme-accent/5 to-transparent flex items-start space-x-3">
        <Info className="w-4 h-4 text-theme-accent shrink-0 mt-0.5" />
        <p className="text-xs text-theme-secondary leading-relaxed">
          <strong className="text-theme-accent">Attribution Truth Guard:</strong> {t.attribution.noFalseClaimsNotice}
        </p>
      </div>

      {/* Metrics Row: Attributed vs Influenced */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Directly Attributed Revenue */}
        <div className="bg-theme-surface p-5 rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-theme-surface space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-semibold uppercase">
              {t.attribution.attributedRevenue}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
              Deterministic Verification
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-theme-primary">
            {formatCurrency(totalAttributed)}
          </div>
          <p className="text-[11px] text-theme-secondary">
            Tied directly to cryptographic booking tokens, click IDs, and verified POS order IDs.
          </p>
        </div>

        {/* Influenced Revenue */}
        <div className="bg-theme-surface p-5 rounded-xl border border-theme-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-theme-accent font-semibold uppercase">
              {t.attribution.influencedRevenue}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-theme-surface-elevated text-theme-accent border border-theme-border">
              Proximity & Temporal Evidence
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-theme-primary">
            {formatCurrency(totalInfluenced)}
          </div>
          <p className="text-[11px] text-theme-secondary">
            Signals observed within 72h lookback window without 1:1 token matching.
          </p>
        </div>
      </div>

      {/* Multi-Touch Customer Journey Table & Flow */}
      <div className="bg-theme-surface rounded-xl border border-theme-border overflow-hidden">
        <div className="p-4 border-b border-theme-border bg-theme-surface-elevated flex items-center justify-between">
          <h3 className="text-sm font-medium text-theme-primary">
            {t.attribution.journeyLedger}
          </h3>
          <span className="text-xs font-mono text-theme-muted">
            {customerJourneys.length} Active Cross-Channel Journeys
          </span>
        </div>

        <div className="divide-y divide-theme-border">
          {customerJourneys.map((journey) => (
            <div key={journey.journeyId} className="p-4.5 hover:bg-theme-surface-elevated/50 transition-colors space-y-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-theme-surface-elevated flex items-center justify-center text-xs font-mono text-theme-accent border border-theme-border">
                    {journey.customerPseudonymId.slice(-3)}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-theme-primary flex items-center gap-2">
                      <span>Customer Pseudonym: {journey.customerPseudonymId}</span>
                      <span className="text-[10px] font-mono text-theme-muted">({journey.touchpoints.length} Touchpoints)</span>
                    </div>
                    <div className="text-[11px] text-theme-muted font-mono mt-0.5">
                      Converted at: {new Date(journey.conversionTimestamp).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <div className="text-right">
                    <div className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      +{formatCurrency(journey.convertedValueMinor / 100)}
                    </div>
                    <div className="text-[10px] text-theme-muted font-mono">
                      POS Transaction Verified
                    </div>
                  </div>
                  {getConfidenceBadge(journey.confidenceGrade)}
                </div>
              </div>

              {/* Touchpoint Chain Visualization */}
              <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border overflow-x-auto">
                <div className="flex items-center space-x-2 min-w-max">
                  {journey.touchpoints.map((tp, idx) => (
                    <React.Fragment key={tp.id}>
                      <div className="bg-theme-surface p-2 rounded-lg border border-theme-border text-left space-y-0.5">
                        <div className="flex items-center space-x-1.5 text-[10px] font-mono text-theme-accent">
                          {getChannelIcon(tp.type)}
                          <span className="font-semibold uppercase">{tp.channel}</span>
                        </div>
                        <div className="text-[11px] text-theme-primary max-w-[160px] truncate">
                          {tp.metadata.campaignName || tp.metadata.service || tp.metadata.direction || tp.type}
                        </div>
                        <div className="text-[9px] font-mono text-theme-muted">
                          {new Date(tp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>

                      {idx < journey.touchpoints.length - 1 && (
                        <ArrowRight className="w-3 h-3 text-theme-muted shrink-0" />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Evidence Attribution Details */}
              <div className="text-[11px] text-theme-secondary font-mono flex items-center justify-between pt-1">
                <span>Attribution Model: <strong>Position-Based (40/20/40) Multi-Touch</strong></span>
                <span className="text-theme-accent">Evidence: {journey.evidenceChain.join(' → ')}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
