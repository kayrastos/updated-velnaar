import React, { useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { AppointmentStatus, AppointmentSource, Appointment } from '../types/appointment';
import { 
  Calendar, 
  Clock, 
  Plus, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  RefreshCw, 
  User, 
  Sparkles, 
  Layers, 
  ExternalLink,
  ShieldCheck,
  ChevronRight,
  Filter
} from 'lucide-react';
import { mockConnectorsList } from '../services/appointmentEngine';

export const AppointmentsView: React.FC = () => {
  const { 
    appointments, 
    createManualAppointment, 
    updateAppointmentStatus, 
    activeTemplate, 
    formatCurrency, 
    t 
  } = usePlatform();

  const [activeTab, setActiveTab] = useState<'upcoming' | 'noshow' | 'completed' | 'all'>('upcoming');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);

  // Fast Creation Form State
  const [customerName, setCustomerName] = useState('');
  const [serviceName, setServiceName] = useState(
    activeTemplate.industryName.includes('Salon') ? 'Signature Laser Treatment' :
    activeTemplate.industryName.includes('Dining') ? 'Terrace Dining Reservation' : 'VIP Vehicle Test Drive'
  );
  const [serviceCategory, setServiceCategory] = useState('Standard Service');
  const [staffName, setStaffName] = useState(activeTemplate.resources[0]?.name || 'Senior Specialist');
  const [scheduledStart, setScheduledStart] = useState('2026-08-24T14:30');
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [expectedValue, setExpectedValue] = useState<number>(activeTemplate.currency === 'TRY' ? 4500 : 850);
  const [notes, setNotes] = useState('');

  // Filtered Appointments
  const filteredAppointments = appointments.filter(apt => {
    if (activeTab === 'upcoming') {
      return apt.status === 'scheduled' || apt.status === 'confirmed' || apt.status === 'in_progress';
    }
    if (activeTab === 'noshow') {
      return apt.status === 'no_show' || apt.status === 'cancelled';
    }
    if (activeTab === 'completed') {
      return apt.status === 'completed';
    }
    return true;
  });

  const handleQuickCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) return;

    createManualAppointment({
      customerName,
      serviceName,
      serviceCategory,
      resourceStaffName: staffName,
      scheduledStart: new Date(scheduledStart).toISOString(),
      durationMinutes: Number(durationMinutes),
      expectedValueMinor: Math.round(Number(expectedValue) * 100),
      currency: activeTemplate.currency,
      notes,
    });

    setCustomerName('');
    setNotes('');
    setIsCreateModalOpen(false);
  };

  const getStatusBadge = (status: AppointmentStatus) => {
    switch (status) {
      case 'confirmed':
      case 'scheduled':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Confirmed</span>;
      case 'in_progress':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span> In Progress</span>;
      case 'completed':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-500/30 flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" /> Completed</span>;
      case 'no_show':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-red-500/15 text-red-600 dark:text-red-300 border border-red-500/30 flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" /> No-Show</span>;
      case 'cancelled':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-theme-surface-elevated text-theme-muted border border-theme-border flex items-center gap-1"><XCircle className="w-2.5 h-2.5" /> Cancelled</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-theme-surface-elevated text-theme-secondary">{status}</span>;
    }
  };

  const getSourceBadge = (source: AppointmentSource) => {
    switch (source) {
      case 'velnar_manual':
        return <span className="text-[10px] font-mono text-theme-accent bg-theme-surface-elevated px-2 py-0.5 rounded border border-theme-border">VELNAR Fast Entry</span>;
      case 'google_calendar':
        return <span className="text-[10px] font-mono text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/30">Google Calendar</span>;
      case 'opentable':
        return <span className="text-[10px] font-mono text-red-500 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/30">OpenTable Dining</span>;
      case 'external_provider':
        return <span className="text-[10px] font-mono text-purple-500 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/30">EMR / Dealership Bridge</span>;
      default:
        return <span className="text-[10px] font-mono text-theme-muted bg-theme-surface px-2 py-0.5 rounded">{source}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-theme-surface p-5 rounded-xl border border-theme-border">
        <div>
          <div className="flex items-center space-x-2 text-[10px] font-mono tracking-widest text-theme-accent uppercase">
            <Calendar className="w-3.5 h-3.5" />
            <span>OPERATIONAL CAPACITY & APPOINTMENT ENGINE</span>
          </div>
          <h1 className="text-xl font-medium text-theme-primary mt-1">
            {t.appointments.title}
          </h1>
          <p className="text-xs text-theme-secondary mt-1 max-w-2xl">
            {t.appointments.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center space-x-2 px-4 py-2.5 rounded-lg bg-theme-accent text-black font-medium text-xs hover:bg-theme-accent/90 transition-colors cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>{t.appointments.newAppointment}</span>
          </button>
        </div>
      </div>

      {/* Top Telemetry Cards: Capacity Utilization & Connectors */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Capacity Window Barometer */}
        <div className="bg-theme-surface p-4 rounded-xl border border-theme-border">
          <div className="flex items-center justify-between text-xs text-theme-secondary font-mono mb-2">
            <span>Current Capacity Utilization</span>
            <span className="text-theme-accent font-bold">{activeTemplate.capacityUtilization.overallUtilizationPct}%</span>
          </div>
          <div className="w-full bg-theme-surface-elevated h-2 rounded-full overflow-hidden mb-2">
            <div 
              className="bg-theme-accent h-full rounded-full transition-all duration-500"
              style={{ width: `${activeTemplate.capacityUtilization.overallUtilizationPct}%` }}
            ></div>
          </div>
          <div className="text-[11px] text-theme-muted flex items-center justify-between">
            <span>Peak: {activeTemplate.capacityUtilization.peakWindow.windowLabel} ({activeTemplate.capacityUtilization.peakWindow.utilizationPct}%)</span>
            <span className="text-amber-500">Lowest: {activeTemplate.capacityUtilization.lowestWindow.utilizationPct}%</span>
          </div>
        </div>

        {/* Off-Peak Leak Detection Alert */}
        <div className="bg-theme-surface p-4 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-transparent">
          <div className="flex items-center space-x-2 text-xs font-mono text-amber-500 mb-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Off-Peak Capacity Warning</span>
          </div>
          <p className="text-xs text-theme-primary leading-relaxed">
            {activeTemplate.capacityUtilization.lowestWindow.windowLabel} shows {activeTemplate.capacityUtilization.lowestWindow.utilizationPct}% utilization.
          </p>
          <div className="text-[11px] text-theme-secondary mt-1">
            Est. Monthly Gap: <strong className="text-amber-600 dark:text-amber-300">{formatCurrency(activeTemplate.capacityUtilization.lowestWindow.potentialRevenueLossMinor / 100)}</strong>
          </div>
        </div>

        {/* Live Connector Status */}
        <div className="bg-theme-surface p-4 rounded-xl border border-theme-border flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-mono text-theme-secondary mb-2">
              <span className="flex items-center gap-1.5"><RefreshCw className="w-3 h-3 text-emerald-500" /> Connected Ingestion Channels</span>
              <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">3 Active</span>
            </div>
            <div className="space-y-1.5">
              {mockConnectorsList.slice(0, 2).map(c => (
                <div key={c.id} className="flex items-center justify-between text-[11px] text-theme-secondary bg-theme-surface-elevated px-2.5 py-1 rounded border border-theme-border">
                  <span className="truncate">{c.name}</span>
                  <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">Synced</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs & Table */}
      <div className="bg-theme-surface rounded-xl border border-theme-border overflow-hidden">
        {/* Navigation Tabs */}
        <div className="flex border-b border-theme-border px-4 pt-3 gap-2 bg-theme-surface-elevated">
          <button
            onClick={() => setActiveTab('upcoming')}
            className={`px-3.5 py-2 text-xs font-mono rounded-t-lg transition-colors cursor-pointer ${
              activeTab === 'upcoming'
                ? 'bg-theme-surface text-theme-primary border-t border-x border-theme-border font-semibold'
                : 'text-theme-muted hover:text-theme-primary'
            }`}
          >
            {t.appointments.upcomingTab} ({appointments.filter(a => a.status === 'confirmed' || a.status === 'scheduled').length})
          </button>
          <button
            onClick={() => setActiveTab('noshow')}
            className={`px-3.5 py-2 text-xs font-mono rounded-t-lg transition-colors cursor-pointer ${
              activeTab === 'noshow'
                ? 'bg-theme-surface text-red-500 border-t border-x border-theme-border font-semibold'
                : 'text-theme-muted hover:text-theme-primary'
            }`}
          >
            {t.appointments.noShowTab} ({appointments.filter(a => a.status === 'no_show' || a.status === 'cancelled').length})
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`px-3.5 py-2 text-xs font-mono rounded-t-lg transition-colors cursor-pointer ${
              activeTab === 'completed'
                ? 'bg-theme-surface text-blue-500 border-t border-x border-theme-border font-semibold'
                : 'text-theme-muted hover:text-theme-primary'
            }`}
          >
            {t.appointments.completedTab} ({appointments.filter(a => a.status === 'completed').length})
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3.5 py-2 text-xs font-mono rounded-t-lg transition-colors cursor-pointer ${
              activeTab === 'all'
                ? 'bg-theme-surface text-theme-primary border-t border-x border-theme-border font-semibold'
                : 'text-theme-muted hover:text-theme-primary'
            }`}
          >
            {t.appointments.allTab} ({appointments.length})
          </button>
        </div>

        {/* Appointment Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-theme-border text-[10px] font-mono text-theme-muted uppercase bg-theme-surface-elevated/50">
                <th className="py-3 px-4">{t.appointments.customer}</th>
                <th className="py-3 px-4">{t.appointments.service}</th>
                <th className="py-3 px-4">{t.appointments.staffResource}</th>
                <th className="py-3 px-4">{t.appointments.dateTime}</th>
                <th className="py-3 px-4">{t.appointments.expectedValue}</th>
                <th className="py-3 px-4">{t.appointments.source}</th>
                <th className="py-3 px-4">{t.appointments.status}</th>
                <th className="py-3 px-4 text-right">{t.appointments.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-border text-xs">
              {filteredAppointments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-theme-muted font-mono">
                    No appointments in this category.
                  </td>
                </tr>
              ) : (
                filteredAppointments.map((apt) => (
                  <tr key={apt.id} className="hover:bg-theme-surface-elevated/60 transition-colors">
                    <td className="py-3.5 px-4 font-medium text-theme-primary">
                      <div className="flex items-center space-x-2">
                        <div className="w-6 h-6 rounded-full bg-theme-surface-elevated flex items-center justify-center text-[10px] font-mono text-theme-accent border border-theme-border">
                          {apt.customerName.charAt(0)}
                        </div>
                        <div>
                          <div>{apt.customerName}</div>
                          <div className="text-[10px] font-mono text-theme-muted">{apt.customerPseudonymId}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="text-theme-primary font-medium">{apt.serviceName}</div>
                      <div className="text-[10px] text-theme-muted">{apt.serviceCategory}</div>
                    </td>
                    <td className="py-3.5 px-4 text-theme-secondary">
                      {apt.resourceStaffName}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-mono text-theme-primary">
                        {new Date(apt.scheduledStart).toLocaleDateString()} {new Date(apt.scheduledStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="text-[10px] font-mono text-theme-muted">{apt.durationMinutes} mins</div>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-medium text-theme-accent">
                      {formatCurrency(apt.expectedValueMinor / 100)}
                    </td>
                    <td className="py-3.5 px-4">
                      {getSourceBadge(apt.source)}
                    </td>
                    <td className="py-3.5 px-4">
                      {getStatusBadge(apt.status)}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        {apt.status === 'confirmed' && (
                          <>
                            <button
                              onClick={() => updateAppointmentStatus(apt.id, 'completed')}
                              title="Mark Completed"
                              className="px-2 py-1 rounded bg-theme-surface-elevated hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-theme-border hover:border-emerald-500/40 text-[10px] font-mono transition-colors"
                            >
                              Complete
                            </button>
                            <button
                              onClick={() => updateAppointmentStatus(apt.id, 'no_show', 'Customer did not show up')}
                              title="Mark No-Show"
                              className="px-2 py-1 rounded bg-theme-surface-elevated hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-theme-border hover:border-red-500/40 text-[10px] font-mono transition-colors"
                            >
                              No-Show
                            </button>
                          </>
                        )}
                        {apt.status === 'no_show' && (
                          <button
                            onClick={() => {
                              // Trigger Rebooking sequence
                              alert('Triggered automated 1-click re-engagement sequence via WhatsApp/SMS.');
                            }}
                            className="px-2.5 py-1 rounded bg-theme-accent/10 hover:bg-theme-accent/20 text-theme-accent border border-theme-border text-[10px] font-mono flex items-center gap-1"
                          >
                            <Sparkles className="w-2.5 h-2.5" /> Re-engage
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fast Manual Appointment Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-theme-surface border border-theme-border rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-theme-border pb-3">
              <div>
                <h3 className="text-base font-medium text-theme-primary">
                  {t.appointments.quickCreate}
                </h3>
                <p className="text-xs text-theme-secondary">
                  {t.appointments.quickCreateSub}
                </p>
              </div>
              <button 
                onClick={() => setIsCreateModalOpen(false)}
                className="text-theme-muted hover:text-theme-primary cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleQuickCreate} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[11px] font-mono text-theme-secondary mb-1">
                  Customer Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Zeynep Yılmaz"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full bg-theme-surface-elevated border border-theme-border rounded-lg px-3 py-2 text-theme-primary focus:outline-none focus:border-theme-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-mono text-theme-secondary mb-1">
                    Service / Item
                  </label>
                  <input
                    type="text"
                    required
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    className="w-full bg-theme-surface-elevated border border-theme-border rounded-lg px-3 py-2 text-theme-primary focus:outline-none focus:border-theme-accent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-theme-secondary mb-1">
                    Staff / Resource
                  </label>
                  <input
                    type="text"
                    required
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    className="w-full bg-theme-surface-elevated border border-theme-border rounded-lg px-3 py-2 text-theme-primary focus:outline-none focus:border-theme-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-mono text-theme-secondary mb-1">
                    Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={scheduledStart}
                    onChange={(e) => setScheduledStart(e.target.value)}
                    className="w-full bg-theme-surface-elevated border border-theme-border rounded-lg px-2 py-2 text-theme-primary font-mono focus:outline-none focus:border-theme-accent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-theme-secondary mb-1">
                    Duration (mins)
                  </label>
                  <input
                    type="number"
                    min="15"
                    step="15"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="w-full bg-theme-surface-elevated border border-theme-border rounded-lg px-3 py-2 text-theme-primary font-mono focus:outline-none focus:border-theme-accent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-theme-secondary mb-1">
                    Value ({activeTemplate.currencySymbol})
                  </label>
                  <input
                    type="number"
                    value={expectedValue}
                    onChange={(e) => setExpectedValue(Number(e.target.value))}
                    className="w-full bg-theme-surface-elevated border border-theme-border rounded-lg px-3 py-2 text-theme-primary font-mono focus:outline-none focus:border-theme-accent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-theme-secondary mb-1">
                  Operational Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Special requests, treatment details, or table preferences..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-theme-surface-elevated border border-theme-border rounded-lg px-3 py-2 text-theme-primary focus:outline-none focus:border-theme-accent"
                />
              </div>

              <div className="pt-3 flex items-center justify-end space-x-2 border-t border-theme-border">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-theme-surface-elevated text-theme-secondary hover:text-theme-primary cursor-pointer border border-theme-border"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-theme-accent text-black font-medium hover:bg-theme-accent/90 cursor-pointer shadow-xs"
                >
                  Create Appointment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
