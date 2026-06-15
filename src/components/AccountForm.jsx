import { useState } from 'react';
import SlidePanel from './SlidePanel';
import { FormField, FormSelect, FormPillRadio, FormTextarea, FormToggle, FormSection, FormGrid, FormSearchSelect } from './Form';
import { useCreateAccount, useUpdateAccount } from '../hooks/useAccounts';
import { useProfiles } from '../hooks/useDashboard';
import { useAuth } from '../hooks/useAuth.jsx';
import RoleGate from './RoleGate';

const RELEVANT_ASSET_LABELS = {
  equities:     'Equities',
  options:      'Options',
  futures:      'Futures',
  crypto:       'Crypto',
  fixed_income: 'Fixed Income',
  fx:           'FX',
  other:        'Other',
};

const RELEVANT_ASSET_STYLES = {
  equities:     { background: '#E6F1FB', color: '#185FA5' },
  options:      { background: '#EAF3DE', color: '#3B6D11' },
  futures:      { background: '#FAEEDA', color: '#854F0B' },
  crypto:       { background: '#F3E8FF', color: '#6B21A8' },
  fixed_income: { background: '#E0F2FE', color: '#0369A1' },
  fx:           { background: '#FFF7ED', color: '#C2410C' },
  other:        { background: '#F1F5F9', color: '#475569' },
};

const TIER_SEGMENTS = {
  enterprise: [
    { value: 'hft_firm',      label: 'HFT Firm' },
    { value: 'hedge_fund',    label: 'Hedge Fund' },
    { value: 'quant_fund',    label: 'Quant Fund' },
    { value: 'broker_dealer', label: 'Broker-Dealer' },
    { value: 'family_office', label: 'Family Office' },
    { value: 'prime_broker',  label: 'Prime Broker' },
  ],
  pro: [
    { value: 'prop_trader',     label: 'Prop Trader' },
    { value: 'quant_developer', label: 'Quant Developer' },
    { value: 'algo_trader',     label: 'Algo Trader' },
  ],
  individual: [
    { value: 'retail_trader', label: 'Retail Trader' },
  ],
};

const ORDER_ROUTING = [
  { value: 'sor',             label: 'Smart Order Routing' },
  { value: 'dma',             label: 'Direct Market Access' },
  { value: 'commission_free', label: 'Commission-Free' },
];

const blank = {
  name: '', tier: '', segment: '', status: 'prospect',
  legal_entity_name: '', lei: '', mpid: '', jurisdiction: '',
  relevant_asset_classes: [], sold_asset_classes: [], order_routing: '',
  colo: false, market_data: false, hosting: false, cross_connect: false,
  avg_daily_volume_usd: '', aum_usd: '', website: '', notes: '',
  kyc_status: 'not_started', aml_status: 'clear',
  accredited_investor: false, finra_member: false,
  sales_owner_id: '', service_manager_id: '',
};

function nullify(v) { return v === '' ? null : v; }

