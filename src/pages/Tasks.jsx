import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import RoleGate from '../components/RoleGate';
import TaskForm from '../components/TaskForm';
import { useTasks, useToggleTask } from '../hooks/useTasks';
import { fmtDate, ErrorBanner, EmptyState, TableSkeleton } from './shared';

const STATUSES   = ['open','in_progress','completed','cancelled'];
const PRIORITIES = ['low','medium','high','urgent'];

export default function Tasks() {
  const [status, setStatus]     = useState('');
  const [priority, setPriority] = useState('');
  const [taskForm, setTaskForm] = useState(null); // null | 'create' | {task}
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useTasks({ status, priority });
  const toggle = useToggleTask();

  return (
    <Layout title="Tasks">
      <div className="filters-bar">
        <select className="filter-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
        </select>
        <select className="filter-select" value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="">All priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <RoleGate allow={['admin','sales','operations']}>
          <button className="btn btn-primary btn-sm" onClick={() => setTaskForm('create')}>+ New Task</button>
        </RoleGate>
      </div>

      {error && <ErrorBanner message={error.message} onRetry={refetch} />}

      {isLoading ? <TableSkeleton cols={5} /> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }} />
                <th>Task</th><th>Priority</th><th>Due</th><th>Linked to</th>
                <RoleGate allow={['admin','sales','operations']}><th style={{ width: 48 }} /></RoleGate>
              </tr>
            </thead>
            <tbody>
              {!data?.length && <tr><td colSpan={6}><EmptyState icon="✓" text="No tasks" /></td></tr>}
              {data?.map(t => (
                <tr key={t.id} style={{ opacity: t.status === 'completed' ? .55 : 1 }}>
                  <td
                    onClick={e => { e.stopPropagation(); toggle.mutate({ id: t.id, currentStatus: t.status }); }}
                    style={{ cursor: 'pointer', textAlign: 'center' }}
                  >
                    <span style={{ fontSize: 16, color: t.status === 'completed' ? 'var(--green)' : 'var(--border)', lineHeight: 1 }}>
                      {t.status === 'completed' ? '✓' : '○'}
                    </span>
                  </td>
                  <td>
                    <div className="table-name" style={{ textDecoration: t.status === 'completed' ? 'line-through' : 'none' }}>{t.title}</div>
                    {t.description && <div className="table-sub">{t.description}</div>}
                  </td>
                  <td><span className={`badge badge-${t.priority}`}>{t.priority}</span></td>
                  <td>
                    <span style={{ fontSize: 13, color: isPast(t.due_date) && t.status !== 'completed' ? 'var(--red)' : 'var(--text-secondary)' }}>
                      {fmtDate(t.due_date)}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      {t.account?.name && <div onClick={e => { e.stopPropagation(); navigate(`/accounts/${t.account_id}`); }} style={{ cursor:'pointer',color:'var(--accent)' }}>{t.account.name}</div>}
                      {t.deal?.name   && <div>{t.deal.name}</div>}
                    </div>
                  </td>
                  <RoleGate allow={['admin','sales','operations']}>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setTaskForm(t)}>✎</button>
                    </td>
                  </RoleGate>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {taskForm === 'create' && <TaskForm onClose={() => setTaskForm(null)} />}
      {taskForm && taskForm !== 'create' && <TaskForm task={taskForm} onClose={() => setTaskForm(null)} />}
    </Layout>
  );
}

function isPast(iso) {
  if (!iso) return false;
  return new Date(iso) < new Date();
}
