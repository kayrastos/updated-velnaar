import React from 'react';
import { usePlatform } from '../context/PlatformContext';
import { 
  AlertTriangle, 
  TrendingUp, 
  Clock, 
  ShieldCheck, 
  ArrowUpRight, 
  ArrowRight,
  Radar, 
  Sparkles, 
  Check, 
  X,
  FileCheck2,
  Lock,
  Layers
} from 'lucide-react';

export const DashboardView: React.FC = () => {
  const { 
    metrics, 
    formatCurrency, 
    leaks, 
    actions, 
    currentBusiness, 
    currentMarket, 
    approveAction, 
    rejectAction, 
    t, 
    setCurrentRoute 
  } = usePlatform();

  const pendingActions = actions.filter(a => a.approval_status === 'pending_approval');
  const criticalLeaks = leaks.filter(l => l.status === 'active').slice(0, 3);

  return (
    <div id="dashboard-view" className="space-y-6">
      
      {/* Top Banner: Business Context & Market Isolation State */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0D0F15] p-4 rounded-xl border border-[#232732]">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-xl font-editorial font-bold text-[#F5F4F0] tracking-wide">
              {currentBusiness.name}
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#181C26] text-[#C5A880] border border-[#C5A880]/30">
              {currentMarket === 'TR' ? 'TR Market 🇹🇷' : 'Global Market 🌐'}
            </span>
          </div>
          <p className="text-xs text-[#8E909B] font-mono mt-0.5">
            ARR Run-Rate: {formatCurrency(currentBusiness.annual_revenue_run_rate)} | Baseline Margin: {currentBusiness.baseline_margin_pct}%
          </p>
        </div>

        <div className="flex items-center space-x-2 text-xs font-mono text-[#8E909B]">
          <span className="inline-block w-2 h-2 rounded-full bg-[#D4AF37]"></span>
          <span>{t.market.isolatedNotice}</span>
        </div>
      </div>

      {/* Hero Outcome Metric Cards (Emphasizing Business Outcomes, NOT Vanity Metrics) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* 1. Revenue at Risk */}
        <div id="metric-revenue-at-risk" className="bg-[#0F121A] p-5 rounded-xl border border-red-900/30 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-full blur-2xl group-hover:bg-red-500/10 transition-all pointer-events-none" />
          <div className="flex items-center justify-between text-xs font-mono text-red-400 mb-2">
            <span className="uppercase tracking-wider font-semibold">{t.hero.revenueAtRisk}</span>
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-mono font-bold text-[#F5F4F0] tracking-tight">
            {formatCurrency(metrics.revenueAtRisk)}
            <span className="text-xs font-normal text-[#8E909B] ml-1">/mo</span>
          </div>
          <p className="text-[11px] text-[#8E909B] mt-2 line-clamp-2 leading-relaxed">
            {t.hero.revenueAtRiskSub}
          </p>
          <div className="mt-3 pt-3 border-t border-[#1F2433] flex items-center justify-between text-[11px] font-mono">
            <span className="text-red-400 font-medium">{metrics.leaksCount.critical} Critical Vectors</span>
            <button 
              onClick={() => setCurrentRoute('/leaks')}
              className="text-[#C5A880] hover:underline flex items-center gap-0.5 cursor-pointer"
            >
              Radar <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* 2. Growth Opportunities */}
        <div id="metric-growth-opportunities" className="bg-[#0F121A] p-5 rounded-xl border border-[#232732] relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#D4AF37]/5 rounded-full blur-2xl group-hover:bg-[#D4AF37]/10 transition-all pointer-events-none" />
          <div className="flex items-center justify-between text-xs font-mono text-[#C5A880] mb-2">
            <span className="uppercase tracking-wider font-semibold">{t.hero.growthOpportunities}</span>
            <TrendingUp className="w-4 h-4 text-[#C5A880]" />
          </div>
          <div className="text-2xl sm:text-3xl font-mono font-bold text-[#F5F4F0] tracking-tight">
            {formatCurrency(metrics.growthOpportunities)}
          </div>
          <p className="text-[11px] text-[#8E909B] mt-2 line-clamp-2 leading-relaxed">
            {t.hero.growthOpportunitiesSub}
          </p>
          <div className="mt-3 pt-3 border-t border-[#1F2433] flex items-center justify-between text-[11px] font-mono">
            <span className="text-[#A1A4B2]">High-Intent Pipeline</span>
            <button 
              onClick={() => setCurrentRoute('/leads')}
              className="text-[#C5A880] hover:underline flex items-center gap-0.5 cursor-pointer"
            >
              Leads <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* 3. Actions Waiting for Approval */}
        <div id="metric-actions-waiting-approval" className={`p-5 rounded-xl border relative overflow-hidden transition-all ${
          metrics.actionsWaitingApproval > 0 
            ? 'bg-[#14120E] border-[#D4AF37]/40 ring-1 ring-[#D4AF37]/30' 
            : 'bg-[#0F121A] border-[#232732]'
        }`}>
          <div className="flex items-center justify-between text-xs font-mono text-[#D4AF37] mb-2">
            <span className="uppercase tracking-wider font-semibold">{t.hero.actionsWaitingApproval}</span>
            <Clock className="w-4 h-4 text-[#D4AF37]" />
          </div>
          <div className="text-2xl sm:text-3xl font-mono font-bold text-[#F5F4F0] tracking-tight flex items-baseline gap-2">
            <span>{metrics.actionsWaitingApproval}</span>
            <span className="text-xs font-normal text-[#D4AF37] font-sans">
              {metrics.actionsWaitingApproval > 0 ? 'Requires Sign-Off' : 'All Clear'}
            </span>
          </div>
          <p className="text-[11px] text-[#8E909B] mt-2 line-clamp-2 leading-relaxed">
            {t.hero.actionsWaitingApprovalSub}
          </p>
          <div className="mt-3 pt-3 border-t border-[#262118] flex items-center justify-between text-[11px] font-mono">
            <span className="text-[#C5A880] flex items-center gap-1">
              <Lock className="w-3 h-3" /> Guard Gated
            </span>
            <button 
              onClick={() => setCurrentRoute('/actions')}
              className="text-[#D4AF37] font-bold hover:underline flex items-center gap-0.5 cursor-pointer"
            >
              Review <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* 4. Revenue Influenced by VELNAR */}
        <div id="metric-revenue-influenced" className="bg-[#0F121A] p-5 rounded-xl border border-emerald-900/30 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-all pointer-events-none" />
          <div className="flex items-center justify-between text-xs font-mono text-emerald-400 mb-2">
            <span className="uppercase tracking-wider font-semibold">{t.hero.revenueInfluenced}</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-mono font-bold text-[#F5F4F0] tracking-tight">
            {formatCurrency(metrics.revenueInfluenced)}
          </div>
          <p className="text-[11px] text-[#8E909B] mt-2 line-clamp-2 leading-relaxed">
            {t.hero.revenueInfluencedSub}
          </p>
          <div className="mt-3 pt-3 border-t border-[#1F2433] flex items-center justify-between text-[11px] font-mono">
            <span className="text-emerald-400 font-medium">Audited & Verified</span>
            <button 
              onClick={() => setCurrentRoute('/proof')}
              className="text-[#C5A880] hover:underline flex items-center gap-0.5 cursor-pointer"
            >
              Ledger <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

      </div>

      {/* Two-Column Operations Grid: Pending Approval Actions & Revenue Leak Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (7 cols): Growth Actions Waiting for Executive Sign-off */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-[#C5A880]" />
              <h2 className="text-sm font-mono uppercase tracking-wider font-semibold text-[#E6E4DC]">
                {t.actions.pendingApproval} ({pendingActions.length})
              </h2>
            </div>
            <button
              onClick={() => setCurrentRoute('/actions')}
              className="text-xs font-mono text-[#C5A880] hover:underline flex items-center gap-1 cursor-pointer"
            >
              All Actions <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          {pendingActions.length === 0 ? (
            <div className="bg-[#0F121A] border border-[#232732] rounded-xl p-8 text-center text-xs font-mono text-[#8E909B]">
              <Check className="w-8 h-8 text-[#3E8256] mx-auto mb-2" />
              All growth actions currently approved or executed.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingActions.map((action) => (
                <div 
                  key={action.id}
                  id={`dashboard-action-${action.id}`}
                  className="bg-[#0F121A] border border-[#262B3A] hover:border-[#C5A880]/50 rounded-xl p-4 transition-all space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#181C26] text-[#C5A880] border border-[#C5A880]/20">
                          {action.action_type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] font-mono text-[#7E8292]">
                          Guard: Passed
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-[#F5F4F0] mt-1.5">
                        {action.title}
                      </h3>
                    </div>
                  </div>

                  <p className="text-xs text-[#A1A4B2] leading-relaxed">
                    {action.hypothesis}
                  </p>

                  <div className="pt-2 border-t border-[#1C202B] flex flex-wrap items-center justify-between gap-3">
                    <div className="text-[11px] font-mono text-[#C5A880] flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      <span>Approval Mandatory</span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        id={`reject-btn-${action.id}`}
                        onClick={() => rejectAction(action.id)}
                        className="px-3 py-1.5 rounded text-xs font-mono bg-[#161922] hover:bg-red-950/40 text-[#8E909B] hover:text-red-300 border border-[#2C3142] transition-all cursor-pointer flex items-center gap-1"
                      >
                        <X className="w-3 h-3" />
                        {t.actions.rejectBtn}
                      </button>
                      <button
                        id={`approve-btn-${action.id}`}
                        onClick={() => approveAction(action.id)}
                        className="px-3 py-1.5 rounded text-xs font-mono font-semibold bg-[#C5A880] hover:bg-[#D4AF37] text-black transition-all cursor-pointer flex items-center gap-1 shadow-xs"
                      >
                        <Check className="w-3.5 h-3.5" />
                        {t.actions.approveBtn}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column (5 cols): High-Severity Revenue Leaks Snapshot */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Radar className="w-4 h-4 text-red-400" />
              <h2 className="text-sm font-mono uppercase tracking-wider font-semibold text-[#E6E4DC]">
                {t.leaks.title}
              </h2>
            </div>
            <button
              onClick={() => setCurrentRoute('/leaks')}
              className="text-xs font-mono text-[#C5A880] hover:underline flex items-center gap-1 cursor-pointer"
            >
              Full Radar <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-3">
            {criticalLeaks.map((leak) => (
              <div 
                key={leak.id}
                id={`dashboard-leak-${leak.id}`}
                className="bg-[#0F121A] border border-[#262B3A] rounded-xl p-4 space-y-2 hover:border-[#383F54] transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                    leak.severity === 'critical' 
                      ? 'bg-red-950/80 text-red-400 border border-red-800/40'
                      : 'bg-amber-950/80 text-amber-400 border border-amber-800/40'
                  }`}>
                    {leak.severity.toUpperCase()}
                  </span>
                  <span className="text-xs font-mono font-bold text-red-400">
                    -{formatCurrency((leak.estimated_monthly_loss_minor || 0) / 100)}/mo
                  </span>
                </div>

                <h4 className="text-xs font-semibold text-[#F5F4F0]">
                  {leak.title}
                </h4>

                <p className="text-[11px] text-[#8E909B] line-clamp-2 leading-relaxed">
                  {leak.root_cause}
                </p>

                <div className="pt-2 flex items-center justify-between text-[10px] font-mono text-[#717585]">
                  <span>Stage: {leak.affected_funnel_stage}</span>
                  <span className="text-[#C5A880]">Conf: {Math.round(leak.confidence_score * 100)}%</span>
                </div>
              </div>
            ))}
          </div>

          {/* Business Twin Knowledge Confidence Barometer */}
          <div className="bg-[#0D0F15] border border-[#232732] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs font-mono text-[#E6E4DC]">
                <Layers className="w-3.5 h-3.5 text-[#C5A880]" />
                <span className="font-semibold">{t.businessTwin.confidenceScore}</span>
              </div>
              <span className="text-xs font-mono font-bold text-[#C5A880]">
                {metrics.twinConfidenceScore}%
              </span>
            </div>

            <div className="w-full bg-[#181C26] h-1.5 rounded-full overflow-hidden">
              <div 
                className="bg-gradient-to-r from-[#8E7538] via-[#BFA15F] to-[#D4AF37] h-full rounded-full transition-all"
                style={{ width: `${metrics.twinConfidenceScore}%` }}
              />
            </div>

            <p className="text-[11px] text-[#8E909B] leading-relaxed">
              Based on verified unit economics, pricing limits, and customer profile facts.
            </p>
          </div>

        </div>

      </div>

    </div>
  );
};
