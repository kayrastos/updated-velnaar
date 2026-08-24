/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PlatformProvider, usePlatform } from './context/PlatformContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { ProductLoopHUD } from './components/common/ProductLoopHUD';

// Views
import { DashboardView } from './views/DashboardView';
import { RevenueLeakRadarView } from './views/RevenueLeakRadarView';
import { GrowthActionsView } from './views/GrowthActionsView';
import { AppointmentsView } from './views/AppointmentsView';
import { AttributionEngineView } from './views/AttributionEngineView';
import { VelnarProofView } from './views/VelnarProofView';
import { LeadInboxView } from './views/LeadInboxView';
import { BusinessTwinView } from './views/BusinessTwinView';
import { SecurityGuardView } from './views/SecurityGuardView';
import { OnboardingView } from './views/OnboardingView';
import { SettingsView } from './views/SettingsView';

const MainContent: React.FC = () => {
  const { currentRoute } = usePlatform();

  return (
    <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto max-w-7xl mx-auto w-full">
      {currentRoute === '/dashboard' && <DashboardView />}
      {currentRoute === '/leaks' && <RevenueLeakRadarView />}
      {currentRoute === '/actions' && <GrowthActionsView />}
      {currentRoute === '/appointments' && <AppointmentsView />}
      {currentRoute === '/attribution' && <AttributionEngineView />}
      {currentRoute === '/proof' && <VelnarProofView />}
      {currentRoute === '/leads' && <LeadInboxView />}
      {currentRoute === '/business-twin' && <BusinessTwinView />}
      {currentRoute === '/security' && <SecurityGuardView />}
      {currentRoute === '/onboarding' && <OnboardingView />}
      {currentRoute === '/settings' && <SettingsView />}
    </main>
  );
};

export default function App() {
  return (
    <PlatformProvider>
      <div className="min-h-screen bg-[#090A0D] text-[#F5F4F0] flex flex-col font-sans selection:bg-[#C5A880]/30 selection:text-white">
        {/* Top Executive Header */}
        <Header />

        {/* 7-Step Core Product Loop HUD */}
        <ProductLoopHUD />

        {/* Workspace Body: Sidebar + Dynamic Main Content */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0">
          <Sidebar />
          <MainContent />
        </div>
      </div>
    </PlatformProvider>
  );
}
