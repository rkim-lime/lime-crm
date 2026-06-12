import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useConvertLead } from '../hooks/useLeads';
import { useCreateDeal } from '../hooks/useDeals';
import { useAccounts } from '../hooks/useAccounts';
import { useContacts } from '../hooks/useContacts';
import { FormField, FormSearchSelect, FormSelect, FormPillSelect, FormTextarea, FormGrid } from './Form';

const ASSET_CLASSES = [
  { value: 'equities', label: 'Equities' },
  { value: 'options',  label: 'Options' },
  { value: 'futures',  label: 'Futures' },
];

const TIER_INFO = {
  pro: {
    label: 'Pro',
    color: 'var(--tier-pro)',
    description: 'Proprietary traders, quant developers, and algo traders with direct API access.',
    pipeline: 'Pro Pipeline',
  },
  enterprise: {
    label: 'Enterprise',
    color: 'var(--tier-enterprise)',
    description: 'Institutional clients — HFT firms, hedge funds, broker-dealers, and family offices.',
    pipeline: 'Enterprise Pipeline',
  },
};

export default function ConvertLeadModal({ lead, onClose }) {
  const navigate = useNavigate();
  const [step, setStep]         = useState(1); // 1 | 2 | 3 | 'done'
  const [targetTier, setTargetTier] = useState('');
  const [conversionNotes, setConversionNotes] = useState('');
  const [createDeal, setCreateDeal] = useState(false);
  const [dealForm, setDealForm]   = useState({
    name: '',
    stage: 'prospecting',
    account_id: '',
    contact_id: lead?.contact_id ?? '',
    estimated_adv_usd: '',
    estimated_commission: '',
    probability: 50,
    asset_classes: lead?.asset_classes ?? [],
  });
  const [resultDealId, setResultDealId] = useState(null);

  const convert = useConvertLead();
  const accounts = useAccounts({});
  const contacts = useContacts({});

  const accountOpts = (accounts.data ?? []).map(a => ({ value: a.id, label: `${a.name}${a.tier ? ` · ${a.tier}` : ''}` }));
  const contactOpts = (contacts.data ?? []).map(c => ({ value: c.id, label: `${c.first_name} ${c.last_name}` }));

  const contactName = lead?.contact
    ? `${lead.contact.first_name} ${lead.contact.last_name}`
    : 'this contact';

  const handleConvert = async (withDeal) => {
    try {
      const result = await convert.mutateAsync({
        leadId:      lead.id,
        targetTier,
        createDeal:  withDeal,
        dealData:    withDeal ? {
          name:                 dealForm.name || `${contactName} — ${TIER_INFO[targetTier]?.label} Conversion`,
          stage:                dealForm.stage,
          account_id:           dealForm.account_id || null,
          contact_id:           dealForm.contact_id || null,
          asset_classes:        dealForm.asset_classes,
          estimated_adv_usd:    dealForm.estimated_adv_usd    !== '' ? Number(dealForm.estimated_adv_usd)    : null,
          estimated_commission: dealForm.estimated_commission !== '' ? Number(dealForm.estimated_commission) : null,
          probability:          Number(dealForm.probability),
        } : {},
        notes: conversionNotes,
      });
      setResultDealId(result.dealId);
      setStep('done');
    } catch (err) {
      // error surfaced via convert.error
    }
  };

  const setDeal = (k) => (v) => setDealForm(f => ({ ...f, [k]: v }));

  const INST_STAGES = [
    { value: 'prospecting',      label: 'Prospecting' },
    { value: 'qualified',        label: 'Qualified' },
    { value: 'proposal',         label: 'Proposal' },
    { value: 'legal_compliance', label: 'Legal & Compliance' },
    { value: 'negotiating',      label: 'Negotiating' },
    { value: 'onboarding',       label: 'Onboarding' },
  ];

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog"
        style={{ width: step === 3 ? 600 : 500, maxWidth: 'calc(100vw - 32px)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">
            {step === 1 && 'Convert Lead — Choose Target Tier'}
            {step === 2 && 'Conversion Options'}
            {step === 3 && 'Create Deal'}
            {step === 'done' && 'Lead Converted'}
          </span>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          {/* ── Step 1: Choose Tier ── */}
          {step === 1 && (
            <>
              <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 16 }}>
                Select the target tier for <strong>{contactName}</strong>.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                {['pro', 'enterprise'].map(tier => {
                  const info = TIER_INFO[tier];
                  return (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setTargetTier(tier)}
                      style={{
                        border: `2px solid ${targetTier === tier ? info.color : 'var(--border)'}`,
                        borderRadius: 10,
                        padding: '16px 18px',
                        background: targetTier === tier ? `color-mix(in srgb, ${info.color} 8%, var(--bg-primary))` : 'var(--bg-secondary)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'border-color .15s, background .15s',
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 700, color: info.color, marginBottom: 6 }}>
                        Convert to {info.label}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {info.description}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                        → {info.pipeline}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" disabled={!targetTier} onClick={() => setStep(2)}>
                  Next →
                </button>
              </div>
            </>
          )}

          {/* ── Step 2: Conversion options ── */}
          {step === 2 && (
            <>
              <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 16 }}>
                Converting <strong>{contactName}</strong> to{' '}
                <span style={{ color: TIER_INFO[targetTier]?.color, fontWeight: 600 }}>{TIER_INFO[targetTier]?.label}</span>.
              </p>

              {convert.error && (
                <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5', fontSize: 13, color: '#dc2626' }}>
                  {convert.error.message}
                </div>
              )}

              <div className="form-field">
                <label className="form-label">Conversion Notes (optional)</label>
                <textarea
                  className="form-input form-textarea"
                  rows={3}
                  value={conversionNotes}
                  onChange={e => setConversionNotes(e.target.value)}
                  placeholder="Why is this lead converting? Any context for the sales team…"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '12px 16px', height: 'auto' }}
                  disabled={convert.isPending}
                  onClick={() => { setCreateDeal(true); setStep(3); }}
                >
                  <div style={{ fontWeight: 600 }}>Convert & Create Deal</div>
                  <div style={{ fontSize: 11.5, opacity: .8, marginTop: 2 }}>Link to a new deal in the pipeline</div>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '12px 16px', height: 'auto' }}
                  disabled={convert.isPending}
                  onClick={() => handleConvert(false)}
                >
                  <div style={{ fontWeight: 600 }}>Convert Only</div>
                  <div style={{ fontSize: 11.5, opacity: .7, marginTop: 2 }}>You can link a deal later</div>
                </button>
              </div>

              <div className="modal-footer" style={{ marginTop: 16 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setStep(1)}>← Back</button>
              </div>
            </>
          )}

          {/* ── Step 3: Create deal ── */}
          {step === 3 && (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                Create a deal in the <strong>{TIER_INFO[targetTier]?.label}</strong> pipeline for{' '}
                <strong>{contactName}</strong>.
              </p>

              {convert.error && (
                <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5', fontSize: 13, color: '#dc2626' }}>
                  {convert.error.message}
                </div>
              )}

              <FormField
                label="Deal name"
                value={dealForm.name}
                onChange={setDeal('name')}
                placeholder={`${contactName} — ${TIER_INFO[targetTier]?.label} Conversion`}
              />
              <FormGrid>
                <FormSelect
                  label="Stage"
                  value={dealForm.stage}
                  onChange={setDeal('stage')}
                  options={INST_STAGES}
                />
                <FormField
                  label="Probability (%)"
                  type="number"
                  value={dealForm.probability}
                  onChange={v => setDeal('probability')(Number(v))}
                />
              </FormGrid>
              <FormSearchSelect
                label="Account"
                options={accountOpts}
                value={dealForm.account_id}
                onChange={setDeal('account_id')}
                placeholder="Search accounts…"
              />
              <FormSearchSelect
                label="Contact"
                options={contactOpts}
                value={dealForm.contact_id}
                onChange={setDeal('contact_id')}
                placeholder="Search contacts…"
              />
              <FormGrid>
                <FormField
                  label="Est. ADV (USD)"
                  type="number"
                  value={dealForm.estimated_adv_usd}
                  onChange={setDeal('estimated_adv_usd')}
                />
                <FormField
                  label="Est. Commission (USD)"
                  type="number"
                  value={dealForm.estimated_commission}
                  onChange={setDeal('estimated_commission')}
                />
              </FormGrid>
              <FormPillSelect
                label="Asset Classes"
                options={ASSET_CLASSES}
                value={dealForm.asset_classes}
                onChange={setDeal('asset_classes')}
              />

              <div className="modal-footer" style={{ marginTop: 16 }}>
                <button className="btn btn-secondary" onClick={() => setStep(2)} disabled={convert.isPending}>
                  ← Back
                </button>
                <button
                  className="btn btn-primary"
                  disabled={convert.isPending}
                  onClick={() => handleConvert(true)}
                >
                  {convert.isPending ? 'Converting…' : 'Confirm Conversion'}
                </button>
              </div>
            </>
          )}

          {/* ── Done ── */}
          {step === 'done' && (
            <>
              <div style={{ textAlign: 'center', padding: '24px 0 16px' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Lead converted successfully</div>
                <div style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
                  {contactName} has been converted to the{' '}
                  <span style={{ color: TIER_INFO[targetTier]?.color, fontWeight: 600 }}>{TIER_INFO[targetTier]?.label}</span> tier.
                </div>
              </div>
              <div className="modal-footer">
                {resultDealId && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => { onClose(); navigate(`/deals/${resultDealId}`); }}
                  >
                    View Deal →
                  </button>
                )}
                <button className="btn btn-primary" onClick={onClose}>Done</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
