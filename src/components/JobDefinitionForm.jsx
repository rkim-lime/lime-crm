import { useState } from 'react';
import SlidePanel from './SlidePanel';
import { useCreateJobDefinition, useUpdateJobDefinition } from '../hooks/useJobs';

const LABEL = { fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 };
const SECTION_HEAD = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 12,
};

export default function JobDefinitionForm({ definition, onClose }) {
  const isEdit = !!definition;

  const [name,         setName]         = useState(definition?.name         ?? '');
  const [description,  setDescription]  = useState(definition?.description  ?? '');
  const [jobType,      setJobType]      = useState(definition?.job_type     ?? 'ingest_13f');
  const [limit,        setLimit]        = useState(definition?.config?.limit   ?? 50);
  const [minAum,       setMinAum]       = useState(definition?.config?.minAum  ?? '');
  const [sortBy,       setSortBy]       = useState(definition?.config?.sortBy  ?? '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error,        setError]        = useState(null);

  const create    = useCreateJobDefinition();
  const update    = useUpdateJobDefinition();
  const isPending = create.isPending || update.isPending;

  const config = {
    limit: Number(limit) || 50,
    ...(minAum !== '' && minAum !== null ? { minAum: Number(minAum) } : {}),
    ...(sortBy ? { sortBy } : {}),
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    setError(null);
    try {
      const payload = {
        name:        name.trim(),
        description: description.trim() || null,
        job_type:    jobType,
        config,
      };
      if (isEdit) {
        await update.mutateAsync({ id: definition.id, ...payload });
      } else {
        await create.mutateAsync(payload);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <SlidePanel
      title={isEdit ? 'Edit Job Definition' : 'New Job Definition'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={isPending || !name.trim()}>
            {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Job'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="error-state" style={{ marginBottom: 16 }}>{error}</div>
        )}

        {/* Name */}
        <div style={{ marginBottom: 16 }}>
          <label style={LABEL}>
            Name <span style={{ color: 'var(--red)' }}>*</span>
          </label>
          <input
            className="form-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. 13F — Large Cap"
            autoFocus
          />
        </div>

        {/* Description */}
        <div style={{ marginBottom: 16 }}>
          <label style={LABEL}>Description</label>
          <textarea
            className="form-input"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional — purpose or notes for this job"
            style={{ resize: 'vertical' }}
          />
        </div>

        {/* Job type */}
        <div style={{ marginBottom: 24 }}>
          <label style={LABEL}>Job Type</label>
          <select
            className="form-select"
            value={jobType}
            onChange={e => setJobType(e.target.value)}
          >
            <option value="ingest_13f">SEC 13F — Institutional Investment Managers</option>
            <option value="ingest_13h" disabled>SEC 13H — Large Trader (coming soon)</option>
            <option value="ingest_adv" disabled>SEC ADV — Investment Advisers (coming soon)</option>
          </select>
        </div>

        {/* Config builder */}
        <div style={{ marginBottom: 8 }}>
          <div style={SECTION_HEAD}>Configuration</div>

          <div style={{ marginBottom: 14 }}>
            <label style={LABEL}>Batch Size (limit)</label>
            <input
              className="form-input"
              type="number"
              min={1}
              max={500}
              value={limit}
              onChange={e => setLimit(e.target.value)}
            />
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 4 }}>
              Number of 13F filers to process per run
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={LABEL}>Minimum AUM (USD)</label>
            <input
              className="form-input"
              type="number"
              min={0}
              step={1_000_000}
              value={minAum}
              onChange={e => setMinAum(e.target.value)}
              placeholder="e.g. 100000000 for $100M (leave blank for no minimum)"
            />
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 4 }}>
              Skip filers whose computed AUM is below this threshold
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={LABEL}>Sort By</label>
            <select
              className="form-select"
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
            >
              <option value="">Default (most recent filing date)</option>
              <option value="aum">AUM descending (largest first)</option>
            </select>
          </div>
        </div>

        {/* Advanced: raw JSON preview */}
        <div style={{ marginTop: 20 }}>
          <button
            type="button"
            style={{ fontSize: 12, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 5 }}
            onClick={() => setShowAdvanced(v => !v)}
          >
            {showAdvanced ? '▼' : '▶'} Advanced — raw config JSON
          </button>
          {showAdvanced && (
            <pre style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: 10, borderRadius: 6, marginTop: 8, overflow: 'auto' }}>
              {JSON.stringify(config, null, 2)}
            </pre>
          )}
        </div>
      </form>
    </SlidePanel>
  );
}