export default function AccountForm({ account, onClose, onSuccess }) {
  const isEdit = !!account;
  const { session } = useAuth();
  const currentUserId = session?.user?.id ?? '';

  const [form, setForm] = useState(isEdit ? {
    ...blank,
    name:              account.name              ?? '',
    tier:              account.tier              ?? '',
    segment:           account.segment           ?? '',
    status:            account.status            ?? 'prospect',
    legal_entity_name: account.legal_entity_name ?? '',
    lei:               account.lei               ?? '',
    mpid:              account.mpid              ?? '',
    jurisdiction:      account.jurisdiction      ?? '',
    relevant_asset_classes: account.relevant_asset_classes ?? [],
    sold_asset_classes:     account.sold_asset_classes     ?? [],
    order_routing:     account.order_routing?.[0] ?? '',
    colo:              account.colo              ?? false,
    market_data:       account.market_data       ?? false,
    hosting:           account.hosting           ?? false,
    cross_connect:     account.cross_connect     ?? false,
    avg_daily_volume_usd: account.avg_daily_volume_usd ?? '',
    aum_usd:           account.aum_usd           ?? '',
    website:           account.website           ?? '',
    notes:             account.notes             ?? '',
    kyc_status:        account.kyc_status        ?? 'not_started',
    aml_status:        account.aml_status        ?? 'clear',
    accredited_investor: account.accredited_investor ?? false,
    finra_member:      account.finra_member      ?? false,
    sales_owner_id:    account.sales_owner_id    ?? '',
    service_manager_id: account.service_manager_id ?? '',
  } : { ...blank, sales_owner_id: currentUserId });

  const [errors, setErrors] = useState({});
  const set = (k) => (v) => { setForm(f => ({ ...f, [k]: v })); if (errors[k]) setErrors(e => ({ ...e, [k]: '' })); };
  const setTier = (v) => { setForm(f => ({ ...f, tier: v, segment: '' })); if (errors.tier) setErrors(e => ({ ...e, tier: '' })); };

  const create = useCreateAccount();
  const update = useUpdateAccount();
  const saving = create.isPending || update.isPending;

  const profiles = useProfiles();
  const profileOpts = (profiles.data ?? []).map(p => ({
    value: p.id,
    label: p.full_name || p.email || 'Unknown',
  }));

  const validate = () => {
    const e = {};
    if (!form.name.trim())    e.name           = 'Name is required';
    if (!form.tier)           e.tier           = 'Tier is required';
    if (!form.segment)        e.segment        = 'Segment is required';
    if (!form.sales_owner_id) e.sales_owner_id = 'Sales Owner is required';
    return e;
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    const payload = {
      name:              form.name.trim(),
      tier:              form.tier,
      segment:           form.segment,
      status:            form.status,
      legal_entity_name: nullify(form.legal_entity_name),
      lei:               nullify(form.lei),
      mpid:              nullify(form.mpid),
      jurisdiction:      nullify(form.jurisdiction),
      relevant_asset_classes: form.relevant_asset_classes ?? [],
      sold_asset_classes:     form.sold_asset_classes     ?? [],
      order_routing:     form.order_routing ? [form.order_routing] : [],
      colo:              form.colo,
      market_data:       form.market_data,
      hosting:           form.hosting,
      cross_connect:     form.cross_connect,
      avg_daily_volume_usd: form.avg_daily_volume_usd !== '' ? Number(form.avg_daily_volume_usd) : null,
      aum_usd:           form.aum_usd !== '' ? Number(form.aum_usd) : null,
      website:           nullify(form.website),
      notes:             nullify(form.notes),
      kyc_status:        form.kyc_status || 'not_started',
      aml_status:        form.aml_status || 'clear',
      accredited_investor: form.accredited_investor,
      finra_member:      form.finra_member,
      tags:              [],
      sales_owner_id:    form.sales_owner_id || null,
      service_manager_id: form.service_manager_id || null,
    };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: account.id, ...payload });
      } else {
        await create.mutateAsync(payload);
      }
      onSuccess?.();
      onClose();
    } catch (err) {
      setErrors({ _global: err.message });
    }
  };

  const segments = TIER_SEGMENTS[form.tier] ?? [];
  const upsellGap = (form.relevant_asset_classes ?? []).filter(c =>
    ['equities', 'options', 'futures'].includes(c) &&
    !(form.sold_asset_classes ?? []).includes(c)
  );

  return (
    <SlidePanel
      title={isEdit ? 'Edit Account' : 'New Account'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="account-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create account'}
          </button>
        </>
      }
    >
      <form id="account-form" onSubmit={submit}>
        <div style={{ padding: '20px 24px' }}>
          {errors._global && (
            <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5', fontSize: 13, color: '#dc2626' }}>
              {errors._global}
            </div>
          )}

          <FormSection title="Basic info" />
          <FormField label="Account name" value={form.name} onChange={set('name')} error={errors.name} required placeholder="e.g. Citadel Securities" />
          <FormGrid>
            <FormSelect label="Tier" value={form.tier} onChange={setTier} error={errors.tier} required
              options={[{ value:'enterprise',label:'Enterprise' },{ value:'pro',label:'Pro' },{ value:'individual',label:'Individual' }]} />
            <FormSelect label="Segment" value={form.segment} onChange={set('segment')} error={errors.segment} required
              options={segments} placeholder={form.tier ? 'Select segment…' : 'Select tier first…'} />
          </FormGrid>
          <FormGrid>
            <FormSelect label="Status" value={form.status} onChange={set('status')}
              options={['prospect','active','inactive','suspended','churned'].map(s => ({ value: s, label: s }))} />
            <FormField label="Jurisdiction" value={form.jurisdiction} onChange={set('jurisdiction')} placeholder="e.g. US, GB, SG" />
          </FormGrid>

          <FormSection title="Ownership" />
          <FormSearchSelect
            label="Sales Owner"
            options={profileOpts}
            value={form.sales_owner_id}
            onChange={set('sales_owner_id')}
            error={errors.sales_owner_id}
            placeholder="Assign sales owner…"
            required
          />
          <FormSearchSelect
            label="Service Manager"
            options={profileOpts}
            value={form.service_manager_id}
            onChange={set('service_manager_id')}
            placeholder="Assign when deal reaches Onboarding"
          />
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: -8, marginBottom: 12 }}>
            Required before account can go Live
          </div>

          <FormSection title="Legal" />
          <FormField label="Legal entity name" value={form.legal_entity_name} onChange={set('legal_entity_name')} />
          <FormGrid>
            <FormField label="LEI" value={form.lei} onChange={set('lei')} placeholder="20-char LEI code" />
            <FormField label="MPID" value={form.mpid} onChange={set('mpid')} />
          </FormGrid>

          <FormSection title="Trading profile" />

          {/* Relevant Asset Classes */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', fontWeight: '500', display: 'block', marginBottom: '6px' }}>
              Relevant Asset Classes
            </label>
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
              All asset classes this client trades or has in their strategy
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {['equities','options','futures','crypto','fixed_income','fx','other'].map(cls => {
                const active = (form.relevant_asset_classes ?? []).includes(cls);
                return (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => {
                      const current = form.relevant_asset_classes ?? [];
                      const updated = current.includes(cls)
                        ? current.filter(c => c !== cls)
                        : [...current, cls];
                      setForm(f => ({ ...f, relevant_asset_classes: updated }));
                    }}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: '500',
                      border: active
                        ? `2px solid ${RELEVANT_ASSET_STYLES[cls]?.color}`
                        : '1px solid #e5e5e5',
                      background: active
                        ? RELEVANT_ASSET_STYLES[cls]?.background
                        : 'transparent',
                      color: active
                        ? RELEVANT_ASSET_STYLES[cls]?.color
                        : 'var(--text-secondary)',
                    }}
                  >
                    {RELEVANT_ASSET_LABELS[cls]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contracted Asset Classes */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', fontWeight: '500', display: 'block', marginBottom: '6px' }}>
              Contracted Asset Classes
            </label>
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
              Asset classes we have sold and enabled for this client
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {['equities','options','futures'].map(cls => {
                const active = (form.sold_asset_classes ?? []).includes(cls);
                return (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => {
                      const current = form.sold_asset_classes ?? [];
                      const updated = current.includes(cls)
                        ? current.filter(c => c !== cls)
                        : [...current, cls];
                      setForm(f => ({ ...f, sold_asset_classes: updated }));
                    }}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: '500',
                      border: active ? '2px solid #185FA5' : '1px solid #e5e5e5',
                      background: active ? '#E6F1FB' : 'transparent',
                      color: active ? '#185FA5' : 'var(--text-secondary)',
                    }}
                  >
                    {cls.charAt(0).toUpperCase() + cls.slice(1)}
                  </button>
                );
              })}
            </div>
            {upsellGap.length > 0 && (
              <div style={{ marginTop: '8px', padding: '8px 10px', background: '#FAEEDA', borderRadius: '4px', fontSize: '12px', color: '#854F0B' }}>
                💡 Upsell opportunity: {upsellGap.map(c => RELEVANT_ASSET_LABELS[c] || c).join(', ')}
              </div>
            )}
          </div>

          <FormPillRadio label="Order routing" options={ORDER_ROUTING} value={form.order_routing} onChange={set('order_routing')} />
          <FormGrid>
            <FormField label="ADV (USD)" type="number" value={form.avg_daily_volume_usd} onChange={set('avg_daily_volume_usd')} placeholder="e.g. 5000000" />
            <FormField label="AUM (USD)" type="number" value={form.aum_usd} onChange={set('aum_usd')} placeholder="e.g. 1000000000" />
          </FormGrid>
          <FormField label="Website" value={form.website} onChange={set('website')} placeholder="https://…" />

          <FormSection title="Infrastructure" />
          <FormGrid>
            <FormToggle label="Colocation"    checked={form.colo}          onChange={set('colo')} />
            <FormToggle label="Market Data"   checked={form.market_data}   onChange={set('market_data')} />
          </FormGrid>
          <FormGrid>
            <FormToggle label="Hosting"       checked={form.hosting}       onChange={set('hosting')} />
            <FormToggle label="Cross-Connect" checked={form.cross_connect} onChange={set('cross_connect')} />
          </FormGrid>

          <FormTextarea label="Notes" value={form.notes} onChange={set('notes')} rows={3} />

          <RoleGate allow={['admin','compliance','operations']}>
            <FormSection title="Compliance" />
            <FormGrid>
              <FormSelect label="KYC status" value={form.kyc_status} onChange={set('kyc_status')}
                options={['not_started','in_progress','pending_review','approved','rejected','expired'].map(s => ({ value:s,label:s.replace(/_/g,' ') }))} />
              <FormSelect label="AML status" value={form.aml_status} onChange={set('aml_status')}
                options={['clear','flagged','under_review','escalated'].map(s => ({ value:s,label:s.replace(/_/g,' ') }))} />
            </FormGrid>
            <FormToggle label="Accredited investor" checked={form.accredited_investor} onChange={set('accredited_investor')} />
            <FormToggle label="FINRA member"        checked={form.finra_member}        onChange={set('finra_member')} />
          </RoleGate>
        </div>

      </form>
    </SlidePanel>
  );
}
