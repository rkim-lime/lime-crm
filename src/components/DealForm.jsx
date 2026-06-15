import { useState } from 'react';
import SlidePanel, { PanelFooter } from './SlidePanel';
import { FormField, FormSelect, FormPillSelect, FormPillRadio, FormTextarea, FormToggle, FormSlider, FormSearchSelect, FormSection, FormGrid } from './Form';
import { useCreateDeal, useUpdateDeal } from '../hooks/useDeals';
import { useAccounts } from '../hooks/useAccounts';
import { useContacts } from '../hooks/useContacts';
import { useProfiles } from '../hooks/useDashboard';
import { useAuth } from '../hooks/useAuth.jsx';

const INST_STAGES = [
  {value:'prospecting',label:'Prospecting'},{value:'qualified',label:'Qualified'},
  {value:'proposal',label:'Proposal'},{value:'legal_compliance',label:'Legal & Compliance'},
  {value:'negotiating',label:'Negotiating'},{value:'onboarding',label:'Onboarding'},
  {value:'live',label:'Live'},{value:'lost',label:'Lost'},
];
const IND_STAGES = [
  {value:'lead_in',label:'Lead In'},{value:'engaged',label:'Engaged'},
  {value:'api_demo',label:'API Demo'},{value:'kyc_submitted',label:'KYC Submitted'},
  {value:'kyc_approved',label:'KYC Approved'},{value:'funded',label:'Funded'},
  {value:'first_trade',label:'First Trade'},{value:'active_trader',label:'Active Trader'},
  {value:'dormant',label:'Dormant'},
];

const ASSET_CLASSES = [
  {value:'equities',label:'Equities'},
  {value:'options',label:'Options'},
  {value:'futures',label:'Futures'},
];
const ORDER_ROUTING = [
  {value:'sor',label:'Smart Order Routing'},
  {value:'dma',label:'Direct Market Access'},
  {value:'commission_free',label:'Commission-Free'},
];
const MOTIONS = [{value:'enterprise',label:'Enterprise'},{value:'pro',label:'Pro'},{value:'individual',label:'Individual'}];

const blank = {
  name:'', tier:'', stage:'', motion:'enterprise',
  account_id:'', contact_id:'',
  estimated_adv_usd:'', estimated_commission:'', close_date:'',
  probability:50, asset_classes:[], order_routing:'',
  colo:false, market_data:false, hosting:false, cross_connect:false,
  notes:'', competitor:'', lost_reason:'',
  sales_owner_id:'',
};

