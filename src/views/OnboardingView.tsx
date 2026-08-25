import React, { useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { 
  Link2, 
  Globe2, 
  Cpu, 
  ShieldAlert, 
  Search, 
  CheckCircle2, 
  ArrowRight, 
  RefreshCw,
  Layers,
  Sparkles
} from 'lucide-react';

export const OnboardingView: React.FC = () => {
  const { 
    currentMarket, 
    setMarket, 
    runLeakScan, 
    isScanning, 
    setCurrentRoute, 
    currentBusiness, 
    t 
  } = usePlatform();

  const [activeStep, setActiveStep] = useState<number>(1);
  const [scanCompleted, setScanCompleted] = useState<boolean>(false);

  const handleRunInitialScan = async () => {
    await runLeakScan();
    setScanCompleted(true);
    setActiveStep(4);
  };

  return (
    <div id="onboarding-view" className="max-w-4xl mx-auto space-y-6">
      
      {/* Header */}
      <div className="bg-theme-surface p-6 rounded-xl border border-theme-border space-y-2">
        <div className="flex items-center space-x-2.5">
          <Link2 className="w-5 h-5 text-theme-accent" />
          <h1 className="text-xl font-editorial font-bold text-theme-primary tracking-wide">
            {t.onboarding.title}
          </h1>
        </div>
        <p className="text-xs text-theme-secondary max-w-2xl leading-relaxed">
          {t.onboarding.subtitle}
        </p>
      </div>

      {/* Progress Step Navigator */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs font-mono">
        {[
          { num: 1, label: t.onboarding.step1, icon: Globe2 },
          { num: 2, label: t.onboarding.step2, icon: Cpu },
          { num: 3, label: t.onboarding.step3, icon: ShieldAlert },
          { num: 4, label: t.onboarding.step4, icon: Search },
        ].map((step) => {
          const Icon = step.icon;
          const isCurrent = activeStep === step.num;
          const isDone = activeStep > step.num;

          return (
            <div
              key={step.num}
              onClick={() => setActiveStep(step.num)}
              className={`p-3 rounded-lg border transition-all cursor-pointer ${
                isCurrent 
                  ? 'bg-theme-surface border-theme-accent text-theme-primary' 
                  : isDone
                  ? 'bg-theme-surface border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                  : 'bg-theme-surface-elevated border-theme-border text-theme-muted'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <Icon className="w-4 h-4" />
                <span className="text-[10px] font-bold">STEP 0{step.num}</span>
              </div>
              <div className="text-[11px] truncate font-medium">{step.label}</div>
            </div>
          );
        })}
      </div>

      {/* Active Step Content */}
      <div className="bg-theme-surface border border-theme-border rounded-xl p-6 space-y-6">
        
        {/* Step 1: Market Baseline */}
        {activeStep === 1 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-theme-primary">
                Select Target Market Architecture
              </h3>
              <p className="text-xs text-theme-secondary mt-1">
                VELNAR segregates data models, regulatory rules, and unit economics between Turkey (₺) and International ($).
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div
                id="onboarding-select-global"
                onClick={() => setMarket('GLOBAL')}
                className={`p-5 rounded-xl border transition-all cursor-pointer ${
                  currentMarket === 'GLOBAL'
                    ? 'bg-theme-surface-elevated border-theme-accent ring-1 ring-theme-accent/30'
                    : 'bg-theme-surface border-theme-border hover:border-theme-accent/50'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <Globe2 className="w-5 h-5 text-theme-accent" />
                  {currentMarket === 'GLOBAL' && <CheckCircle2 className="w-4 h-4 text-theme-accent" />}
                </div>
                <h4 className="text-sm font-bold text-theme-primary">International Market (Global - USD)</h4>
                <p className="text-xs text-theme-secondary mt-1 leading-relaxed">
                  Calibrated for enterprise ARR ($), multi-currency compliance, and North America/EMEA sales cycles.
                </p>
              </div>

              <div
                id="onboarding-select-tr"
                onClick={() => setMarket('TR')}
                className={`p-5 rounded-xl border transition-all cursor-pointer ${
                  currentMarket === 'TR'
                    ? 'bg-theme-surface-elevated border-theme-accent ring-1 ring-theme-accent/30'
                    : 'bg-theme-surface border-theme-border hover:border-theme-accent/50'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg">🇹🇷</span>
                  {currentMarket === 'TR' && <CheckCircle2 className="w-4 h-4 text-theme-accent" />}
                </div>
                <h4 className="text-sm font-bold text-theme-primary">Türkiye Pazarı (TR - TRY ₺)</h4>
                <p className="text-xs text-theme-secondary mt-1 leading-relaxed">
                  Marmara/Ege endüstriyel satış döngüleri, vadeli teklif dinamikleri ve yerel muhasebe uyumu.
                </p>
              </div>
            </div>

            <div className="pt-4 flex justify-end">
              <button
                onClick={() => setActiveStep(2)}
                className="px-4 py-2 rounded-lg bg-theme-accent hover:bg-theme-accent/90 text-black font-semibold text-xs font-mono transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>Continue to Business Twin</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Twin Facts */}
        {activeStep === 2 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-theme-primary">
                Calibrate Business Twin Facts
              </h3>
              <p className="text-xs text-theme-secondary mt-1">
                Factual grounding parameters ensure the platform avoids prescribing invalid or destructive growth actions.
              </p>
            </div>

            <div className="space-y-2 bg-theme-surface-elevated p-4 rounded-lg border border-theme-border text-xs font-mono">
              <div className="text-theme-accent font-bold uppercase mb-2">Active Baseline Facts Loaded:</div>
              <div className="flex items-center justify-between text-theme-secondary py-1 border-b border-theme-border">
                <span>ARR Run-Rate</span>
                <span className="text-theme-primary font-bold">{currentBusiness.currency} {currentBusiness.annual_revenue_run_rate.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-theme-secondary py-1 border-b border-theme-border">
                <span>Baseline Gross Margin</span>
                <span className="text-theme-primary font-bold">{currentBusiness.baseline_margin_pct}%</span>
              </div>
              <div className="flex items-center justify-between text-theme-secondary py-1">
                <span>Maximum Allowed Discount</span>
                <span className="text-theme-primary font-bold">15% (Hard Capped)</span>
              </div>
            </div>

            <div className="pt-4 flex justify-between">
              <button
                onClick={() => setActiveStep(1)}
                className="px-4 py-2 rounded-lg border border-theme-border text-xs font-mono text-theme-muted hover:text-theme-primary cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={() => setActiveStep(3)}
                className="px-4 py-2 rounded-lg bg-theme-accent hover:bg-theme-accent/90 text-black font-semibold text-xs font-mono transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>Continue to Guardrails</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Guardrails Policy */}
        {activeStep === 3 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-theme-primary">
                Executive Approval & Guardrails Architecture
              </h3>
              <p className="text-xs text-theme-secondary mt-1">
                VELNAR guarantees that no automated destructive action occurs without an explicit human approval gate.
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-start space-x-3 bg-theme-surface-elevated p-3.5 rounded-lg border border-emerald-500/30">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs font-mono">
                  <span className="font-bold text-theme-primary block">Human-in-the-Loop Sign-Off Gate: ACTIVE</span>
                  <p className="text-theme-secondary font-sans mt-0.5">
                    Growth actions are generated as proposals with full mathematical diffs requiring Owner/Admin approval.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 bg-theme-surface-elevated p-3.5 rounded-lg border border-emerald-500/30">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs font-mono">
                  <span className="font-bold text-theme-primary block">Provider-Neutral AI Gateway: ARMORED</span>
                  <p className="text-theme-secondary font-sans mt-0.5">
                    Multi-provider abstraction layer logs token latencies and verifies guardrails before output.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-4 flex justify-between">
              <button
                onClick={() => setActiveStep(2)}
                className="px-4 py-2 rounded-lg border border-theme-border text-xs font-mono text-theme-muted hover:text-theme-primary cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={() => setActiveStep(4)}
                className="px-4 py-2 rounded-lg bg-theme-accent hover:bg-theme-accent/90 text-black font-semibold text-xs font-mono transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>Proceed to Scan</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Scan Execution */}
        {activeStep === 4 && (
          <div className="space-y-5 text-center py-4">
            <div className="w-14 h-14 rounded-full bg-theme-surface-elevated border border-theme-accent/40 flex items-center justify-center mx-auto text-theme-accent">
              <Search className={`w-7 h-7 ${isScanning ? 'animate-pulse' : ''}`} />
            </div>

            <div>
              <h3 className="text-lg font-bold text-theme-primary">
                {scanCompleted ? t.onboarding.scanCompleteMsg : 'Execute Baseline Leak Radar Scan'}
              </h3>
              <p className="text-xs text-theme-secondary max-w-md mx-auto mt-1 leading-relaxed">
                {isScanning ? t.onboarding.scanningMsg : 'Synthesizes telemetry across your inbound leads, conversion funnel, and business twin facts.'}
              </p>
            </div>

            <div className="pt-2 flex justify-center gap-3">
              {!scanCompleted ? (
                <button
                  id="trigger-initial-onboarding-scan"
                  onClick={handleRunInitialScan}
                  disabled={isScanning}
                  className="px-6 py-2.5 rounded-lg bg-theme-accent hover:bg-theme-accent/90 text-black font-bold text-xs font-mono transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 shadow-md"
                >
                  <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
                  <span>{isScanning ? t.common.loading : t.onboarding.startScanBtn}</span>
                </button>
              ) : (
                <button
                  id="btn-go-to-dashboard"
                  onClick={() => setCurrentRoute('/dashboard')}
                  className="px-6 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs font-mono transition-all cursor-pointer flex items-center gap-2 shadow-md"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{t.onboarding.goToDashboard}</span>
                </button>
              )}
            </div>
          </div>
        )}

      </div>

    </div>
  );
};
