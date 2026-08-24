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
        return <Globe className="w-3.5 h-3.5 text-blue-400" />;
      case 'phone_call':
        return <PhoneCall className="w-3.5 h-3.5 text-sky-400" />;
      case 'appointment_booking':
        return <Calendar className="w-3.5 h-3.5 text-purple-400" />;
      case 'physical_checkin':
        return <MapPin className="w-3.5 h-3.5 text-amber-400" />;
      case 'pos_transaction':
        return <CreditCard className="w-3.5 h-3.5 text-emerald-400" />;
      default:
        return <Layers className="w-3.5 h-3.5 text-[#C5A880]" />;
    }
  };

  const getConfidenceBadge = (grade: 'HIGH' | 'MEDIUM' | 'LOW') => {
    switch (grade) {
      case 'HIGH':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800/40 font-semibold flex items-center gap-1"><ShieldCheck className="w-2.5 h-2.5" /> HIGH (Token Match)</span>;
      case 'MEDIUM':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950/80 text-amber-400 border border-amber-800/40 font-semibold">MEDIUM (Temporal)</span>;
      case 'LOW':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400 font-semibold">LOW (Proximity)</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0D0F15] p-5 rounded-xl border border-[#232732]">
        <div>
          <div className="flex items-center space-x-2 text-[10px] font-mono tracking-widest text-[#C5A880] uppercase">
            <GitMerge className="w-3.5 h-3.5" />
            <span>ONLINE → OFFLINE ATTRIBUTION TELEMETRY</span>
          </div>
          <h1 className="text-xl font-medium text-[#F5F4F0] mt-1">
            {t.attribution.title}
          </h1>
          <p className="text-xs text-[#8E909B] mt-1 max-w-2xl">
            {t.attribution.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-[#141620] px-3.5 py-2.5 rounded-lg border border-[#272C3D] flex items-center gap-2 text-xs font-mono text-[#8E909B]">
            <Clock className="w-3.5 h-3.5" />
            <span>Lookback:</span>
            <select
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Number(e.target.value))}
              className="bg-[#090A0D] text-[#E6E4DC] px-2 py-1 rounded border border-[#232732] focus:outline-none"
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
      <div className="bg-[#090A0D] p-3.5 rounded-xl border border-[#C5A880]/30 bg-gradient-to-r from-[#C5A880]/5 to-transparent flex items-start space-x-3">
        <Info className="w-4 h-4 text-[#C5A880] shrink-0 mt-0.5" />
        <p className="text-xs text-[#D8D6CD] leading-relaxed">
          <strong className="text-[#C5A880]">Attribution Truth Guard:</strong> {t.attribution.noFalseClaimsNotice}
        </p>
      </div>

      {/* Metrics Row: Attributed vs Influenced */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Directly Attributed Revenue */}
        <div className="bg-[#090A0D] p-5 rounded-xl border border-emerald-900/40 bg-gradient-to-br from-emerald-950/20 to-[#090A0D] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-emerald-400 font-semibold uppercase">
              {t.attribution.attributedRevenue}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/40">
              Deterministic Verification
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-[#F5F4F0]">
            {formatCurrency(totalAttributed)}
          </div>
          <p className="text-[11px] text-[#8E909B]">
            Tied directly to cryptographic booking tokens, click IDs, and verified POS order IDs.
          </p>
        </div>

        {/* Influenced Revenue */}
        <div className="bg-[#090A0D] p-5 rounded-xl border border-[#232732] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-[#C5A880] font-semibold uppercase">
              {t.attribution.influencedRevenue}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1A1813] text-[#C5A880] border border-[#C5A880]/30">
              Proximity & Temporal Evidence
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-[#F5F4F0]">
            {formatCurrency(totalInfluenced)}
          </div>
          <p className="text-[11px] text-[#8E909B]">
            Signals observed within 72h lookback window without 1:1 token matching.
          </p>
        </div>
      </div>

      {/* Multi-Touch Customer Journey Table & Flow */}
      <div className="bg-[#090A0D] rounded-xl border border-[#232732] overflow-hidden">
        <div className="p-4 border-b border-[#1E222D] bg-[#0D0F15] flex items-center justify-between">
          <h3 className="text-sm font-medium text-[#F5F4F0]">
            {t.attribution.journeyLedger}
          </h3>
          <span className="text-xs font-mono text-[#8E909B]">
            {customerJourneys.length} Active Cross-Channel Journeys
          </span>
        </div>

        <div className="divide-y divide-[#1C202B]">
          {customerJourneys.map((journey) => (
            <div key={journey.journeyId} className="p-4.5 hover:bg-[#10131A] transition-colors space-y-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-[#181C26] flex items-center justify-center text-xs font-mono text-[#C5A880] border border-[#2A2F3D]">
                    {journey.customerPseudonymId.slice(-3)}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#F5F4F0] flex items-center gap-2">
                      <span>Customer Pseudonym: {journey.customerPseudonymId}</span>
                      <span className="text-[10px] font-mono text-[#646877]">({journey.touchpoints.length} Touchpoints)</span>
                    </div>
                    <div className="text-[11px] text-[#717482] font-mono mt-0.5">
                      Converted at: {new Date(journey.conversionTimestamp).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <div className="text-right">
                    <div className="text-xs font-mono font-bold text-emerald-400">
                      +{formatCurrency(journey.convertedValueMinor / 100)}
                    </div>
                    <div className="text-[10px] text-[#717482] font-mono">
                      POS Transaction Verified
                    </div>
                  </div>
                  {getConfidenceBadge(journey.confidenceGrade)}
                </div>
              </div>

              {/* Touchpoint Chain Visualization */}
              <div className="bg-[#141620] p-3 rounded-lg border border-[#1E2230] overflow-x-auto">
                <div className="flex items-center space-x-2 min-w-max">
                  {journey.touchpoints.map((tp, idx) => (
                    <React.Fragment key={tp.id}>
                      <div className="bg-[#090A0D] p-2 rounded-lg border border-[#232732] text-left space-y-0.5">
                        <div className="flex items-center space-x-1.5 text-[10px] font-mono text-[#C5A880]">
                          {getChannelIcon(tp.type)}
                          <span className="font-semibold uppercase">{tp.channel}</span>
                        </div>
                        <div className="text-[11px] text-[#E6E4DC] max-w-[160px] truncate">
                          {tp.metadata.campaignName || tp.metadata.service || tp.metadata.direction || tp.type}
                        </div>
                        <div className="text-[9px] font-mono text-[#717482]">
                          {new Date(tp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>

                      {idx < journey.touchpoints.length - 1 && (
                        <ArrowRight className="w-3 h-3 text-[#3E4354] shrink-0" />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Evidence Attribution Details */}
              <div className="text-[11px] text-[#8E909B] font-mono flex items-center justify-between pt-1">
                <span>Attribution Model: <strong>Position-Based (40/20/40) Multi-Touch</strong></span>
                <span className="text-[#C5A880]">Evidence: {journey.evidenceChain.join(' → ')}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
