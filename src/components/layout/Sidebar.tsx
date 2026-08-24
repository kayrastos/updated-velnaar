import React from 'react';
import { usePlatform } from '../../context/PlatformContext';
import { AppRoute } from '../../types/app';
import { 
  LayoutDashboard, 
  Radar, 
  Sparkles, 
  Award, 
  Inbox, 
  Cpu, 
  Settings, 
  Link2,
  ShieldAlert,
  Sliders,
  Calendar,
  GitMerge,
  ChevronRight
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const { currentRoute, setCurrentRoute, metrics, t } = usePlatform();

  const navItems: Array<{
    route: AppRoute;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number | string;
    badgeColor?: string;
  }> = [
    {
      route: '/dashboard',
      label: t.nav.dashboard,
      icon: LayoutDashboard,
    },
    {
      route: '/leaks',
      label: t.nav.leaks,
      icon: Radar,
      badge: metrics.leaksCount.critical + metrics.leaksCount.high,
      badgeColor: 'bg-red-950/80 text-red-400 border border-red-800/40',
    },
    {
      route: '/actions',
      label: t.nav.actions,
      icon: Sparkles,
      badge: metrics.actionsWaitingApproval > 0 ? metrics.actionsWaitingApproval : undefined,
      badgeColor: 'bg-[#C5A880] text-black font-bold',
    },
    {
      route: '/appointments',
      label: t.nav.appointments,
      icon: Calendar,
      badge: 'Live Sync',
      badgeColor: 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/40',
    },
    {
      route: '/attribution',
      label: t.nav.attribution,
      icon: GitMerge,
    },
    {
      route: '/proof',
      label: t.nav.proof,
      icon: Award,
    },
    {
      route: '/leads',
      label: t.nav.leads,
      icon: Inbox,
    },
    {
      route: '/business-twin',
      label: t.nav.businessTwin,
      icon: Cpu,
      badge: `${metrics.twinConfidenceScore}%`,
      badgeColor: 'bg-[#151923] text-[#C5A880] border border-[#C5A880]/30',
    },
    {
      route: '/security',
      label: t.nav.security,
      icon: ShieldAlert,
      badge: 'Zero-Trust',
      badgeColor: 'bg-[#181C26] text-[#C5A880] border border-[#C5A880]/30',
    },
    {
      route: '/onboarding',
      label: t.nav.onboarding,
      icon: Link2,
    },
    {
      route: '/settings',
      label: t.nav.settings,
      icon: Settings,
    },
  ];

  return (
    <aside id="platform-sidebar" className="w-64 bg-[#090A0D] border-r border-[#232732] flex flex-col justify-between shrink-0 min-h-[calc(100vh-4rem)]">
      
      {/* Navigation Links */}
      <div className="p-3 space-y-1">
        <div className="px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[#717482]">
          Core Systems
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentRoute === item.route;

          return (
            <button
              key={item.route}
              id={`nav-item-${item.route.replace('/', '')}`}
              onClick={() => setCurrentRoute(item.route)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-mono transition-all cursor-pointer group ${
                isActive
                  ? 'bg-[#151822] text-[#F5F4F0] border border-[#C5A880]/40 shadow-xs'
                  : 'text-[#8E909B] hover:text-[#E6E4DC] hover:bg-[#10131A] border border-transparent'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Icon className={`w-4 h-4 transition-colors ${isActive ? 'text-[#C5A880]' : 'text-[#646877] group-hover:text-[#A1A4B2]'}`} />
                <span className="font-medium truncate">{item.label}</span>
              </div>

              {item.badge !== undefined && (
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${item.badgeColor}`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Terminal Footprint & Guardrails Notice */}
      <div className="p-4 border-t border-[#1C202B] space-y-3">
        <div className="bg-[#0D0F15] rounded-lg p-3 border border-[#232732]">
          <div className="flex items-center space-x-2 text-[#C5A880] text-xs font-mono font-semibold mb-1">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>VELNAR Guard System</span>
          </div>
          <p className="text-[11px] text-[#7E8292] leading-relaxed">
            All destructive actions locked behind human executive sign-off.
          </p>
        </div>

        <div className="text-[10px] font-mono text-[#525666] flex items-center justify-between">
          <span>Schema D1 v1.4</span>
          <span className="text-[#3E8256] flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3E8256]"></span> Live
          </span>
        </div>
      </div>

    </aside>
  );
};
