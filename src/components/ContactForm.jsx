import { useState } from 'react';
import SlidePanel, { PanelFooter } from './SlidePanel';
import { FormField, FormSelect, FormMultiSelect, FormTextarea, FormToggle, FormSlider, FormTagInput, FormSection, FormGrid } from './Form';
import { useCreateContact, useUpdateContact } from '../hooks/useContacts';
import RoleGate from './RoleGate';

const TIER_SEGMENTS = {
  enterprise: [
    { value:'hft_firm',label:'HFT Firm'}, {value:'hedge_fund',label:'Hedge Fund'},{value:'quant_fund',label:'Quant Fund'},
    {value:'broker_dealer',label:'Broker-Dealer'},{value:'family_office',label:'Family Office'},{value:'prime_broker',label:'Prime Broker'},
  ],
  pro: [
    {value:'prop_trader',label:'Prop Trader'},{value:'quant_developer',label:'Quant Developer'},{value:'algo_trader',label:'Algo Trader'},
  ],
  individual: [{value:'retail_trader',label:'Retail Trader'}],
};

const ASSET_CLASSES = [{value:'equities',label:'Equities'},{value:'options',label:'Options'},{value:'futures',label:'Futures'}];
const ORDER_ROUTING = [{value:'fix',label:'FIX'},{value:'rest_api',label:'REST API'},{value:'manual',label:'Manual'}];
const SOURCES = ['inbound','referral','conference','linkedin','cold_outreach','partner','other'].map(s=>({value:s,label:s.replace(/_/g,' ')}));
const STATUSES = ['active','warm','cold','new','unsubscribed'].map(s=>({value:s,label:s}));

const blank = {
  first_name:'', last_name:'', email:'', phone:'', mobile:'', title:'', department:'',
  tier:'', segment:'', status:'new', lead_score:0, jurisdiction:'',
  asset_classes:[], order_routing:[], uses_fix:false, uses_rest_api:false,
  programming_languages:[], source:'', notes:'',
  kyc_status:'', aml_status:'', accredited_investor:false, finra_registered:false, finra_crd:'',
};

