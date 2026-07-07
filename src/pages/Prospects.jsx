import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useProspects, useSourceRegistry, useSegmentTaxonomy } from '../hooks/useProspects';
import { useDedupQueueCount } from '../hooks/useDedup';
import { useProfiles } from '../hooks/useDashboard';
import { TableSkeleton, ErrorBanner, fmtRelTime, fmtProspectSource, fmtSegment } from './shared';

const STATUS_OPTS = [
  { value: '',             label: 'All Statuses' },
  { value: 'uncontacted',  label: 'Uncontacted' },
  { value: 'contacted',    label: 'Contacted' },
  { value: 'qualified',    label: 'Qualified' },
  { value: 'disqualified', label: 'Disqualified' },
  { value: 'converted',    label: 'Converted' },
  { value: 'promoted',     label: 'Promoted' },
];


const STATUS_COLOR = {
  uncontacted:  'var(--text-tertiary)',
  contacted:    'var(--accent)',
  qualified:    'var(--green)',
  disqualified: 'var(--red)',
  converted:    '#7c3aed',
  promoted:     '#7c3aed',
};

// Multi-select segment filter with a "hide unknowns" toggle. Options come from
// taxonomy_values (useSegmentTaxonomy). Maps to segment_canonical via the
// `segments` array + `hideUnknown` filters in useProspects.
function SegmentFilter({ segmentValues, selected, onToggle, onClear, hideUnknown, onToggleHideUnknown }) {
  const [open, setOpen] = useState(false);
  const label = selected.length
    ? `${selected.length} segment${selected.length > 1 ? 's' : ''}`
    : (hideUnknown ? 'Segments · excl. Unknown' : 'All Segments');
  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 7, padding: '5px 6px',
    fontSize: 12.5, color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 4,
    whiteSpace: 'nowrap',
  };
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="filter-select"
        onClick={() => setOpen(o => !o)}
        style={{ cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'left', minWidth: 150 }}
      >
        {label} <span style={{ color: 'var(--text-tertiary)' }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20,
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: 6, padding: 6, minWidth: 200, maxHeight: 340, overflowY: 'auto',
              boxShadow: '0 6px 20px rgba(0,0,0,0.14)',
            }}
          >
            <label style={rowStyle}>
              <input type="checkbox" checked={hideUnknown} onChange={onToggleHideUnknown} />
              Hide unknowns
            </label>
            <div style={{ height: 1, background: 'var(--border)', margin: '5px 2px' }} />
            {segmentValues.map(s => (
              <label key={s.value_key} style={rowStyle}>
                <input
                  type="checkbox"
                  checked={selected.includes(s.value_key)}
                  onChange={() => onToggle(s.value_key)}
                />
                {s.label}
              </label>
            ))}
            {selected.length > 0 && (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '5px 2px' }} />
                <button
                  type="button"
                  onClick={onClear}
                  style={{ ...rowStyle, width: '100%', border: 'none', background: 'none', color: 'var(--accent)' }}
                >
                  Clear selection
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function fmtAUM(n) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function FitScorePill({ score }) {
  if (score == null) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  const color = score >= 75 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 72 }}>
      <div style={{ flex: 1, height: 4, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 22, textAlign: 'right' }}>{score}</span>
    </div>
  );
}

