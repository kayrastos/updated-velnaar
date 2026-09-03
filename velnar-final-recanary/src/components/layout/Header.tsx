import React from 'react';
import { usePlatform } from '../../context/PlatformContext';
import { useTheme } from '../../context/ThemeContext';
import { UserRole } from '../../types/database';
import { 
  Globe2, 
  ShieldCheck, 
  RefreshCw, 
  Building2, 
  Sun,
  Moon,
  Laptop
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
    runLeakScan,
    isScanning,
    t,
    setCurrentRoute
  } = usePlatform();

  const { theme, setTheme } = useTheme();

  return (
    <header id="platform-header" className="bg-theme-surface border-b border-theme-border sticky top-0 z-40 transition-colors duration-200">
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
                <span className="font-editorial font-bold text-theme-primary text-lg tracking-wider">VELNAR</span>
                <span className="text-[10px] font-mono bg-theme-surface-elevated text-theme-accent px-1.5 py-0.5 rounded border border-theme-border font-medium">
                  {t.brand.terminalMode}
                </span>
              </div>
            </div>
          </div>

          {/* Demo Business Archetype Switcher (DEV ONLY) */}
          {import.meta.env?.DEV && (
            <div className="hidden md:flex items-center space-x-1.5 bg-theme-surface-elevated rounded-lg px-2.5 py-1 border border-amber-500/30 text-xs font-mono">
              <span className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-500 text-[10px] font-bold">
                DEMO
              </span>
              <Building2 className="w-3.5 h-3.5 text-theme-accent" />
              <select
                value={activeTemplateId}
                onChange={(e) => setActiveTemplateId(e.target.value)}
                className="bg-transparent text-theme-primary font-medium focus:outline-none cursor-pointer text-xs"
              >
                <option value="template_beauty_salon" className="bg-theme-surface text-theme-primary">
                  {t.demoSwitch.beauty}
                </option>
                <option value="template_restaurant" className="bg-theme-surface text-theme-primary">
                  {t.demoSwitch.restaurant}
                </option>
                <option value="template_auto_dealership" className="bg-theme-surface text-theme-primary">
                  {t.demoSwitch.dealership}
                </option>
              </select>
            </div>
          )}
        </div>

        {/* Center/Right Controls: Market Switcher, RBAC Role, Theme, Language, Scan */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          
          {/* Market Isolation Switcher */}
          <div className="relative flex items-center bg-theme-surface-elevated rounded-lg p-1 border border-theme-border">
            <button
              id="market-switch-global"
              onClick={() => setMarket('GLOBAL')}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-xs font-mono font-medium transition-all cursor-pointer ${
                currentMarket === 'GLOBAL'
                  ? 'bg-theme-surface text-theme-primary border border-theme-border shadow-xs'
                  : 'text-theme-muted hover:text-theme-primary'
              }`}
              title="International Multi-Currency Market State"
            >
              <Globe2 className="w-3.5 h-3.5 text-theme-accent" />
              <span>Global ($)</span>
            </button>

            <button
              id="market-switch-tr"
              onClick={() => setMarket('TR')}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-xs font-mono font-medium transition-all cursor-pointer ${
                currentMarket === 'TR'
                  ? 'bg-theme-surface text-theme-primary border border-theme-border shadow-xs'
                  : 'text-theme-muted hover:text-theme-primary'
              }`}
              title="Türkiye Bağımsız Pazar Durumu"
            >
              <span className="text-xs">🇹🇷</span>
              <span>Türkiye (₺)</span>
            </button>
          </div>

          {/* RBAC Role: Selector in DEV, Read-Only Badge in PROD */}
          <div className="hidden lg:flex items-center space-x-1 bg-theme-surface-elevated rounded-lg px-2.5 py-1 border border-theme-border text-xs font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-theme-accent" />
            <span className="text-theme-muted text-[11px]">Role:</span>
            {import.meta.env?.DEV ? (
              <select
                id="rbac-role-selector"
                value={currentRole || 'OWNER'}
                onChange={(e) => setCurrentRole(e.target.value as UserRole)}
                className="bg-transparent text-theme-primary font-medium focus:outline-none cursor-pointer text-xs uppercase"
              >
                <option value="OWNER" className="bg-theme-surface text-theme-primary">OWNER (Exec)</option>
                <option value="ADMIN" className="bg-theme-surface text-theme-primary">ADMIN (Ops)</option>
                <option value="MANAGER" className="bg-theme-surface text-theme-primary">MANAGER</option>
                <option value="STAFF" className="bg-theme-surface text-theme-primary">STAFF</option>
                <option value="VIEWER" className="bg-theme-surface text-theme-primary">VIEWER (RO)</option>
              </select>
            ) : (
              <span id="rbac-role-badge" className="text-theme-primary font-medium text-xs uppercase">
                {currentRole || 'UNAUTHENTICATED'}
              </span>
            )}
          </div>

          {/* Theme Switcher Toggle (Dark / Light / System) */}
          <div className="flex items-center bg-theme-surface-elevated rounded-lg p-1 border border-theme-border text-xs font-mono">
            <button
              id="theme-btn-dark"
              onClick={() => setTheme('dark')}
              title="Obsidian Dark Theme"
              className={`p-1.5 rounded transition-all cursor-pointer ${
                theme === 'dark'
                  ? 'bg-theme-surface text-theme-accent shadow-xs'
                  : 'text-theme-muted hover:text-theme-primary'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
            </button>
            <button
              id="theme-btn-light"
              onClick={() => setTheme('light')}
              title="Warm Ivory Light Theme"
              className={`p-1.5 rounded transition-all cursor-pointer ${
                theme === 'light'
                  ? 'bg-theme-surface text-theme-accent shadow-xs'
                  : 'text-theme-muted hover:text-theme-primary'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
            </button>
            <button
              id="theme-btn-system"
              onClick={() => setTheme('system')}
              title="System OS Theme"
              className={`p-1.5 rounded transition-all cursor-pointer ${
                theme === 'system'
                  ? 'bg-theme-surface text-theme-accent shadow-xs'
                  : 'text-theme-muted hover:text-theme-primary'
              }`}
            >
              <Laptop className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Language Switcher (EN / TR) */}
          <div className="flex items-center bg-theme-surface-elevated rounded-lg p-1 border border-theme-border">
            <button
              id="lang-toggle-en"
              onClick={() => setLanguage('en')}
              className={`px-2 py-1 rounded text-[11px] font-mono font-bold transition-all cursor-pointer ${
                language === 'en' ? 'bg-theme-surface text-theme-primary shadow-xs' : 'text-theme-muted hover:text-theme-primary'
              }`}
            >
              EN
            </button>
            <button
              id="lang-toggle-tr"
              onClick={() => setLanguage('tr')}
              className={`px-2 py-1 rounded text-[11px] font-mono font-bold transition-all cursor-pointer ${
                language === 'tr' ? 'bg-theme-surface text-theme-primary shadow-xs' : 'text-theme-muted hover:text-theme-primary'
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
            className="flex items-center space-x-1.5 bg-theme-surface-elevated hover:bg-theme-surface-muted text-theme-primary px-3 py-1.5 rounded-lg border border-theme-border text-xs font-mono transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-theme-accent ${isScanning ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isScanning ? t.common.loading : 'Scan'}</span>
          </button>
        </div>

      </div>
    </header>
  );
};
