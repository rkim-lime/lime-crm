import { useState } from 'react';
import { supabase } from '../lib/supabase';
import Modal from './Modal';
import { FormField, FormTextarea, FormSearchSelect, FormGrid } from './Form';
import { useCreateActivity } from '../hooks/useActivities';
import { useAccounts } from '../hooks/useAccounts';
import { useContacts } from '../hooks/useContacts';
import { useDeals } from '../hooks/useDeals';

const TYPES = [
  { value:'call',    label:'📞 Call' },
  { value:'email',   label:'✉ Email' },
  { value:'meeting', label:'🤝 Meeting' },
  { value:'note',    label:'📝 Note' },
];

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export default function LogActivityModal({ defaults = {}, onClose, onSuccess }) {
  const [form, setForm] = useState({
    type: 'note',
    title: '',
    body: '',
    occurred_at: nowLocal(),
    account_id: defaults.account_id ?? '',
    contact_id: defaults.contact_id ?? '',
    deal_id:    defaults.deal_id    ?? '',
  });
  const [errors, setErrors] = useState({});
  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));

  const create = useCreateActivity();
  const accounts = useAccounts({});
  const contacts = useContacts({});
  const deals    = useDeals({});

  const accountOpts = (accounts.data ?? []).map(a => ({ value: a.id, label: a.name }));
  const contactOpts = (contacts.data ?? []).map(c => ({ value: c.id, label: `${c.first_name} ${c.last_name}` }));
  const dealOpts    = (deals.data    ?? []).map(d => ({ value: d.id, label: d.name }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setErrors({ title: 'Title is required' }); return; }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await create.mutateAsync({
        ...form,
        account_id:  form.account_id  || null,
        contact_id:  form.contact_id  || null,
        deal_id:     form.deal_id     || null,
        occurred_at: new Date(form.occurred_at).toISOString(),
        created_by:  user?.id,
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      setErrors({ _global: err.message });
    }
  };

  return (
    <Modal
      title="Log Activity"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="activity-form" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Logging…' : 'Log activity'}
          </button>
        </>
      }
    >
      <form id="activity-form" onSubmit={submit}>
        {errors._global && <div className="form-error" style={{ marginBottom: 12 }}>{errors._global}</div>}

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => set('type')(t.value)}
              className={`btn btn-sm ${form.type === t.value ? 'btn-primary' : 'btn-secondary'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <FormField label="Title" value={form.title} onChange={set('title')} error={errors.title} required placeholder={`${form.type} summary…`} />
        <FormTextarea label="Notes / body" value={form.body} onChange={set('body')} rows={3} />
        <FormField label="When" type="datetime-local" value={form.occurred_at} onChange={set('occurred_at')} />

        <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 12, paddingTop: 12 }}>
          <FormSearchSelect label="Account" options={accountOpts} value={form.account_id} onChange={set('account_id')} />
          <FormSearchSelect label="Contact" options={contactOpts} value={form.contact_id} onChange={set('contact_id')} />
          <FormSearchSelect label="Deal"    options={dealOpts}    value={form.deal_id}    onChange={set('deal_id')} />
        </div>
      </form>
    </Modal>
  );
}
