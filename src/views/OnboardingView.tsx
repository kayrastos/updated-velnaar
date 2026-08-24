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
      <div className="bg-[#0D0F15] p-6 rounded-xl border border-[#232732] space-y-2">
        <div className="flex items-center space-x-2.5">
          <Link2 className="w-5 h-5 text-[#C5A880]" />
          <h1 className="text-xl font-editorial font-bold text-[#F5F4F0] tracking-wide">
            {t.onboarding.title}
          </h1>
        </div>
        <p className="text-xs text-[#8E909B] max-w-2xl leading-relaxed">
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
                  ? 'bg-[#151924] border-[#C5A880] text-[#F5F4F0]' 
                  : isDone
                  ? 'bg-[#0D0F15] border-emerald-900/50 text-emerald-400'
                  : 'bg-[#0A0C11] border-[#1E2230] text-[#717585]'
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
      <div className="bg-[#0F121A] border border-[#232732] rounded-xl p-6 space-y-6">
        
        {/* Step 1: Market Baseline */}
        {activeStep === 1 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-[#F5F4F0]">
                Select Target Market Architecture
              </h3>
              <p className="text-xs text-[#8E909B] mt-1">
                VELNAR segregates data models, regulatory rules, and unit economics between Turkey (₺) and International ($).
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div
                id="onboarding-select-global"
                onClick={() => setMarket('GLOBAL')}
                className={`p-5 rounded-xl border transition-all cursor-pointer ${
                  currentMarket === 'GLOBAL'
                    ? 'bg-[#161B28] border-[#C5A880] ring-1 ring-[#C5A880]/30'
                    : 'bg-[#0C0E14] border-[#222736] hover:border-[#383F54]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <Globe2 className="w-5 h-5 text-[#C5A880]" />
                  {currentMarket === 'GLOBAL' && <CheckCircle2 className="w-4 h-4 text-[#C5A880]" />}
                </div>
                <h4 className="text-sm font-bold text-[#F5F4F0]">International Market (Global - USD)</h4>
                <p className="text-xs text-[#8E909B] mt-1 leading-relaxed">
                  Calibrated for enterprise ARR ($), multi-currency compliance, and North America/EMEA sales cycles.
                </p>
              </div>

              <div
                id="onboarding-select-tr"
                onClick={() => setMarket('TR')}
                className={`p-5 rounded-xl border transition-all cursor-pointer ${
                  currentMarket === 'TR'
                    ? 'bg-[#161B28] border-[#C5A880] ring-1 ring-[#C5A880]/30'
                    : 'bg-[#0C0E14] border-[#222736] hover:border-[#383F54]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg">🇹🇷</span>
                  {currentMarket === 'TR' && <CheckCircle2 className="w-4 h-4 text-[#C5A880]" />}
                </div>
                <h4 className="text-sm font-bold text-[#F5F4F0]">Türkiye Pazarı (TR - TRY ₺)</h4>
                <p className="text-xs text-[#8E909B] mt-1 leading-relaxed">
                  Marmara/Ege endüstriyel satış döngüleri, vadeli teklif dinamikleri ve yerel muhasebe uyumu.
                </p>
              </div>
            </div>

            <div className="pt-4 flex justify-end">
              <button
                onClick={() => setActiveStep(2)}
                className="px-4 py-2 rounded-lg bg-[#C5A880] hover:bg-[#D4AF37] text-black font-semibold text-xs font-mono transition-all flex items-center gap-1.5 cursor-pointer"
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
              <h3 className="text-base font-semibold text-[#F5F4F0]">
                Calibrate Business Twin Facts
              </h3>
              <p className="text-xs text-[#8E909B] mt-1">
                Factual grounding parameters ensure the platform avoids prescribing invalid or destructive growth actions.
              </p>
            </div>

            <div className="space-y-2 bg-[#090A0E] p-4 rounded-lg border border-[#1E2230] text-xs font-mono">
              <div className="text-[#C5A880] font-bold uppercase mb-2">Active Baseline Facts Loaded:</div>
              <div className="flex items-center justify-between text-[#D8D6CD] py-1 border-b border-[#1A1D28]">
                <span>ARR Run-Rate</span>
                <span className="text-[#F5F4F0] font-bold">{currentBusiness.currency} {currentBusiness.annual_revenue_run_rate.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-[#D8D6CD] py-1 border-b border-[#1A1D28]">
                <span>Baseline Gross Margin</span>
                <span className="text-[#F5F4F0] font-bold">{currentBusiness.baseline_margin_pct}%</span>
              </div>
              <div className="flex items-center justify-between text-[#D8D6CD] py-1">
                <span>Maximum Allowed Discount</span>
                <span className="text-[#F5F4F0] font-bold">15% (Hard Capped)</span>
              </div>
            </div>

            <div className="pt-4 flex justify-between">
              <button
                onClick={() => setActiveStep(1)}
                className="px-4 py-2 rounded-lg border border-[#232732] text-xs font-mono text-[#8E909B] hover:text-[#FFF] cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={() => setActiveStep(3)}
                className="px-4 py-2 rounded-lg bg-[#C5A880] hover:bg-[#D4AF37] text-black font-semibold text-xs font-mono transition-all flex items-center gap-1.5 cursor-pointer"
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
              <h3 className="text-base font-semibold text-[#F5F4F0]">
                Executive Approval & Guardrails Architecture
              </h3>
              <p className="text-xs text-[#8E909B] mt-1">
                VELNAR guarantees that no automated destructive action occurs without an explicit human approval gate.
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-start space-x-3 bg-[#121520] p-3.5 rounded-lg border border-emerald-900/30">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs font-mono">
                  <span className="font-bold text-[#F5F4F0] block">Human-in-the-Loop Sign-Off Gate: ACTIVE</span>
                  <p className="text-[#8E909B] font-sans mt-0.5">
                    Growth actions are generated as proposals with full mathematical diffs requiring Owner/Admin approval.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 bg-[#121520] p-3.5 rounded-lg border border-emerald-900/30">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs font-mono">
                  <span className="font-bold text-[#F5F4F0] block">Provider-Neutral AI Gateway: ARMORED</span>
                  <p className="text-[#8E909B] font-sans mt-0.5">
                    Multi-provider abstraction layer logs token latencies and verifies guardrails before output.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-4 flex justify-between">
              <button
                onClick={() => setActiveStep(2)}
                className="px-4 py-2 rounded-lg border border-[#232732] text-xs font-mono text-[#8E909B] hover:text-[#FFF] cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={() => setActiveStep(4)}
                className="px-4 py-2 rounded-lg bg-[#C5A880] hover:bg-[#D4AF37] text-black font-semibold text-xs font-mono transition-all flex items-center gap-1.5 cursor-pointer"
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
            <div className="w-14 h-14 rounded-full bg-[#1A1E2B] border border-[#C5A880]/40 flex items-center justify-center mx-auto text-[#C5A880]">
              <Search className={`w-7 h-7 ${isScanning ? 'animate-pulse' : ''}`} />
            </div>

            <div>
              <h3 className="text-lg font-bold text-[#F5F4F0]">
                {scanCompleted ? t.onboarding.scanCompleteMsg : 'Execute Baseline Leak Radar Scan'}
              </h3>
              <p className="text-xs text-[#8E909B] max-w-md mx-auto mt-1 leading-relaxed">
                {isScanning ? t.onboarding.scanningMsg : 'Synthesizes telemetry across your inbound leads, conversion funnel, and business twin facts.'}
              </p>
            </div>

            <div className="pt-2 flex justify-center gap-3">
              {!scanCompleted ? (
                <button
                  id="trigger-initial-onboarding-scan"
                  onClick={handleRunInitialScan}
                  disabled={isScanning}
                  className="px-6 py-2.5 rounded-lg bg-[#C5A880] hover:bg-[#D4AF37] text-black font-bold text-xs font-mono transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 shadow-md"
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
