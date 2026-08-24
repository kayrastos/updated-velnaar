import React from 'react';
import { usePlatform } from '../context/PlatformContext';
import { 
  Inbox, 
  Clock, 
  AlertTriangle, 
  Zap, 
  CheckCircle2, 
  Send, 
  UserCheck, 
  Phone, 
  Mail,
  Building2
} from 'lucide-react';

export const LeadInboxView: React.FC = () => {
  const { leads, formatCurrency, triggerFastLeadResponse, currentMarket, t } = usePlatform();

  const openLeads = leads.filter(l => l.status === 'open');
  const avgLatency = Math.round(
    leads.reduce((sum, l) => sum + l.response_latency_minutes, 0) / (leads.length || 1)
  );

  return (
    <div id="lead-inbox-view" className="space-y-6">
      
      {/* Header & Overview */}
      <div className="bg-[#0D0F15] p-5 rounded-xl border border-[#232732] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <Inbox className="w-5 h-5 text-[#C5A880]" />
            <h1 className="text-xl font-editorial font-bold text-[#F5F4F0] tracking-wide">
              {t.leads.title}
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#181C26] text-[#C5A880] border border-[#C5A880]/30 font-medium">
              {currentMarket} Ingestion Stream
            </span>
          </div>
          <p className="text-xs text-[#8E909B] mt-1 max-w-2xl">
            {t.leads.subtitle}
          </p>
        </div>

        <div className="flex items-center space-x-4 bg-[#12151F] px-4 py-2.5 rounded-lg border border-[#232736] font-mono text-xs">
          <div>
            <div className="text-[10px] text-[#7E8292] uppercase">{t.leads.avgLatency}</div>
            <div className={`text-base font-bold ${avgLatency > 30 ? 'text-red-400' : 'text-emerald-400'}`}>
              {avgLatency} min
            </div>
          </div>
          <div className="h-7 w-px bg-[#232736]" />
          <div>
            <div className="text-[10px] text-[#7E8292] uppercase">{t.leads.highIntentQueue}</div>
            <div className="text-base font-bold text-[#F5F4F0]">{openLeads.length} Leads</div>
          </div>
        </div>
      </div>

      {/* SLA Risk Banner */}
      <div className="bg-red-950/40 border border-red-800/40 p-4 rounded-xl flex items-center space-x-3 text-xs font-mono text-red-300">
        <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
        <div>
          <span className="font-semibold block">{t.leads.slaWarning}</span>
          <p className="text-[11px] text-red-400/80 font-sans mt-0.5">
            Decay leaks accelerate past the 15-minute window. VELNAR fast-tracks unassigned tier-1 inquiries.
          </p>
        </div>
      </div>

      {/* Lead Velocity Priority Table */}
      <div className="bg-[#0F121A] rounded-xl border border-[#232732] overflow-hidden">
        <div className="p-4 border-b border-[#232732] flex items-center justify-between">
          <h2 className="text-xs font-mono uppercase tracking-wider font-semibold text-[#E6E4DC]">
            High-Intent Inbound Queue ({leads.length})
          </h2>
          <span className="text-[10px] font-mono text-[#717585]">
            Market: {currentMarket}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#121520] text-[#7E8292] uppercase text-[10px] border-b border-[#1F2433]">
              <tr>
                <th className="px-4 py-3">Contact & Company</th>
                <th className="px-4 py-3">Intent Score</th>
                <th className="px-4 py-3">Deal Value</th>
                <th className="px-4 py-3">Response Latency</th>
                <th className="px-4 py-3">Risk Factor</th>
                <th className="px-4 py-3">Funnel Stage</th>
                <th className="px-4 py-3 text-right">SLA Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1C202B]">
              {leads.map((lead) => {
                const isDecaying = lead.response_latency_minutes > 30 && lead.status === 'open';

                return (
                  <tr key={lead.id} className="hover:bg-[#151824] transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-[#F5F4F0] flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-[#C5A880]" />
                        {lead.company_name}
                      </div>
                      <div className="text-[11px] text-[#8E909B] font-sans mt-0.5">
                        {lead.contact_name} · {lead.email}
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className={`px-2 py-0.5 rounded font-bold ${
                        lead.intent_score >= 90 
                          ? 'bg-[#C5A880]/20 text-[#D4AF37] border border-[#C5A880]/40' 
                          : 'bg-[#181C26] text-[#D8D6CD]'
                      }`}>
                        {lead.intent_score} / 100
                      </span>
                    </td>

                    <td className="px-4 py-3.5 text-[#F5F4F0] font-bold">
                      {formatCurrency(lead.estimated_deal_value)}
                    </td>

                    <td className="px-4 py-3.5">
                      <div className={`flex items-center space-x-1.5 ${isDecaying ? 'text-red-400 font-bold' : 'text-emerald-400'}`}>
                        <Clock className="w-3.5 h-3.5" />
                        <span>{lead.response_latency_minutes}m</span>
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] ${
                        lead.leak_risk_factor === 'high_decay'
                          ? 'bg-red-950/80 text-red-400 border border-red-800/40'
                          : lead.leak_risk_factor === 'unassigned'
                          ? 'bg-amber-950/80 text-amber-400 border border-amber-800/40'
                          : 'bg-zinc-800 text-zinc-300'
                      }`}>
                        {lead.leak_risk_factor.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 text-[#8E909B] capitalize">
                      {lead.funnel_stage.replace(/_/g, ' ')}
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      {lead.status === 'open' ? (
                        <button
                          id={`lead-dispatch-fast-action-${lead.id}`}
                          onClick={() => triggerFastLeadResponse(lead.id)}
                          className="px-3 py-1.5 rounded bg-[#C5A880] hover:bg-[#D4AF37] text-black font-semibold text-xs transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>{t.leads.triggerFastResponse}</span>
                        </button>
                      ) : (
                        <span className="text-emerald-400 text-[11px] inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Fast Response Engaged
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
