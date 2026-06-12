import { useState } from 'react';
import SlidePanel, { PanelFooter } from './SlidePanel';
import {
  FormField, FormSelect, FormPillSelect, FormTextarea,
  FormToggle, FormSlider, FormSearchSelect, FormSection,
  FormGrid, FormTagInput,
} from './Form';
import { useCreateLead, useUpdateLead } from '../hooks/useLeads';
import { useContacts } from '../hooks/useContacts';
import { useProfiles } from '../hooks/useDashboard';

const INDIVIDUAL_STAGES = [
  { value: 'visitor',     label: 'Visitor' },
  { value: 'lead',        label: 'Lead' },
  { value: 'nurture',     label: 'Nurture' },
  { value: 'activated',   label: 'Activated' },
  { value: 'funded',      label: 'Funded' },
  { value: 'first_trade', label: 'First Trade' },
  { value: 'active',      label: 'Active Trader' },
  { value: 'dormant',     label: 'Dormant' },
  { value: 'churned',     label: 'Churned' },
];

const STATUS_OPTS = [
  { value: 'active',    label: 'Active' },
  { value: 'converted', label: 'Converted' },
  { value: 'churned',   label: 'Churned' },
  { value: 'dormant',   label: 'Dormant' },
];

const SOURCE_OPTS = [
  { value: 'web_signup',      label: 'Web Sign-up' },
  { value: 'referral',        label: 'Referral' },
  { value: 'paid_social',     label: 'Paid Social' },
  { value: 'google_ads',      label: 'Google Ads' },
  { value: 'conference',      label: 'Conference' },
  { value: 'organic_search',  label: 'Organic Search' },
  { value: 'partner',         label: 'Partner' },
  { value: 'other',           label: 'Other' },
];

const ASSET_CLASSES = [
  { value: 'equities', label: 'Equities' },
  { value: 'options',  label: 'Options' },
  { value: 'futures',  label: 'Futures' },
];

const blank = {
  contact_id: '',
  stage: 'lead',
  status: 'active',
  owner_id: '',
  source: '',
  lead_score: 0,
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
  utm_content: '',
  utm_term: '',
  referrer_contact_id: '',
  asset_classes: [],
  uses_rest_api: false,
  uses_fix: false,
  programming_languages: [],
  funded_amount: '',
  first_funded_at: '',
  first_trade_at: '',
  activated_at: '',
  notes: '',
  tags: [],
};

