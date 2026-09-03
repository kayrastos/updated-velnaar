import React, { useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { FactCategory, BusinessTwinFactRow } from '../types/database';
import { 
  BrainCircuit, 
  Plus, 
  ShieldCheck, 
  Check, 
  Layers, 
  Database, 
  Lock, 
  Clock,
  X,
  FileCheck,
  Building,
  DollarSign
} from 'lucide-react';

export const BusinessTwinView: React.FC = () => {
  const { facts, verifyFact, addFact, currentBusiness, currentMarket, metrics, t } = usePlatform();
  
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newCategory, setNewCategory] = useState<FactCategory>('unit_economics');
  const [newKey, setNewKey] = useState<string>('');
  const [newValueJson, setNewValueJson] = useState<string>('{\n  "value": 100000,\n  "margin": "38%"\n}');
  const [newSource, setNewSource] = useState<string>('');

  const filteredFacts = facts.filter(fact => {
    if (selectedCategory !== 'all' && fact.fact_category !== selectedCategory) return false;
    return true;
  });

  const handleCreateFact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;

    try {
      JSON.parse(newValueJson); // validate JSON
    } catch (err) {
      alert('Invalid JSON in fact value field.');
      return;
    }

    addFact({
      fact_category: newCategory,
      fact_key: newKey,
      fact_value_json: newValueJson,
      confidence_score: 0.95,
      verified_by_human: 1,
      source: newSource || 'Manual Executive Ingestion',
    });

    setShowAddModal(false);
    setNewKey('');
    setNewSource('');
  };

  return (
    <div id="business-twin-view" className="space-y-6">
      
      {/* Header & Overview */}
      <div className="bg-theme-surface p-5 rounded-xl border border-theme-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <BrainCircuit className="w-5 h-5 text-theme-accent" />
            <h1 className="text-xl font-editorial font-bold text-theme-primary tracking-wide">
              {t.businessTwin.title}
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-theme-surface-elevated text-theme-accent border border-theme-border font-medium">
              {currentMarket} Fact Matrix
            </span>
          </div>
          <p className="text-xs text-theme-secondary mt-1 max-w-2xl">
            {t.businessTwin.subtitle}
          </p>
        </div>

        {import.meta.env.DEV ? (
          <button
            id="btn-add-twin-fact"
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-2 bg-theme-accent hover:bg-theme-accent/90 text-black px-4 py-2 rounded-lg font-semibold text-xs font-mono transition-all cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>{t.businessTwin.addNewFact}</span>
          </button>
        ) : (
          <div className="flex items-center space-x-1.5 text-xs font-mono text-theme-muted bg-theme-surface-elevated px-3 py-1.5 rounded-lg border border-theme-border">
            <Lock className="w-3.5 h-3.5 text-theme-accent" />
            <span>Canonical Ledger</span>
          </div>
        )}
      </div>

      {/* Accuracy & Grounding Barometer */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-theme-surface p-5 rounded-xl border border-theme-border">
          <div className="text-xs font-mono text-theme-accent uppercase font-semibold mb-2">
            {t.businessTwin.confidenceScore}
          </div>
          <div className="text-3xl font-mono font-bold text-theme-primary">
            {metrics.twinConfidenceScore}%
          </div>
          <p className="text-[11px] text-theme-secondary mt-2">
            Ratio of human-verified operational boundaries and parameters.
          </p>
        </div>

        <div className="bg-theme-surface p-5 rounded-xl border border-theme-border">
          <div className="text-xs font-mono text-theme-secondary uppercase font-semibold mb-2">
            {t.businessTwin.factsVerified}
          </div>
          <div className="text-3xl font-mono font-bold text-emerald-600 dark:text-emerald-400">
            {facts.filter(f => f.verified_by_human === 1).length} / {facts.length}
          </div>
          <p className="text-[11px] text-theme-secondary mt-2">
            Active grounding constraints loaded into the AI Gateway.
          </p>
        </div>

        <div className="bg-theme-surface p-5 rounded-xl border border-theme-border">
          <div className="text-xs font-mono text-theme-muted uppercase font-semibold mb-2">
            Business Target
          </div>
          <div className="text-sm font-mono font-bold text-theme-primary truncate">
            {currentBusiness?.name || 'Unselected'}
          </div>
          <p className="text-[11px] text-theme-muted mt-2">
            Segmented by {currentMarket} market currency and regulatory regime.
          </p>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 text-xs font-mono">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
            selectedCategory === 'all'
              ? 'bg-theme-surface-elevated text-theme-primary border-theme-accent/50'
              : 'bg-theme-surface text-theme-muted border-theme-border hover:text-theme-primary'
          }`}
        >
          All Domains ({facts.length})
        </button>
        {(['unit_economics', 'operating_constraints', 'ideal_customer_profile', 'pricing_matrix', 'regulatory_compliance'] as FactCategory[]).map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
              selectedCategory === cat
                ? 'bg-theme-surface-elevated text-theme-primary border-theme-accent/50'
                : 'bg-theme-surface text-theme-muted border-theme-border hover:text-theme-primary'
            }`}
          >
            {t.businessTwin.categories[cat] || cat}
          </button>
        ))}
      </div>

      {/* Fact Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredFacts.map((fact) => {
          let parsedValue: any = {};
          try {
            parsedValue = JSON.parse(fact.fact_value_json);
          } catch (e) {
            parsedValue = { raw: fact.fact_value_json };
          }

          return (
            <div
              key={fact.id}
              id={`fact-card-${fact.id}`}
              className="bg-theme-surface border border-theme-border hover:border-theme-accent/40 rounded-xl p-5 space-y-3 transition-all shadow-xs"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-theme-surface-elevated text-theme-accent border border-theme-border font-semibold">
                  {t.businessTwin.categories[fact.fact_category] || fact.fact_category}
                </span>

                {fact.verified_by_human === 1 ? (
                  <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {t.businessTwin.verifiedByHuman}
                  </span>
                ) : import.meta.env.DEV ? (
                  <button
                    id={`verify-fact-${fact.id}`}
                    onClick={() => verifyFact(fact.id)}
                    className="text-xs font-mono text-theme-accent hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {t.businessTwin.verifyBtn}
                  </button>
                ) : (
                  <span className="text-xs font-mono text-amber-500/90 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    Pending Audit
                  </span>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-theme-primary">
                  {fact.fact_key}
                </h3>
              </div>

              {/* JSON Fact Value Display */}
              <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border font-mono text-xs text-theme-secondary">
                <pre className="whitespace-pre-wrap">{JSON.stringify(parsedValue, null, 2)}</pre>
              </div>

              <div className="pt-2 border-t border-theme-border flex items-center justify-between text-[10px] font-mono text-theme-muted">
                <span>Source: {fact.source}</span>
                <span className="text-theme-accent">Conf: {Math.round(fact.confidence_score * 100)}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Fact Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <form 
            onSubmit={handleCreateFact}
            className="bg-theme-surface border border-theme-border rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold font-editorial text-theme-primary">
                {t.businessTwin.addNewFact}
              </h3>
              <button 
                type="button" 
                onClick={() => setShowAddModal(false)}
                className="text-theme-muted hover:text-theme-primary cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono">
              <div>
                <label className="block text-theme-secondary mb-1">Fact Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as FactCategory)}
                  className="w-full bg-theme-surface-elevated text-theme-primary p-2.5 rounded-lg border border-theme-border focus:outline-none"
                >
                  <option value="unit_economics">Unit Economics & Margins</option>
                  <option value="operating_constraints">Operating & Delivery Constraints</option>
                  <option value="ideal_customer_profile">Ideal Customer Profile (ICP)</option>
                  <option value="pricing_matrix">Pricing Matrix & Tiering</option>
                  <option value="regulatory_compliance">Regulatory Guardrails</option>
                </select>
              </div>

              <div>
                <label className="block text-theme-secondary mb-1">Parameter Key / Title</label>
                <input
                  type="text"
                  placeholder="e.g. Max Gross Discount Allowance"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="w-full bg-theme-surface-elevated text-theme-primary p-2.5 rounded-lg border border-theme-border focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-theme-secondary mb-1">Fact Value (Valid JSON)</label>
                <textarea
                  rows={4}
                  value={newValueJson}
                  onChange={(e) => setNewValueJson(e.target.value)}
                  className="w-full bg-theme-surface-elevated text-theme-secondary p-2.5 rounded-lg border border-theme-border focus:outline-none font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-theme-secondary mb-1">Verification Source</label>
                <input
                  type="text"
                  placeholder="e.g. CFO 2026 Audit Report"
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value)}
                  className="w-full bg-theme-surface-elevated text-theme-primary p-2.5 rounded-lg border border-theme-border focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-theme-border flex justify-end space-x-3 text-xs font-mono">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-lg text-theme-secondary hover:text-theme-primary border border-theme-border cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg font-semibold bg-theme-accent hover:bg-theme-accent/90 text-black cursor-pointer shadow-xs"
              >
                {t.common.save}
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
};
