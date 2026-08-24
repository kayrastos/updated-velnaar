import React from 'react';
import { usePlatform } from '../../context/PlatformContext';
import { UserRole, MarketType } from '../../types/database';
import { 
  Globe2, 
  ShieldCheck, 
  RefreshCw, 
  Building2, 
  Languages, 
  Radio,
  SlidersHorizontal,
  Sparkles,
  ChevronDown
} from 'lucide-react';

export const Header: React.FC = () => {
  const { 
    currentMarket, 
    setMarket, 
    language, 
    setLanguage, 
    currentRole, 
    setCurrentRole,
    activeTemplateId,
    setActiveTemplateId,
    activeTemplate,
    currentBusiness,
    runLeakScan,
    isScanning,
    t,
    setCurrentRoute
  } = usePlatform();

  return (
    <header id="platform-header" className="bg-[#090A0D] border-b border-[#232732] sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        
        {/* Brand & Archetype Context */}
        <div className="flex items-center space-x-3 sm:space-x-4">
          <div 
            onClick={() => setCurrentRoute('/dashboard')}
            className="flex items-center space-x-2.5 cursor-pointer group"
          >
            <div className="w-8 h-8 rounded bg-gradient-to-br from-[#D4AF37] via-[#BFA15F] to-[#8E7538] flex items-center justify-center shadow-sm">
              <span className="font-editorial text-black font-bold text-base leading-none">V</span>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-editorial font-bold text-[#F5F4F0] text-lg tracking-wider">VELNAR</span>
                <span className="text-[10px] font-mono bg-[#161922] text-[#C5A880] px-1.5 py-0.5 rounded border border-[#C5A880]/20 font-medium">
                  {t.brand.terminalMode}
                </span>
              </div>
            </div>
          </div>

          {/* Demo Business Archetype Switcher */}
          <div className="hidden md:flex items-center space-x-1.5 bg-[#10131A] rounded-lg px-2.5 py-1 border border-[#262B3A] text-xs font-mono">
            <Building2 className="w-3.5 h-3.5 text-[#C5A880]" />
            <select
              value={activeTemplateId}
              onChange={(e) => setActiveTemplateId(e.target.value)}
              className="bg-transparent text-[#F5F4F0] font-medium focus:outline-none cursor-pointer text-xs"
            >
              <option value="template_beauty_salon" className="bg-[#10131A] text-[#F5F4F0]">
                {t.demoSwitch.beauty}
              </option>
              <option value="template_restaurant" className="bg-[#10131A] text-[#F5F4F0]">
                {t.demoSwitch.restaurant}
              </option>
              <option value="template_auto_dealership" className="bg-[#10131A] text-[#F5F4F0]">
                {t.demoSwitch.dealership}
              </option>
            </select>
          </div>
        </div>

        {/* Center/Right Controls: Market Switcher, RBAC Role, Language, Scan */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          
          {/* Market Isolation Switcher */}
          <div className="relative flex items-center bg-[#10131A] rounded-lg p-1 border border-[#262B3A]">
            <button
              id="market-switch-global"
              onClick={() => setMarket('GLOBAL')}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-xs font-mono font-medium transition-all ${
                currentMarket === 'GLOBAL'
                  ? 'bg-[#1E2333] text-[#F5F4F0] border border-[#C5A880]/40 shadow-xs'
                  : 'text-[#7D808D] hover:text-[#D8D6CD]'
              }`}
              title="International Multi-Currency Market State"
            >
              <Globe2 className="w-3.5 h-3.5 text-[#C5A880]" />
              <span>Global ($)</span>
            </button>

            <button
              id="market-switch-tr"
              onClick={() => setMarket('TR')}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-xs font-mono font-medium transition-all ${
                currentMarket === 'TR'
                  ? 'bg-[#1E2333] text-[#F5F4F0] border border-[#C5A880]/40 shadow-xs'
                  : 'text-[#7D808D] hover:text-[#D8D6CD]'
              }`}
              title="Türkiye Bağımsız Pazar Durumu"
            >
              <span className="text-xs">🇹🇷</span>
              <span>Türkiye (₺)</span>
            </button>
          </div>

          {/* RBAC Role Simulator Dropdown (5 Enterprise Roles) */}
          <div className="hidden lg:flex items-center space-x-1 bg-[#10131A] rounded-lg px-2.5 py-1 border border-[#262B3A] text-xs font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-[#C5A880]" />
            <span className="text-[#8E909B] text-[11px]">Role:</span>
            <select
              id="rbac-role-selector"
              value={currentRole}
              onChange={(e) => setCurrentRole(e.target.value as UserRole)}
              className="bg-transparent text-[#F5F4F0] font-medium focus:outline-none cursor-pointer text-xs"
            >
              <option value="owner" className="bg-[#10131A] text-[#F5F4F0]">OWNER (Exec)</option>
              <option value="admin" className="bg-[#10131A] text-[#F5F4F0]">ADMIN (Ops)</option>
              <option value="manager" className="bg-[#10131A] text-[#F5F4F0]">MANAGER</option>
              <option value="staff" className="bg-[#10131A] text-[#F5F4F0]">STAFF</option>
              <option value="viewer" className="bg-[#10131A] text-[#F5F4F0]">VIEWER (RO)</option>
            </select>
          </div>

          {/* Language Switcher (EN / TR) */}
          <div className="flex items-center bg-[#10131A] rounded-lg p-1 border border-[#262B3A]">
            <button
              id="lang-toggle-en"
              onClick={() => setLanguage('en')}
              className={`px-2 py-1 rounded text-[11px] font-mono font-bold transition-all ${
                language === 'en' ? 'bg-[#222736] text-[#F5F4F0]' : 'text-[#7D808D] hover:text-[#D8D6CD]'
              }`}
            >
              EN
            </button>
            <button
              id="lang-toggle-tr"
              onClick={() => setLanguage('tr')}
              className={`px-2 py-1 rounded text-[11px] font-mono font-bold transition-all ${
                language === 'tr' ? 'bg-[#222736] text-[#F5F4F0]' : 'text-[#7D808D] hover:text-[#D8D6CD]'
              }`}
            >
              TR
            </button>
          </div>

          {/* Live Radar Scan Trigger */}
          <button
            id="header-trigger-scan"
            onClick={runLeakScan}
            disabled={isScanning}
            className="flex items-center space-x-1.5 bg-[#181C26] hover:bg-[#202533] text-[#D8D6CD] hover:text-[#FFF] px-3 py-1.5 rounded-lg border border-[#303648] text-xs font-mono transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#C5A880] ${isScanning ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isScanning ? t.common.loading : 'Scan'}</span>
          </button>
        </div>

      </div>
    </header>
  );
};
