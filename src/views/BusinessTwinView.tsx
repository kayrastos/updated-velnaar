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
      <div className="bg-[#0D0F15] p-5 rounded-xl border border-[#232732] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <BrainCircuit className="w-5 h-5 text-[#C5A880]" />
            <h1 className="text-xl font-editorial font-bold text-[#F5F4F0] tracking-wide">
              {t.businessTwin.title}
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#181C26] text-[#C5A880] border border-[#C5A880]/30 font-medium">
              {currentMarket} Fact Matrix
            </span>
          </div>
          <p className="text-xs text-[#8E909B] mt-1 max-w-2xl">
            {t.businessTwin.subtitle}
          </p>
        </div>

        <button
          id="btn-add-twin-fact"
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-2 bg-[#C5A880] hover:bg-[#D4AF37] text-black px-4 py-2 rounded-lg font-semibold text-xs font-mono transition-all cursor-pointer shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>{t.businessTwin.addNewFact}</span>
        </button>
      </div>

      {/* Accuracy & Grounding Barometer */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#0F121A] p-5 rounded-xl border border-[#232732]">
          <div className="text-xs font-mono text-[#C5A880] uppercase font-semibold mb-2">
            {t.businessTwin.confidenceScore}
          </div>
          <div className="text-3xl font-mono font-bold text-[#F5F4F0]">
            {metrics.twinConfidenceScore}%
          </div>
          <p className="text-[11px] text-[#8E909B] mt-2">
            Ratio of human-verified operational boundaries and parameters.
          </p>
        </div>

        <div className="bg-[#0F121A] p-5 rounded-xl border border-[#232732]">
          <div className="text-xs font-mono text-[#E6E4DC] uppercase font-semibold mb-2">
            {t.businessTwin.factsVerified}
          </div>
          <div className="text-3xl font-mono font-bold text-emerald-400">
            {facts.filter(f => f.verified_by_human === 1).length} / {facts.length}
          </div>
          <p className="text-[11px] text-[#8E909B] mt-2">
            Active grounding constraints loaded into the AI Gateway.
          </p>
        </div>

        <div className="bg-[#0F121A] p-5 rounded-xl border border-[#232732]">
          <div className="text-xs font-mono text-[#A1A4B2] uppercase font-semibold mb-2">
            Business Target
          </div>
          <div className="text-sm font-mono font-bold text-[#F5F4F0] truncate">
            {currentBusiness.name}
          </div>
          <p className="text-[11px] text-[#7E8292] mt-2">
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
              ? 'bg-[#1D2230] text-[#F5F4F0] border-[#C5A880]/50'
              : 'bg-[#0F121A] text-[#7E8292] border-[#232732] hover:text-[#D8D6CD]'
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
                ? 'bg-[#1D2230] text-[#F5F4F0] border-[#C5A880]/50'
                : 'bg-[#0F121A] text-[#7E8292] border-[#232732] hover:text-[#D8D6CD]'
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
              className="bg-[#0F121A] border border-[#232732] hover:border-[#C5A880]/40 rounded-xl p-5 space-y-3 transition-all"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#181C26] text-[#C5A880] border border-[#C5A880]/20 font-semibold">
                  {t.businessTwin.categories[fact.fact_category] || fact.fact_category}
                </span>

                {fact.verified_by_human === 1 ? (
                  <span className="text-xs font-mono text-emerald-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {t.businessTwin.verifiedByHuman}
                  </span>
                ) : (
                  <button
                    id={`verify-fact-${fact.id}`}
                    onClick={() => verifyFact(fact.id)}
                    className="text-xs font-mono text-[#D4AF37] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {t.businessTwin.verifyBtn}
                  </button>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[#F5F4F0]">
                  {fact.fact_key}
                </h3>
              </div>

              {/* JSON Fact Value Display */}
              <div className="bg-[#090A0E] p-3 rounded-lg border border-[#1E2230] font-mono text-xs text-[#D8D6CD]">
                <pre className="whitespace-pre-wrap">{JSON.stringify(parsedValue, null, 2)}</pre>
              </div>

              <div className="pt-2 border-t border-[#1C202B] flex items-center justify-between text-[10px] font-mono text-[#717585]">
                <span>Source: {fact.source}</span>
                <span className="text-[#C5A880]">Conf: {Math.round(fact.confidence_score * 100)}%</span>
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
            className="bg-[#0F121A] border border-[#2A2F40] rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold font-editorial text-[#F5F4F0]">
                {t.businessTwin.addNewFact}
              </h3>
              <button 
                type="button" 
                onClick={() => setShowAddModal(false)}
                className="text-[#8E909B] hover:text-[#FFF] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono">
              <div>
                <label className="block text-[#A1A4B2] mb-1">Fact Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as FactCategory)}
                  className="w-full bg-[#141622] text-[#F5F4F0] p-2.5 rounded-lg border border-[#262B3A] focus:outline-none"
                >
                  <option value="unit_economics">Unit Economics & Margins</option>
                  <option value="operating_constraints">Operating & Delivery Constraints</option>
                  <option value="ideal_customer_profile">Ideal Customer Profile (ICP)</option>
                  <option value="pricing_matrix">Pricing Matrix & Tiering</option>
                  <option value="regulatory_compliance">Regulatory Guardrails</option>
                </select>
              </div>

              <div>
                <label className="block text-[#A1A4B2] mb-1">Parameter Key / Title</label>
                <input
                  type="text"
                  placeholder="e.g. Max Gross Discount Allowance"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="w-full bg-[#141622] text-[#F5F4F0] p-2.5 rounded-lg border border-[#262B3A] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-[#A1A4B2] mb-1">Fact Value (Valid JSON)</label>
                <textarea
                  rows={4}
                  value={newValueJson}
                  onChange={(e) => setNewValueJson(e.target.value)}
                  className="w-full bg-[#141622] text-[#D8D6CD] p-2.5 rounded-lg border border-[#262B3A] focus:outline-none font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-[#A1A4B2] mb-1">Verification Source</label>
                <input
                  type="text"
                  placeholder="e.g. CFO 2026 Audit Report"
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value)}
                  className="w-full bg-[#141622] text-[#F5F4F0] p-2.5 rounded-lg border border-[#262B3A] focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-[#232736] flex justify-end space-x-3 text-xs font-mono">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-lg text-[#8E909B] hover:text-[#FFF] border border-[#282D3D] cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg font-semibold bg-[#C5A880] hover:bg-[#D4AF37] text-black cursor-pointer"
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
