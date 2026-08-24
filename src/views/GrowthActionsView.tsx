import React, { useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { 
  Sparkles, 
  Check, 
  X, 
  Clock, 
  ShieldCheck, 
  Lock, 
  AlertCircle, 
  CheckCircle2, 
  FileCode,
  ArrowUpRight,
  Filter
} from 'lucide-react';

export const GrowthActionsView: React.FC = () => {
  const { 
    actions, 
    approveAction, 
    rejectAction, 
    deferAction, 
    currentRole, 
    currentMarket, 
    t 
  } = usePlatform();

  const [feedbackAlert, setFeedbackAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [selectedActionPayload, setSelectedActionPayload] = useState<string | null>(null);

  const pendingActions = actions.filter(a => a.approval_status === 'pending_approval');
  const historyActions = actions.filter(a => a.approval_status !== 'pending_approval');

  const displayedActions = activeTab === 'pending' ? pendingActions : historyActions;

  const handleApprove = async (id: string) => {
    const res = await approveAction(id);
    setFeedbackAlert({
      type: res.success ? 'success' : 'error',
      message: res.message,
    });
    setTimeout(() => setFeedbackAlert(null), 5000);
  };

  const handleReject = async (id: string) => {
    const res = await rejectAction(id);
    setFeedbackAlert({
      type: res.success ? 'success' : 'error',
      message: res.message,
    });
    setTimeout(() => setFeedbackAlert(null), 5000);
  };

  const handleDefer = async (id: string) => {
    const res = await deferAction(id);
    setFeedbackAlert({
      type: 'success',
      message: res.message,
    });
    setTimeout(() => setFeedbackAlert(null), 5000);
  };

  return (
    <div id="growth-actions-view" className="space-y-6">
      
      {/* Header & Policy Notice */}
      <div className="bg-[#0D0F15] p-5 rounded-xl border border-[#232732] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <Sparkles className="w-5 h-5 text-[#C5A880]" />
            <h1 className="text-xl font-editorial font-bold text-[#F5F4F0] tracking-wide">
              {t.actions.title}
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#1A1D28] text-[#C5A880] border border-[#C5A880]/30">
              {currentMarket} Market Guard Active
            </span>
          </div>
          <p className="text-xs text-[#8E909B] mt-1 max-w-2xl">
            {t.actions.subtitle}
          </p>
        </div>

        <div className="flex items-center space-x-2 bg-[#12151F] px-3.5 py-2 rounded-lg border border-[#232736] text-xs font-mono text-[#D4AF37]">
          <Lock className="w-4 h-4 text-[#D4AF37] shrink-0" />
          <span>{t.actions.approvalRequiredNotice}</span>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackAlert && (
        <div className={`p-4 rounded-xl text-xs font-mono flex items-center justify-between transition-all ${
          feedbackAlert.type === 'success' 
            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/50' 
            : 'bg-red-950/80 text-red-300 border border-red-800/50'
        }`}>
          <div className="flex items-center space-x-2">
            {feedbackAlert.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{feedbackAlert.message}</span>
          </div>
          <button onClick={() => setFeedbackAlert(null)} className="text-current opacity-70 hover:opacity-100 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs Bar */}
      <div className="flex items-center justify-between border-b border-[#232732] pb-1">
        <div className="flex space-x-2">
          <button
            id="tab-actions-pending"
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-2 text-xs font-mono font-medium rounded-t-lg transition-all cursor-pointer flex items-center space-x-2 ${
              activeTab === 'pending'
                ? 'bg-[#151824] text-[#F5F4F0] border-t border-x border-[#C5A880]/40'
                : 'text-[#7D808D] hover:text-[#D8D6CD]'
            }`}
          >
            <span>{t.actions.pendingApproval}</span>
            <span className="bg-[#C5A880] text-black font-bold px-1.5 py-0.2 rounded-full text-[10px]">
              {pendingActions.length}
            </span>
          </button>

          <button
            id="tab-actions-history"
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 text-xs font-mono font-medium rounded-t-lg transition-all cursor-pointer flex items-center space-x-2 ${
              activeTab === 'history'
                ? 'bg-[#151824] text-[#F5F4F0] border-t border-x border-[#C5A880]/40'
                : 'text-[#7D808D] hover:text-[#D8D6CD]'
            }`}
          >
            <span>{t.actions.history}</span>
            <span className="bg-[#242838] text-[#8E909B] px-1.5 py-0.2 rounded-full text-[10px]">
              {historyActions.length}
            </span>
          </button>
        </div>

        <div className="text-[11px] font-mono text-[#717585]">
          Active RBAC Signer: <span className="text-[#C5A880] font-semibold uppercase">{currentRole}</span>
        </div>
      </div>

      {/* Actions Queue */}
      {displayedActions.length === 0 ? (
        <div className="bg-[#0F121A] border border-[#232732] rounded-xl p-12 text-center text-xs font-mono text-[#8E909B]">
          <CheckCircle2 className="w-10 h-10 text-[#3E8256] mx-auto mb-2 opacity-80" />
          {activeTab === 'pending' 
            ? 'No actions currently awaiting approval. All pipeline optimizations up to date.' 
            : 'No historical actions logged in this market yet.'}
        </div>
      ) : (
        <div className="space-y-4">
          {displayedActions.map((action) => {
            const isPending = action.approval_status === 'pending_approval';

            return (
              <div
                key={action.id}
                id={`growth-action-card-${action.id}`}
                className={`bg-[#0F121A] border rounded-xl p-5 space-y-4 transition-all ${
                  isPending 
                    ? 'border-[#262B3A] hover:border-[#C5A880]/60 shadow-xs' 
                    : 'border-[#1C202B] opacity-85'
                }`}
              >
                {/* Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#181C26] text-[#C5A880] border border-[#C5A880]/20 font-semibold">
                      {action.action_type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[10px] font-mono text-[#7E8292]">
                      ID: {action.id}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2 text-xs font-mono">
                    <span className={`px-2.5 py-0.5 rounded text-[11px] font-bold ${
                      action.approval_status === 'approved' 
                        ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40'
                        : action.approval_status === 'rejected'
                        ? 'bg-red-950/80 text-red-400 border border-red-800/40'
                        : action.approval_status === 'deferred'
                        ? 'bg-zinc-800 text-zinc-300'
                        : 'bg-[#1C1811] text-[#D4AF37] border border-[#D4AF37]/40'
                    }`}>
                      {action.approval_status.replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Title & Hypothesis */}
                <div>
                  <h3 className="text-base font-semibold text-[#F5F4F0]">
                    {action.title}
                  </h3>
                  <div className="mt-2 text-xs text-[#A1A4B2] leading-relaxed bg-[#121520] p-3 rounded-lg border border-[#1E2230]">
                    <strong className="text-[#C5A880] font-mono block mb-1 uppercase tracking-wider text-[10px]">
                      {t.actions.hypothesis}:
                    </strong>
                    {action.hypothesis}
                  </div>
                </div>

                {/* Guardrails Verification & Payload inspection */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono pt-2 border-t border-[#1C202B]">
                  <div className="flex items-center space-x-2 text-emerald-400">
                    <ShieldCheck className="w-4 h-4" />
                    <span>{t.actions.guardrailsPassed}</span>
                  </div>

                  <button
                    onClick={() => setSelectedActionPayload(
                      selectedActionPayload === action.id ? null : action.id
                    )}
                    className="text-[#8E909B] hover:text-[#F5F4F0] flex items-center gap-1 cursor-pointer"
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span>Inspect Execution Payload</span>
                  </button>
                </div>

                {/* Payload JSON Inspector Drawer */}
                {selectedActionPayload === action.id && (
                  <div className="bg-[#090A0E] p-3 rounded-lg border border-[#232736] font-mono text-[11px] text-[#A1A4B2] overflow-x-auto">
                    <pre>{JSON.stringify(JSON.parse(action.execution_payload_json), null, 2)}</pre>
                  </div>
                )}

                {/* Decision Actions Bar (Only if Pending) */}
                {isPending && (
                  <div className="pt-3 border-t border-[#1C202B] flex flex-wrap items-center justify-between gap-3">
                    <div className="text-[11px] font-mono text-[#7E8292]">
                      Role Required: <strong className="text-[#D8D6CD]">Owner or Admin</strong>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        id={`defer-btn-${action.id}`}
                        onClick={() => handleDefer(action.id)}
                        className="px-3 py-1.5 rounded text-xs font-mono bg-[#161922] hover:bg-[#1E2230] text-[#8E909B] hover:text-[#FFF] border border-[#2C3142] transition-all cursor-pointer"
                      >
                        {t.actions.deferBtn}
                      </button>
                      <button
                        id={`reject-btn-main-${action.id}`}
                        onClick={() => handleReject(action.id)}
                        className="px-3 py-1.5 rounded text-xs font-mono bg-[#1A1214] hover:bg-red-950/60 text-red-300 border border-red-900/40 transition-all cursor-pointer flex items-center gap-1"
                      >
                        <X className="w-3.5 h-3.5" />
                        {t.actions.rejectBtn}
                      </button>
                      <button
                        id={`approve-btn-main-${action.id}`}
                        onClick={() => handleApprove(action.id)}
                        className="px-4 py-1.5 rounded text-xs font-mono font-semibold bg-[#C5A880] hover:bg-[#D4AF37] text-black transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
                      >
                        <Check className="w-4 h-4" />
                        {t.actions.approveBtn}
                      </button>
                    </div>
                  </div>
                )}

              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
