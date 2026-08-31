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
      <div className="bg-theme-surface p-5 rounded-xl border border-theme-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <Sparkles className="w-5 h-5 text-theme-accent" />
            <h1 className="text-xl font-editorial font-bold text-theme-primary tracking-wide">
              {t.actions.title}
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-theme-surface-elevated text-theme-accent border border-theme-border">
              {currentMarket} Market Guard Active
            </span>
          </div>
          <p className="text-xs text-theme-secondary mt-1 max-w-2xl">
            {t.actions.subtitle}
          </p>
        </div>

        <div className="flex items-center space-x-2 bg-theme-surface-elevated px-3.5 py-2 rounded-lg border border-theme-border text-xs font-mono text-amber-600 dark:text-amber-400">
          <Lock className="w-4 h-4 text-amber-500 shrink-0" />
          <span>{t.actions.approvalRequiredNotice}</span>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackAlert && (
        <div className={`p-4 rounded-xl text-xs font-mono flex items-center justify-between transition-all ${
          feedbackAlert.type === 'success' 
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30' 
            : 'bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30'
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
      <div className="flex items-center justify-between border-b border-theme-border pb-1">
        <div className="flex space-x-2">
          <button
            id="tab-actions-pending"
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-2 text-xs font-mono font-medium rounded-t-lg transition-all cursor-pointer flex items-center space-x-2 ${
              activeTab === 'pending'
                ? 'bg-theme-surface text-theme-primary border-t border-x border-theme-border'
                : 'text-theme-muted hover:text-theme-primary'
            }`}
          >
            <span>{t.actions.pendingApproval}</span>
            <span className="bg-theme-accent text-black font-bold px-1.5 py-0.2 rounded-full text-[10px]">
              {pendingActions.length}
            </span>
          </button>

          <button
            id="tab-actions-history"
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 text-xs font-mono font-medium rounded-t-lg transition-all cursor-pointer flex items-center space-x-2 ${
              activeTab === 'history'
                ? 'bg-theme-surface text-theme-primary border-t border-x border-theme-border'
                : 'text-theme-muted hover:text-theme-primary'
            }`}
          >
            <span>{t.actions.history}</span>
            <span className="bg-theme-surface-elevated text-theme-secondary px-1.5 py-0.2 rounded-full text-[10px] border border-theme-border">
              {historyActions.length}
            </span>
          </button>
        </div>

        <div className="text-[11px] font-mono text-theme-muted">
          Active RBAC Signer: <span className="text-theme-accent font-semibold uppercase">{currentRole || 'UNAUTHENTICATED'}</span>
        </div>
      </div>

      {/* Actions Queue */}
      {displayedActions.length === 0 ? (
        <div className="bg-theme-surface border border-theme-border rounded-xl p-12 text-center text-xs font-mono text-theme-muted">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
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
                className={`bg-theme-surface border rounded-xl p-5 space-y-4 transition-all ${
                  isPending 
                    ? 'border-theme-border hover:border-theme-accent/60 shadow-xs' 
                    : 'border-theme-border opacity-85'
                }`}
              >
                {/* Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-theme-surface-elevated text-theme-accent border border-theme-border font-semibold">
                      {action.action_type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[10px] font-mono text-theme-muted">
                      ID: {action.id}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2 text-xs font-mono">
                    <span className={`px-2.5 py-0.5 rounded text-[11px] font-bold ${
                      action.approval_status === 'approved' 
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                        : action.approval_status === 'rejected'
                        ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'
                        : action.approval_status === 'deferred'
                        ? 'bg-theme-surface-elevated text-theme-muted border border-theme-border'
                        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                    }`}>
                      {action.approval_status.replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Title & Hypothesis */}
                <div>
                  <h3 className="text-base font-semibold text-theme-primary">
                    {action.title}
                  </h3>
                  <div className="mt-2 text-xs text-theme-secondary leading-relaxed bg-theme-surface-elevated p-3 rounded-lg border border-theme-border">
                    <strong className="text-theme-accent font-mono block mb-1 uppercase tracking-wider text-[10px]">
                      {t.actions.hypothesis}:
                    </strong>
                    {action.hypothesis}
                  </div>
                </div>

                {/* Guardrails Verification & Payload inspection */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono pt-2 border-t border-theme-border">
                  <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Deterministic Policy Enforced (Human Approval Mandatory)</span>
                  </div>

                  <button
                    onClick={() => setSelectedActionPayload(
                      selectedActionPayload === action.id ? null : action.id
                    )}
                    className="text-theme-muted hover:text-theme-primary flex items-center gap-1 cursor-pointer"
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span>Inspect Execution Payload</span>
                  </button>
                </div>

                {/* Payload JSON Inspector Drawer */}
                {selectedActionPayload === action.id && (
                  <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border font-mono text-[11px] text-theme-secondary overflow-x-auto">
                    <pre>{JSON.stringify(JSON.parse(action.execution_payload_json), null, 2)}</pre>
                  </div>
                )}

                {/* Decision Actions Bar (Only if Pending) */}
                {isPending && (
                  <div className="pt-3 border-t border-theme-border flex flex-wrap items-center justify-between gap-3">
                    <div className="text-[11px] font-mono text-theme-muted">
                      Role Required: <strong className="text-theme-primary">Owner or Admin</strong>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        id={`defer-btn-${action.id}`}
                        onClick={() => handleDefer(action.id)}
                        className="px-3 py-1.5 rounded text-xs font-mono bg-theme-surface-elevated hover:bg-theme-surface text-theme-secondary hover:text-theme-primary border border-theme-border transition-all cursor-pointer"
                      >
                        {t.actions.deferBtn}
                      </button>
                      <button
                        id={`reject-btn-main-${action.id}`}
                        onClick={() => handleReject(action.id)}
                        className="px-3 py-1.5 rounded text-xs font-mono bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30 transition-all cursor-pointer flex items-center gap-1"
                      >
                        <X className="w-3.5 h-3.5" />
                        {t.actions.rejectBtn}
                      </button>
                      <button
                        id={`approve-btn-main-${action.id}`}
                        onClick={() => handleApprove(action.id)}
                        className="px-4 py-1.5 rounded text-xs font-mono font-semibold bg-theme-accent hover:bg-theme-accent/90 text-black transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
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
