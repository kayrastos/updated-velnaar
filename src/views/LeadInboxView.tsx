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
      <div className="bg-theme-surface p-5 rounded-xl border border-theme-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <Inbox className="w-5 h-5 text-theme-accent" />
            <h1 className="text-xl font-editorial font-bold text-theme-primary tracking-wide">
              {t.leads.title}
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-theme-surface-elevated text-theme-accent border border-theme-border font-medium">
              {currentMarket} Ingestion Stream
            </span>
          </div>
          <p className="text-xs text-theme-secondary mt-1 max-w-2xl">
            {t.leads.subtitle}
          </p>
        </div>

        <div className="flex items-center space-x-4 bg-theme-surface-elevated px-4 py-2.5 rounded-lg border border-theme-border font-mono text-xs">
          <div>
            <div className="text-[10px] text-theme-muted uppercase">{t.leads.avgLatency}</div>
            <div className={`text-base font-bold ${avgLatency > 30 ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {avgLatency} min
            </div>
          </div>
          <div className="h-7 w-px bg-theme-border" />
          <div>
            <div className="text-[10px] text-theme-muted uppercase">{t.leads.highIntentQueue}</div>
            <div className="text-base font-bold text-theme-primary">{openLeads.length} Leads</div>
          </div>
        </div>
      </div>

      {/* SLA Risk Banner */}
      <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl flex items-center space-x-3 text-xs font-mono text-red-600 dark:text-red-300">
        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
        <div>
          <span className="font-semibold block">{t.leads.slaWarning}</span>
          <p className="text-[11px] text-red-600/80 dark:text-red-300/80 font-sans mt-0.5">
            Decay leaks accelerate past the 15-minute window. VELNAR fast-tracks unassigned tier-1 inquiries.
          </p>
        </div>
      </div>

      {/* Lead Velocity Priority Table */}
      <div className="bg-theme-surface rounded-xl border border-theme-border overflow-hidden">
        <div className="p-4 border-b border-theme-border flex items-center justify-between">
          <h2 className="text-xs font-mono uppercase tracking-wider font-semibold text-theme-primary">
            High-Intent Inbound Queue ({leads.length})
          </h2>
          <span className="text-[10px] font-mono text-theme-muted">
            Market: {currentMarket}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-theme-surface-elevated text-theme-muted uppercase text-[10px] border-b border-theme-border">
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
            <tbody className="divide-y divide-theme-border">
              {leads.map((lead) => {
                const isDecaying = lead.response_latency_minutes > 30 && lead.status === 'open';

                return (
                  <tr key={lead.id} className="hover:bg-theme-surface-elevated/50 transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-theme-primary flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-theme-accent" />
                        {lead.company_name}
                      </div>
                      <div className="text-[11px] text-theme-secondary font-mono mt-0.5 flex items-center gap-1">
                        <span className="text-[10px] text-theme-accent bg-theme-surface-elevated px-1.5 py-0.2 rounded border border-theme-border">VAULT</span>
                        <span>{lead.pseudonymous_customer_id}</span>
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className={`px-2 py-0.5 rounded font-bold ${
                        lead.intent_score >= 90 
                          ? 'bg-theme-accent/20 text-theme-accent border border-theme-accent/40' 
                          : 'bg-theme-surface-elevated text-theme-primary border border-theme-border'
                      }`}>
                        {lead.intent_score} / 100
                      </span>
                    </td>

                    <td className="px-4 py-3.5 text-theme-primary font-bold">
                      {formatCurrency((lead.estimated_deal_value_minor || 0) / 100)}
                    </td>

                    <td className="px-4 py-3.5">
                      <div className={`flex items-center space-x-1.5 ${isDecaying ? 'text-red-500 font-bold' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        <Clock className="w-3.5 h-3.5" />
                        <span>{lead.response_latency_minutes}m</span>
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] ${
                        lead.leak_risk_factor === 'high_decay'
                          ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'
                          : lead.leak_risk_factor === 'unassigned'
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                          : 'bg-theme-surface-elevated text-theme-secondary border border-theme-border'
                      }`}>
                        {lead.leak_risk_factor.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 text-theme-secondary capitalize">
                      {lead.funnel_stage.replace(/_/g, ' ')}
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      {lead.status === 'open' ? (
                        import.meta.env.DEV ? (
                          <button
                            id={`lead-dispatch-fast-action-${lead.id}`}
                            onClick={() => triggerFastLeadResponse(lead.id)}
                            className="px-3 py-1.5 rounded bg-theme-accent hover:bg-theme-accent/90 text-black font-semibold text-xs transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                          >
                            <Zap className="w-3.5 h-3.5" />
                            <span>{t.leads.triggerFastResponse}</span>
                          </button>
                        ) : (
                          <span className="text-amber-500 text-[11px] inline-flex items-center gap-1 font-mono">
                            <Clock className="w-3.5 h-3.5" /> Ingested / Awaiting SLA
                          </span>
                        )
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400 text-[11px] inline-flex items-center gap-1">
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