export default function LeadForm({ lead, defaultContactId, onClose, onSuccess }) {
  const isEdit = !!lead;
  const [form, setForm] = useState(isEdit ? {
    ...blank,
    contact_id:          lead.contact_id          ?? '',
    stage:               lead.stage               ?? 'lead',
    status:              lead.status              ?? 'active',
    owner_id:            lead.owner_id            ?? '',
    source:              lead.source              ?? '',
    lead_score:          lead.lead_score          ?? 0,
    utm_source:          lead.utm_source          ?? '',
    utm_medium:          lead.utm_medium          ?? '',
    utm_campaign:        lead.utm_campaign        ?? '',
    utm_content:         lead.utm_content         ?? '',
    utm_term:            lead.utm_term            ?? '',
    referrer_contact_id: lead.referrer_contact_id ?? '',
    asset_classes:       lead.asset_classes       ?? [],
    uses_rest_api:       lead.uses_rest_api       ?? false,
    uses_fix:            lead.uses_fix            ?? false,
    programming_languages: lead.programming_languages ?? [],
    funded_amount:       lead.funded_amount       ?? '',
    first_funded_at:     lead.first_funded_at     ? lead.first_funded_at.slice(0, 10) : '',
    first_trade_at:      lead.first_trade_at      ? lead.first_trade_at.slice(0, 10)  : '',
    activated_at:        lead.activated_at        ? lead.activated_at.slice(0, 10)    : '',
    notes:               lead.notes               ?? '',
    tags:                lead.tags                ?? [],
  } : { ...blank, contact_id: defaultContactId ?? '' });

  const [errors, setErrors]   = useState({});
  const [showUtm, setShowUtm] = useState(false);

  const set = (k) => (v) => { setForm(f => ({ ...f, [k]: v })); if (errors[k]) setErrors(e => ({ ...e, [k]: '' })); };

  const create = useCreateLead();
  const update = useUpdateLead();
  const saving = create.isPending || update.isPending;

  const contacts = useContacts({ tier: 'individual' });
  const profiles  = useProfiles();

  const contactOpts = (contacts.data ?? []).map(c => ({
    value: c.id,
    label: `${c.first_name} ${c.last_name} · ${c.email ?? ''}`,
  }));
  const profileOpts = (profiles.data ?? []).map(p => ({
    value: p.id,
    label: p.full_name || p.email || 'Unnamed',
  }));

  const validate = () => {
    const e = {};
    if (!form.contact_id) e.contact_id = 'Contact is required';
    return e;
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    const payload = {
      contact_id:          form.contact_id,
      stage:               form.stage || 'lead',
      status:              form.status || 'active',
      owner_id:            form.owner_id  || null,
      source:              form.source    || null,
      lead_score:          Number(form.lead_score) || 0,
      utm_source:          form.utm_source    || null,
      utm_medium:          form.utm_medium    || null,
      utm_campaign:        form.utm_campaign  || null,
      utm_content:         form.utm_content   || null,
      utm_term:            form.utm_term      || null,
      referrer_contact_id: form.referrer_contact_id || null,
      asset_classes:       form.asset_classes,
      uses_rest_api:       form.uses_rest_api,
      uses_fix:            form.uses_fix,
      programming_languages: form.programming_languages,
      funded_amount:       form.funded_amount !== '' ? Number(form.funded_amount) : null,
      first_funded_at:     form.first_funded_at || null,
      first_trade_at:      form.first_trade_at  || null,
      activated_at:        form.activated_at    || null,
      notes:               form.notes || null,
      tags:                form.tags,
    };

    try {
      if (isEdit) {
        await update.mutateAsync({
          id:          lead.id,
          _prevStage:  lead.stage,
          _prevStatus: lead.status,
          ...payload,
        });
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
    <SlidePanel title={isEdit ? 'Edit Lead' : 'New Lead'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{ padding: '20px 24px', flex: 1 }}>
          {errors._global && (
            <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5', fontSize: 13, color: '#dc2626' }}>
              {errors._global}
            </div>
          )}

          {!isEdit && (
            <>
              <FormSection title="Contact" />
              <FormSearchSelect
                label="Contact *"
                options={contactOpts}
                value={form.contact_id}
                onChange={set('contact_id')}
                error={errors.contact_id}
                placeholder="Search individual contacts…"
                required
              />
            </>
          )}

          <FormSection title="Lead Details" />
          <div className="form-field">
            <label className="form-label">Stage</label>
            <div className="form-pill-select">
              {INDIVIDUAL_STAGES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`form-pill${form.stage === value ? ' selected' : ''}`}
                  onClick={() => set('stage')(value)}
                >{label}</button>
              ))}
            </div>
          </div>
          <FormGrid>
            <FormSelect label="Status" value={form.status} onChange={set('status')} options={STATUS_OPTS} />
            <FormSelect label="Source" value={form.source} onChange={set('source')} options={SOURCE_OPTS} placeholder="Select source…" />
          </FormGrid>
          <FormSearchSelect
            label="Owner"
            options={profileOpts}
            value={form.owner_id}
            onChange={set('owner_id')}
            placeholder="Assign owner…"
          />
          <FormSlider label="Lead Score" value={form.lead_score} onChange={set('lead_score')} min={0} max={100} />

          <FormSection title="Attribution" />
          <FormSearchSelect
            label="Referred by"
            options={(contacts.data ?? []).map(c => ({
              value: c.id,
              label: `${c.first_name} ${c.last_name}`,
            }))}
            value={form.referrer_contact_id}
            onChange={set('referrer_contact_id')}
            placeholder="Search contacts…"
          />
          <button
            type="button"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--accent)', padding: '4px 0 8px', textAlign: 'left' }}
            onClick={() => setShowUtm(v => !v)}
          >
            {showUtm ? '▾' : '▸'} UTM fields
          </button>
          {showUtm && (
            <>
              <FormGrid>
                <FormField label="UTM Source"   value={form.utm_source}   onChange={set('utm_source')} />
                <FormField label="UTM Medium"   value={form.utm_medium}   onChange={set('utm_medium')} />
              </FormGrid>
              <FormGrid>
                <FormField label="UTM Campaign" value={form.utm_campaign} onChange={set('utm_campaign')} />
                <FormField label="UTM Content"  value={form.utm_content}  onChange={set('utm_content')} />
              </FormGrid>
              <FormField label="UTM Term" value={form.utm_term} onChange={set('utm_term')} />
            </>
          )}

          <FormSection title="Trading Profile" />
          <FormPillSelect
            label="Asset Classes"
            options={ASSET_CLASSES}
            value={form.asset_classes}
            onChange={set('asset_classes')}
          />
          <FormGrid>
            <FormToggle label="Uses REST API" checked={form.uses_rest_api} onChange={set('uses_rest_api')} />
            <FormToggle label="Uses FIX"      checked={form.uses_fix}      onChange={set('uses_fix')} />
          </FormGrid>
          <FormTagInput
            label="Programming Languages"
            value={form.programming_languages}
            onChange={set('programming_languages')}
            placeholder="python, rust, …"
          />

          {isEdit && (
            <>
              <FormSection title="Milestones" />
              <FormGrid>
                <FormField label="Activated At"    type="date" value={form.activated_at}    onChange={set('activated_at')} />
                <FormField label="First Funded At" type="date" value={form.first_funded_at} onChange={set('first_funded_at')} />
              </FormGrid>
              <FormGrid>
                <FormField label="First Trade At"  type="date" value={form.first_trade_at}  onChange={set('first_trade_at')} />
                <FormField label="Funded Amount"   type="number" value={form.funded_amount} onChange={set('funded_amount')} placeholder="0.00" />
              </FormGrid>
            </>
          )}

          <FormSection title="Notes" />
          <FormTextarea label="Notes" value={form.notes} onChange={set('notes')} rows={3} />
          <FormTagInput label="Tags" value={form.tags} onChange={set('tags')} placeholder="tag1, tag2, …" />
        </div>

        <PanelFooter>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create lead'}
          </button>
        </PanelFooter>
      </form>
    </SlidePanel>
  );
}
