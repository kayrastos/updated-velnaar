import React from 'react';
import { usePlatform } from '../../context/PlatformContext';
import { 
  Zap, 
  BrainCircuit, 
  Search, 
  Sparkles, 
  CheckCircle2, 
  BarChart3, 
  Lightbulb,
  ArrowRight
} from 'lucide-react';

export const ProductLoopHUD: React.FC = () => {
  const { metrics, t, currentRoute, setCurrentRoute } = usePlatform();

  const steps = [
    { key: 'CONNECT', label: t.loop.connect, icon: Zap, route: '/onboarding' as const },
    { key: 'UNDERSTAND', label: t.loop.understand, icon: BrainCircuit, route: '/business-twin' as const },
    { key: 'DETECT', label: t.loop.detect, icon: Search, route: '/leaks' as const, badge: metrics.leaksCount.critical + metrics.leaksCount.high },
    { key: 'RECOMMEND', label: t.loop.recommend, icon: Sparkles, route: '/actions' as const },
    { key: 'APPROVE', label: t.loop.approve, icon: CheckCircle2, route: '/actions' as const, badge: metrics.actionsWaitingApproval, highlight: metrics.actionsWaitingApproval > 0 },
    { key: 'MEASURE', label: t.loop.measure, icon: BarChart3, route: '/proof' as const },
    { key: 'LEARN', label: t.loop.learn, icon: Lightbulb, route: '/business-twin' as const },
  ];

  return (
    <div id="product-loop-hud" className="w-full bg-[#0D0F14] border-y border-[#232732] px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center space-x-2 text-[11px] font-mono tracking-wider text-[#A1A1AA] uppercase">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#C5A880] animate-pulse"></span>
          <span className="text-[#E6E4DC] font-semibold">{t.loop.title}</span>
        </div>

        {/* 7-Step Interactive Pipeline Flow */}
        <div className="flex items-center space-x-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 text-xs">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            const isCurrentRoute = currentRoute === step.route;
            
            return (
              <React.Fragment key={step.key}>
                <button
                  id={`loop-step-${step.key.toLowerCase()}`}
                  onClick={() => setCurrentRoute(step.route)}
                  className={`flex items-center space-x-1.5 px-2.5 py-1 rounded transition-all whitespace-nowrap cursor-pointer ${
                    isCurrentRoute
                      ? 'bg-[#1D2230] text-[#F5F4F0] border border-[#C5A880]/50 shadow-xs'
                      : 'text-[#8E909B] hover:text-[#D8D6CD] hover:bg-[#151821] border border-transparent'
                  } ${step.highlight ? 'ring-1 ring-[#D4AF37]/60 bg-[#D4AF37]/5' : ''}`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isCurrentRoute ? 'text-[#C5A880]' : 'text-[#71737F]'}`} />
                  <span className="font-mono text-[11px] font-medium">{step.label}</span>
                  {typeof step.badge === 'number' && step.badge > 0 && (
                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full ${
                      step.highlight ? 'bg-[#D4AF37] text-black' : 'bg-[#2A2E3D] text-[#D8D6CD]'
                    }`}>
                      {step.badge}
                    </span>
                  )}
                </button>
                {idx < steps.length - 1 && (
                  <ArrowRight className="w-3 h-3 text-[#3A3F50] shrink-0" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
