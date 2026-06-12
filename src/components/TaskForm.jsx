import { useState } from 'react';
import Modal, { ModalFooter } from './Modal';
import { FormField, FormSelect, FormTextarea, FormSearchSelect, FormGrid, FormSection } from './Form';
import { useCreateTask, useUpdateTask } from '../hooks/useTasks';
import { useAccounts } from '../hooks/useAccounts';
import { useContacts } from '../hooks/useContacts';
import { useDeals } from '../hooks/useDeals';

const blank = {
  title:'', description:'', priority:'medium', status:'open', due_date:'',
  account_id:'', contact_id:'', deal_id:'',
};

export default function TaskForm({ task, defaults = {}, onClose, onSuccess }) {
  const isEdit = !!task;
  const [form, setForm] = useState(isEdit ? {
    ...blank,
    title:       task.title       ?? '',
    description: task.description ?? '',
    priority:    task.priority    ?? 'medium',
    status:      task.status      ?? 'open',
    due_date:    task.due_date    ?? '',
    account_id:  task.account_id  ?? '',
    contact_id:  task.contact_id  ?? '',
    deal_id:     task.deal_id     ?? '',
  } : { ...blank, ...defaults });

  const [errors, setErrors] = useState({});
  const set = (k) => (v) => { setForm(f => ({ ...f, [k]: v })); if (errors[k]) setErrors(e => ({ ...e, [k]: '' })); };

  const create = useCreateTask();
  const update = useUpdateTask();
  const saving = create.isPending || update.isPending;

  const accounts = useAccounts({});
  const contacts = useContacts({});
  const deals    = useDeals({});

  const accountOpts = (accounts.data ?? []).map(a => ({ value: a.id, label: a.name }));
  const contactOpts = (contacts.data ?? []).map(c => ({ value: c.id, label: `${c.first_name} ${c.last_name}` }));
  const dealOpts    = (deals.data    ?? []).map(d => ({ value: d.id, label: d.name }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setErrors({ title: 'Title is required' }); return; }
    const payload = {
      ...form,
      account_id: form.account_id || null,
      contact_id: form.contact_id || null,
      deal_id:    form.deal_id    || null,
    };
    try {
      if (isEdit) { await update.mutateAsync({ id: task.id, ...payload }); }
      else        { await create.mutateAsync(payload); }
      onSuccess?.();
      onClose();
    } catch (err) {
      setErrors({ _global: err.message });
    }
  };

  return (
    <Modal title={isEdit ? 'Edit Task' : 'New Task'} onClose={onClose} width={520}>
      <form onSubmit={submit}>
        {errors._global && <div className="form-error" style={{ marginBottom: 12 }}>{errors._global}</div>}
        <FormField label="Title" value={form.title} onChange={set('title')} error={errors.title} required placeholder="What needs to be done?" />
        <FormTextarea label="Description" value={form.description} onChange={set('description')} rows={2} />
        <FormGrid>
          <FormSelect label="Priority" value={form.priority} onChange={set('priority')}
            options={['low','medium','high','urgent'].map(p => ({value:p,label:p}))} />
          <FormSelect label="Status" value={form.status} onChange={set('status')}
            options={['open','in_progress','completed','cancelled'].map(s => ({value:s,label:s.replace(/_/g,' ')}))} />
        </FormGrid>
        <FormField label="Due date" type="date" value={form.due_date} onChange={set('due_date')} />

        <FormSection title="Link to" />
        <FormSearchSelect label="Account" options={accountOpts} value={form.account_id} onChange={set('account_id')} />
        <FormSearchSelect label="Contact" options={contactOpts} value={form.contact_id} onChange={set('contact_id')} />
        <FormSearchSelect label="Deal"    options={dealOpts}    value={form.deal_id}    onChange={set('deal_id')} />

        <ModalFooter>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save' : 'Create task'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
