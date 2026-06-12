import { useState, useRef, useEffect } from 'react';

export function FormField({ label, name, value, onChange, error, type = 'text', placeholder, required, disabled, hint }) {
  return (
    <div className="form-field">
      <label className="form-label">{label}{required && <span className="form-required">*</span>}</label>
      {hint && <div className="form-hint">{hint}</div>}
      <input
        type={type} name={name} value={value ?? ''} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        className={`form-input${error ? ' error' : ''}`}
      />
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

export function FormTextarea({ label, name, value, onChange, error, placeholder, rows = 4, required }) {
  return (
    <div className="form-field">
      <label className="form-label">{label}{required && <span className="form-required">*</span>}</label>
      <textarea
        name={name} value={value ?? ''} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} rows={rows}
        className={`form-input form-textarea${error ? ' error' : ''}`}
      />
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

export function FormSelect({ label, name, value, onChange, options, error, required, placeholder = 'Select…' }) {
  return (
    <div className="form-field">
      <label className="form-label">{label}{required && <span className="form-required">*</span>}</label>
      <select
        name={name} value={value ?? ''} onChange={e => onChange(e.target.value)}
        className={`form-input form-select-field${error ? ' error' : ''}`}
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

// Dropdown-based multi-select. Dropdown flows inline (not position:absolute) so it
// works correctly inside scroll containers like SlidePanel.
export function FormMultiSelect({ label, options, value = [], onChange, error, required }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (v) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  const selectedLabels = options.filter(o => value.includes(o.value ?? o)).map(o => o.label ?? o);

  return (
    <div className="form-field" ref={ref}>
      <label className="form-label">{label}{required && <span className="form-required">*</span>}</label>
      <button
        type="button"
        className={`form-multiselect-trigger${open ? ' open' : ''}${error ? ' error' : ''}`}
        onClick={() => setOpen(v => !v)}
      >
        <span style={{ color: selectedLabels.length ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
          {selectedLabels.length ? selectedLabels.join(', ') : 'Select…'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>▾</span>
      </button>
      {open && (
        <div className="form-dropdown">
          {options.map(o => {
            const v = o.value ?? o;
            const checked = value.includes(v);
            return (
              <label key={v} className="form-dropdown-item">
                <input type="checkbox" checked={checked} onChange={() => toggle(v)} />
                <span>{o.label ?? o}</span>
              </label>
            );
          })}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

// Pill-button multi-select — no dropdown, always visible. For small fixed option sets.
export function FormPillSelect({ label, options, value = [], onChange, error, required }) {
  const toggle = (v) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  return (
    <div className="form-field">
      <label className="form-label">{label}{required && <span className="form-required">*</span>}</label>
      <div className="form-pill-select">
        {options.map(o => {
          const v = o.value ?? o;
          return (
            <button
              key={v} type="button"
              className={`form-pill${value.includes(v) ? ' selected' : ''}`}
              onClick={() => toggle(v)}
            >{o.label ?? o}</button>
          );
        })}
      </div>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

// Single-select pill radio — value is a string, not array. Clicking the active pill deselects.
export function FormPillRadio({ label, options, value, onChange, error, required }) {
  return (
    <div className="form-field">
      <label className="form-label">{label}{required && <span className="form-required">*</span>}</label>
      <div className="form-pill-select">
        {options.map(o => {
          const v = o.value ?? o;
          return (
            <button
              key={v} type="button"
              className={`form-pill${value === v ? ' selected' : ''}`}
              onClick={() => onChange(value === v ? '' : v)}
            >{o.label ?? o}</button>
          );
        })}
      </div>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

// Toggle switch. Uses label > input + track > thumb so the CSS :checked selector works.
export function FormToggle({ label, checked, onChange, hint }) {
  return (
    <div className="form-field form-field-row">
      <div style={{ flex: 1 }}>
        <div className="form-label" style={{ marginBottom: hint ? 2 : 0 }}>{label}</div>
        {hint && <div className="form-hint">{hint}</div>}
      </div>
      <label className="form-toggle">
        <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
        <span className="form-toggle-track">
          <span className="form-toggle-thumb" />
        </span>
      </label>
    </div>
  );
}

export function FormSlider({ label, value, onChange, min = 0, max = 100, step = 1 }) {
  return (
    <div className="form-field">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <label className="form-label">{label}</label>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value ?? 0}
        onChange={e => onChange(Number(e.target.value))}
        className="form-slider"
      />
    </div>
  );
}

export function FormTagInput({ label, value = [], onChange, error, placeholder = 'Type and press Enter…' }) {
  const [input, setInput] = useState('');
  const add = () => { const v = input.trim(); if (v && !value.includes(v)) onChange([...value, v]); setInput(''); };
  const handleKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
    if (e.key === 'Backspace' && !input && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="form-field">
      <label className="form-label">{label}</label>
      <div className={`form-tag-input${error ? ' error' : ''}`}>
        {value.map(t => (
          <span key={t} className="form-tag">
            {t}<button type="button" onClick={() => onChange(value.filter(x => x !== t))}>✕</button>
          </span>
        ))}
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey} onBlur={add}
          placeholder={value.length ? '' : placeholder}
          className="form-tag-input-field"
        />
      </div>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

// Search-filtered single select. Dropdown flows inline — safe inside scroll containers.
export function FormSearchSelect({ label, options, value, onChange, error, required, placeholder = 'Search…' }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find(o => (o.value ?? o) === value);
  const filtered = q ? options.filter(o => (o.label ?? o).toLowerCase().includes(q.toLowerCase())) : options;

  const pick = (o) => { onChange(o.value ?? o); setQ(''); setOpen(false); };
  const clear = (e) => { e.stopPropagation(); onChange(''); setQ(''); setOpen(false); };

  return (
    <div className="form-field" ref={ref}>
      <label className="form-label">{label}{required && <span className="form-required">*</span>}</label>
      <div
        className={`form-search-select${open ? ' open' : ''}${error ? ' error' : ''}`}
        onClick={() => { if (!open) setOpen(true); }}
      >
        {open
          ? <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} className="form-search-input" onClick={e => e.stopPropagation()} />
          : <span style={{ flex: 1, color: selected ? 'var(--text-primary)' : 'var(--text-tertiary)', fontSize: 13.5 }}>{selected ? (selected.label ?? selected) : 'Select…'}</span>
        }
        {value && !open
          ? <button type="button" onClick={clear} style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>✕</button>
          : !open && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>▾</span>
        }
      </div>
      {open && (
        <div className="form-dropdown">
          {filtered.length === 0
            ? <div style={{ padding: '8px 12px', color: 'var(--text-tertiary)', fontSize: 13 }}>No results</div>
            : filtered.map(o => (
              <div
                key={o.value ?? o}
                className={`form-dropdown-item${(o.value ?? o) === value ? ' selected' : ''}`}
                onClick={() => pick(o)}
              >
                <span>{o.label ?? o}</span>
              </div>
            ))
          }
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

export function FormSection({ title }) {
  return <div className="form-section-title">{title}</div>;
}

export function FormGrid({ children }) {
  return <div className="form-grid">{children}</div>;
}