export default function DealForm({ deal, defaultTier, onClose, onSuccess }) {
  const isEdit = !!deal;
  const { session } = useAuth();
  const currentUserId = session?.user?.id ?? '';

  const [form, setForm] = useState(isEdit ? {
    ...blank,
    name:              deal.name              ?? '',
    tier:              deal.tier              ?? defaultTier ?? '',
    stage:             deal.stage             ?? '',
    motion:            deal.motion            ?? 'enterprise',
    account_id:        deal.account_id        ?? '',
    contact_id:        deal.contact_id        ?? '',
    estimated_adv_usd:    deal.estimated_adv_usd    ?? '',
    estimated_commission: deal.estimated_commission ?? '',
    close_date:        deal.close_date        ?? '',
    probability:       deal.probability       ?? 50,
    asset_classes:     deal.asset_classes     ?? [],
    order_routing:     deal.order_routing?.[0] ?? '',
    colo:              deal.colo              ?? false,
    market_data:       deal.market_data       ?? false,
    hosting:           deal.hosting           ?? false,
    cross_connect:     deal.cross_connect     ?? false,
    notes:             deal.notes             ?? '',
    competitor:        deal.competitor        ?? '',
    lost_reason:       deal.lost_reason       ?? '',
    sales_owner_id:    deal.sales_owner_id    ?? '',
  } : { ...blank, tier: defaultTier ?? '', sales_owner_id: currentUserId });

  const [errors, setErrors] = useState({});
  const set = (k) => (v) => { setForm(f => ({ ...f, [k]: v })); if (errors[k]) setErrors(e => ({ ...e, [k]: '' })); };
  const setTier = (v) => { setForm(f => ({ ...f, tier: v, stage: '', motion: v || 'enterprise' })); };

  const create = useCreateDeal();
  const update = useUpdateDeal();
  const saving = create.isPending || update.isPending;

  const accounts = useAccounts({});
  const contacts = useContacts({});
  const profiles = useProfiles();

  const accountOpts = (accounts.data ?? []).map(a => ({ value: a.id, label: `${a.name}${a.tier ? ` · ${a.tier}` : ''}` }));
  const contactOpts = (contacts.data ?? []).map(c => ({ value: c.id, label: `${c.first_name} ${c.last_name}` }));
  const profileOpts = (profiles.data ?? []).map(p => ({ value: p.id, label: p.full_name || p.email || 'Unknown' }));

  const stages = form.tier === 'individual' ? IND_STAGES : INST_STAGES;
  const accountRequired = form.tier === 'enterprise' || form.tier === 'pro';

  const validate = () => {
    const e = {};
    if (!form.name.trim())    e.name           = 'Name is required';
    if (!form.tier)           e.tier           = 'Tier is required';
    if (!form.sales_owner_id) e.sales_owner_id = 'Sales Owner is required';
    if (accountRequired && !form.account_id) e.account_id = 'Account is required for Enterprise and Pro deals';
    return e;
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    const payload = {
      name:              form.name.trim(),
      tier:              form.tier,
      stage:             form.stage      || null,
      motion:            form.motion,
      account_id:        form.account_id || null,
      contact_id:        form.contact_id || null,
      estimated_adv_usd:    form.estimated_adv_usd    !== '' ? Number(form.estimated_adv_usd)    : null,
      estimated_commission: form.estimated_commission !== '' ? Number(form.estimated_commission) : null,
      close_date:        form.close_date || null,
      probability:       form.probability,
      asset_classes:     form.asset_classes,
      order_routing:     form.order_routing ? [form.order_routing] : [],
      colo:              form.colo,
      market_data:       form.market_data,
      hosting:           form.hosting,
      cross_connect:     form.cross_connect,
      notes:             form.notes      || null,
      competitor:        form.competitor || null,
      lost_reason:       form.lost_reason || null,
      sales_owner_id:    form.sales_owner_id || null,
    };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: deal.id, _prevStage: deal.stage, ...payload });
      } else {
        await create.mutateAsync(payload);
      }
      onSuccess?.();
      onClose();
    } catch (err) {
      setErrors({ _global: err.message });
    }
  };

  return (
    <SlidePanel title={isEdit ? 'Edit Deal' : 'New Deal'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{ padding: '20px 24px', flex: 1 }}>
          {errors._global && (
            <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5', fontSize: 13, color: '#dc2626' }}>
              {errors._global}
            </div>
          )}

          <FormSection title="Overview" />
          <FormField label="Deal name" value={form.name} onChange={set('name')} error={errors.name} required />
          <FormGrid>
            <FormSelect label="Tier" value={form.tier} onChange={setTier} error={errors.tier} required
              options={[{value:'enterprise',label:'Enterprise'},{value:'pro',label:'Pro'},{value:'individual',label:'Individual'}]} />
            <FormSelect label="Stage" value={form.stage} onChange={set('stage')} options={stages}
              placeholder={form.tier ? 'Select stage…' : 'Select tier first…'} />
          </FormGrid>
          <FormGrid>
            <FormSelect label="Motion" value={form.motion} onChange={set('motion')} options={MOTIONS} />
            <FormField label="Probability (%)" type="number" value={form.probability} onChange={v => set('probability')(Number(v))} />
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

          <FormSection title="Links" />
          <FormSearchSelect
            label={`Account${accountRequired ? ' *' : ''}`}
            options={accountOpts}
            value={form.account_id}
            onChange={set('account_id')}
            error={errors.account_id}
            placeholder="Search accounts…"
          />
          <FormSearchSelect label="Contact" options={contactOpts} value={form.contact_id} onChange={set('contact_id')} placeholder="Search contacts…" />

          <FormSection title="Financials" />
          <FormGrid>
            <FormField label="Est. ADV (USD)"        type="number" value={form.estimated_adv_usd}    onChange={set('estimated_adv_usd')} />
            <FormField label="Est. commission (USD)" type="number" value={form.estimated_commission} onChange={set('estimated_commission')} />
          </FormGrid>
          <FormField label="Close date" type="date" value={form.close_date} onChange={set('close_date')} />
          <FormSlider label="Probability" value={form.probability} onChange={set('probability')} />

          <FormSection title="Technical" />
          <FormPillSelect label="Asset classes" options={ASSET_CLASSES} value={form.asset_classes} onChange={set('asset_classes')} />
          <FormPillRadio label="Order routing" options={ORDER_ROUTING} value={form.order_routing} onChange={set('order_routing')} />
          <FormSection title="Infrastructure" />
          <FormGrid>
            <FormToggle label="Colocation"    checked={form.colo}          onChange={set('colo')} />
            <FormToggle label="Market Data"   checked={form.market_data}   onChange={set('market_data')} />
          </FormGrid>
          <FormGrid>
            <FormToggle label="Hosting"       checked={form.hosting}       onChange={set('hosting')} />
            <FormToggle label="Cross-Connect" checked={form.cross_connect} onChange={set('cross_connect')} />
          </FormGrid>

          <FormSection title="Notes" />
          <FormField label="Competitor" value={form.competitor} onChange={set('competitor')} />
          {(form.stage === 'lost' || form.stage === 'dormant') && (
            <FormField label="Lost reason" value={form.lost_reason} onChange={set('lost_reason')} />
          )}
          <FormTextarea label="Notes" value={form.notes} onChange={set('notes')} rows={3} />
        </div>

        <PanelFooter>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create deal'}
          </button>
        </PanelFooter>
      </form>
    </SlidePanel>
  );
}