export default function ContactForm({ contact, onClose, onSuccess }) {
  const isEdit = !!contact;
  const [form, setForm] = useState(isEdit ? {
    ...blank,
    first_name: contact.first_name ?? '',
    last_name:  contact.last_name  ?? '',
    email:      contact.email      ?? '',
    phone:      contact.phone      ?? '',
    mobile:     contact.mobile     ?? '',
    title:      contact.title      ?? '',
    department: contact.department ?? '',
    tier:       contact.tier       ?? '',
    segment:    contact.segment    ?? '',
    status:     contact.status     ?? 'new',
    lead_score: contact.lead_score ?? 0,
    jurisdiction:          contact.jurisdiction          ?? '',
    asset_classes:         contact.asset_classes         ?? [],
    order_routing:         contact.order_routing         ?? [],
    uses_fix:              contact.uses_fix              ?? false,
    uses_rest_api:         contact.uses_rest_api         ?? false,
    programming_languages: contact.programming_languages ?? [],
    source:                contact.source                ?? '',
    notes:                 contact.notes                 ?? '',
    kyc_status:            contact.kyc_status            ?? '',
    aml_status:            contact.aml_status            ?? '',
    accredited_investor:   contact.accredited_investor   ?? false,
    finra_registered:      contact.finra_registered      ?? false,
    finra_crd:             contact.finra_crd             ?? '',
  } : blank);

  const [errors, setErrors] = useState({});
  const set = (k) => (v) => { setForm(f => ({ ...f, [k]: v })); if (errors[k]) setErrors(e => ({ ...e, [k]: '' })); };
  const setTier = (v) => { setForm(f => ({ ...f, tier: v, segment: '' })); };

  const create = useCreateContact();
  const update = useUpdateContact();
  const saving = create.isPending || update.isPending;

  const validate = () => {
    const e = {};
    if (!form.first_name.trim()) e.first_name = 'First name is required';
    if (!form.last_name.trim())  e.last_name  = 'Last name is required';
    return e;
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    try {
      if (isEdit) {
        await update.mutateAsync({ id: contact.id, ...form });
      } else {
        await create.mutateAsync(form);
      }
      onSuccess?.();
      onClose();
    } catch (err) {
      setErrors({ _global: err.message });
    }
  };

  const segments = TIER_SEGMENTS[form.tier] ?? [];

  return (
    <SlidePanel title={isEdit ? 'Edit Contact' : 'New Contact'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{ padding: '20px 24px', flex: 1 }}>
          {errors._global && <div className="form-error" style={{ marginBottom: 12 }}>{errors._global}</div>}

          <FormSection title="Identity" />
          <FormGrid>
            <FormField label="First name" value={form.first_name} onChange={set('first_name')} error={errors.first_name} required />
            <FormField label="Last name"  value={form.last_name}  onChange={set('last_name')}  error={errors.last_name}  required />
          </FormGrid>
          <FormGrid>
            <FormField label="Title / role" value={form.title} onChange={set('title')} placeholder="e.g. Head of Trading" />
            <FormField label="Department"   value={form.department} onChange={set('department')} />
          </FormGrid>
          <FormGrid>
            <FormField label="Email" type="email" value={form.email} onChange={set('email')} />
            <FormField label="Phone" type="tel"   value={form.phone} onChange={set('phone')} />
          </FormGrid>
          <FormGrid>
            <FormField label="Mobile" type="tel" value={form.mobile} onChange={set('mobile')} />
            <FormField label="Jurisdiction" value={form.jurisdiction} onChange={set('jurisdiction')} placeholder="e.g. US" />
          </FormGrid>

          <FormSection title="Classification" />
          <FormGrid>
            <FormSelect label="Tier" value={form.tier} onChange={setTier}
              options={[{value:'enterprise',label:'Enterprise'},{value:'pro',label:'Pro'},{value:'individual',label:'Individual'}]} />
            <FormSelect label="Segment" value={form.segment} onChange={set('segment')}
              options={segments} placeholder={form.tier ? 'Select…' : 'Select tier first…'} />
          </FormGrid>
          <FormGrid>
            <FormSelect label="Status" value={form.status} onChange={set('status')} options={STATUSES} />
            <FormSelect label="Source" value={form.source} onChange={set('source')} options={SOURCES} />
          </FormGrid>
          <FormSlider label="Lead score" value={form.lead_score} onChange={set('lead_score')} />

          <FormSection title="Trading profile" />
          <FormMultiSelect label="Asset classes" options={ASSET_CLASSES} value={form.asset_classes} onChange={set('asset_classes')} />
          <FormMultiSelect label="Order routing" options={ORDER_ROUTING} value={form.order_routing} onChange={set('order_routing')} />
          <FormToggle label="Uses FIX" checked={form.uses_fix} onChange={set('uses_fix')} />
          <FormToggle label="Uses REST API" checked={form.uses_rest_api} onChange={set('uses_rest_api')} />
          <FormTagInput label="Programming languages" value={form.programming_languages} onChange={set('programming_languages')} placeholder="python, c++, …" />
          <FormTextarea label="Notes" value={form.notes} onChange={set('notes')} rows={3} />

          <RoleGate allow={['admin','compliance','operations']}>
            <FormSection title="Compliance" />
            <FormGrid>
              <FormSelect label="KYC status" value={form.kyc_status} onChange={set('kyc_status')}
                options={['not_started','in_progress','pending_review','approved','rejected','expired'].map(s=>({value:s,label:s.replace(/_/g,' ')}))} />
              <FormSelect label="AML status" value={form.aml_status} onChange={set('aml_status')}
                options={['clear','flagged','under_review','escalated'].map(s=>({value:s,label:s.replace(/_/g,' ')}))} />
            </FormGrid>
            <FormToggle label="Accredited investor"  checked={form.accredited_investor} onChange={set('accredited_investor')} />
            <FormToggle label="FINRA registered"     checked={form.finra_registered}    onChange={set('finra_registered')} />
            <FormField  label="FINRA CRD"            value={form.finra_crd}             onChange={set('finra_crd')} />
          </RoleGate>
        </div>

        <PanelFooter>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create contact'}
          </button>
        </PanelFooter>
      </form>
    </SlidePanel>
  );
}