function StatusDot({ status }) {
  const color = STATUS_COLOR[status] ?? 'var(--text-tertiary)';
  const label = status?.replace(/_/g, ' ') ?? '—';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

export default function Prospects() {
  const navigate = useNavigate();
  const [statusFilter,   setStatus]   = useState('');
  const [channelFilter,  setChannel]  = useState('');
  const [sourceFilter,   setSource]   = useState('');
  const [segments,       setSegments] = useState([]);
  const [hideUnknown,    setHideUnknown] = useState(false);
  const [assigneeFilter, setAssignee] = useState('');
  const [search,         setSearch]   = useState('');
  const [icpOnly,        setIcpOnly]  = useState(true);

  const { data: registry = [] } = useSourceRegistry();
  const { data: segmentValues = [] } = useSegmentTaxonomy();

  const toggleSegment = (key) =>
    setSegments(prev => prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]);

  // Sorted active registry entries — drives both filter option lists
  const activeRegistry = registry
    .filter(r => r.is_active)
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));

  // Distinct channels in sort order
  const channels = [...new Set(activeRegistry.map(r => r.channel))];
  const channelOpts = [
    { value: '', label: 'All Channels' },
    ...channels.map(ch => ({ value: ch, label: ch.charAt(0).toUpperCase() + ch.slice(1) })),
  ];

  // Sources within the selected channel (only shown when channel is selected)
  const sourceSubOpts = channelFilter
    ? activeRegistry.filter(r => r.channel === channelFilter)
    : [];

  const baseFilters = {};
  if (statusFilter)   baseFilters.status   = statusFilter;
  if (segments.length) baseFilters.segments = segments;
  // hide-unknowns only applies when 'unknown' isn't explicitly selected
  if (hideUnknown && !segments.includes('unknown')) baseFilters.hideUnknown = true;
  if (assigneeFilter) baseFilters.assignee = assigneeFilter;
  if (search)         baseFilters.search   = search;
  // Channel/source filter: specific source takes precedence over channel
  if (sourceFilter) {
    baseFilters.source = sourceFilter;
  } else if (channelFilter) {
    const cs = activeRegistry.filter(r => r.channel === channelFilter).map(r => r.source_key);
    if (cs.length > 0) baseFilters.sources = cs;
  }

  const filters = { ...baseFilters, icpOnly };

  const { data, isLoading, error, refetch } = useProspects(filters);
  const allProspects = useProspects({ ...baseFilters, icpOnly: false });
  const { data: dedupCount = 0 } = useDedupQueueCount();
  const profiles = useProfiles();

  return (
    <Layout title="Prospects">
      <div className="filters-bar">
        <input
          className="filter-select"
          style={{ minWidth: 180 }}
          placeholder="Search firm name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-select" value={statusFilter} onChange={e => setStatus(e.target.value)}>
          {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          className="filter-select"
          value={channelFilter}
          onChange={e => { setChannel(e.target.value); setSource(''); }}
        >
          {channelOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {channelFilter && sourceSubOpts.length > 1 && (
          <select className="filter-select" value={sourceFilter} onChange={e => setSource(e.target.value)}>
            <option value="">All {channelOpts.find(o => o.value === channelFilter)?.label ?? 'Sources'}</option>
            {sourceSubOpts.map(o => (
              <option key={o.source_key} value={o.source_key}>{o.display_label}</option>
            ))}
          </select>
        )}
        <SegmentFilter
          segmentValues={segmentValues}
          selected={segments}
          onToggle={toggleSegment}
          onClear={() => setSegments([])}
          hideUnknown={hideUnknown}
          onToggleHideUnknown={e => setHideUnknown(e.target.checked)}
        />
        <select className="filter-select" value={assigneeFilter} onChange={e => setAssignee(e.target.value)}>
          <option value="">All Assignees</option>
          {(profiles.data ?? []).map(p => (
            <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
          ))}
        </select>

        {/* ICP filter toggle */}
        <label
          title="ICP-qualified firms meet your minimum AUM, turnover, and segment criteria. Configure thresholds in Settings → ICP Criteria."
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          <input type="checkbox" checked={icpOnly} onChange={e => setIcpOnly(e.target.checked)} />
          ICP only <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>ⓘ</span>
        </label>

        <span style={{ flex: 1 }} />

        {/* Dedup link */}
        {dedupCount > 0 && (
          <button
            className="btn btn-sm"
            style={{ color: '#d97706', border: '1px solid #fde68a', background: '#fffbeb', whiteSpace: 'nowrap' }}
            onClick={() => navigate('/prospects/dedup')}
          >
            ⚠ Duplicate Review ({dedupCount})
          </button>
        )}

        {/* Count display */}
        <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)', alignSelf: 'center', whiteSpace: 'nowrap' }}>
          {data && allProspects.data
            ? icpOnly
              ? `${data.length} of ${allProspects.data.length} prospects`
              : `${data.length} prospect${data.length !== 1 ? 's' : ''}`
            : data
            ? `${data.length} prospect${data.length !== 1 ? 's' : ''}`
            : ''}
        </span>
      </div>

      {error && <ErrorBanner message={error.message} onRetry={refetch} />}

      {isLoading ? (
        <TableSkeleton cols={8} rows={8} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Firm</th>
                <th>Status</th>
                <th>Source</th>
                <th>Segment</th>
                <th>AUM</th>
                <th>Positions</th>
                <th>Fit Score</th>
                <th>Assigned To</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map(p => (
                <tr key={p.id} onClick={() => navigate(`/prospects/${p.id}`)}>
                  <td>
                    <div className="table-name">{p.firm_name}</div>
                    {p.cik && (
                      <div className="table-sub">CIK {p.cik}</div>
                    )}
                  </td>
                  <td>
                    <StatusDot status={p.status} />
                    {p.status === 'possible_duplicate' && (
                      <div style={{ marginTop: 3 }}>
                        <button
                          title="This firm may already exist — review in Duplicate Review"
                          onClick={e => { e.stopPropagation(); navigate('/prospects/dedup'); }}
                          style={{
                            background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 3,
                            color: '#d97706', fontSize: 10.5, fontWeight: 700,
                            cursor: 'pointer', padding: '1px 6px', lineHeight: '16px',
                          }}
                        >
                          ⚠ Duplicate?
                        </button>
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    {fmtProspectSource(p.source, registry)}
                  </td>
                  <td style={{ fontSize: 12.5 }}>
                    {fmtSegment(p.segment_canonical, segmentValues)}
                  </td>
                  <td style={{ fontSize: 12.5, fontWeight: 500 }}>{fmtAUM(p.estimated_aum_usd)}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    {p.position_count ?? '—'}
                  </td>
                  <td><FitScorePill score={p.fit_score} /></td>
                  <td style={{ fontSize: 13 }}>
                    {p.assignee?.full_name ?? <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Unassigned</span>}
                  </td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{fmtRelTime(p.created_at)}</td>
                </tr>
              ))}
              {!isLoading && (data ?? []).length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-tertiary)', fontSize: 13 }}>
                    No prospects found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
