import { useState, useRef } from 'react';
import { useUploadDocument, useDeleteDocument, useDocuments, getSignedUrl } from '../hooks/useDocuments';
import { FormSelect, FormField, FormTextarea } from './Form';
import RoleGate from './RoleGate';

const MAX_SIZE = 25 * 1024 * 1024; // 25MB
const ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg';
const DOC_TYPES = ['kyc','contract','id_verification','financial_statement','onboarding','term_sheet','other']
  .map(t => ({ value: t, label: t.replace(/_/g,' ') }));

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n/1024).toFixed(0)} KB`;
  return `${(n/1024/1024).toFixed(1)} MB`;
}

export default function DocumentUpload({ accountId, contactId }) {
  const filters = accountId ? { account: accountId } : { contact: contactId };
  const docs = useDocuments(filters);
  const upload = useUploadDocument();
  const del = useDeleteDocument();

  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(null);
  const [pending, setPending] = useState(null); // file waiting for metadata
  const [meta, setMeta] = useState({ doc_type: '', notes: '', expiry_date: '' });
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef(null);

  const handleFiles = (files) => {
    const file = files[0];
    if (!file) return;
    if (file.size > MAX_SIZE) { setUploadError('File exceeds 25 MB limit'); return; }
    setPending(file);
    setMeta({ doc_type: '', notes: '', expiry_date: '' });
    setUploadError('');
  };

  const confirmUpload = async () => {
    if (!pending) return;
    setProgress(0);
    try {
      await upload.mutateAsync({
        file: pending,
        metadata: {
          account_id:  accountId  ?? null,
          contact_id:  contactId  ?? null,
          doc_type:    meta.doc_type    || null,
          notes:       meta.notes       || null,
          expiry_date: meta.expiry_date || null,
        },
        onProgress: setProgress,
      });
      setPending(null);
      setProgress(null);
    } catch (err) {
      setUploadError(err.message);
      setProgress(null);
    }
  };

  const download = async (doc) => {
    try {
      const url = await getSignedUrl(doc.storage_path);
      window.open(url, '_blank');
    } catch (err) {
      alert('Download failed: ' + err.message);
    }
  };

  return (
    <div>
      <RoleGate allow={['admin','sales','operations','compliance']}>
        {/* Drop zone */}
        {!pending && (
          <div
            className={`upload-zone${dragOver ? ' active' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
            <div style={{ fontSize: 24, marginBottom: 8, opacity: .5 }}>⬆</div>
            <div style={{ fontWeight: 500, fontSize: 13.5 }}>Drop a file or click to upload</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>PDF, DOC, DOCX, PNG, JPG · max 25 MB</div>
          </div>
        )}

        {/* Pending file — metadata form */}
        {pending && (
          <div className="card card-body" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 24 }}>📎</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 13.5 }}>{pending.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{fmtBytes(pending.size)}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => { setPending(null); setProgress(null); }}>Remove</button>
            </div>

            {progress !== null && (
              <div className="upload-progress" style={{ marginBottom: 12 }}>
                <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
              </div>
            )}

            <FormSelect label="Document type" value={meta.doc_type} onChange={v => setMeta(m => ({ ...m, doc_type: v }))} options={DOC_TYPES} />
            <FormField label="Expiry date (optional)" type="date" value={meta.expiry_date} onChange={v => setMeta(m => ({ ...m, expiry_date: v }))} />
            <FormTextarea label="Notes" value={meta.notes} onChange={v => setMeta(m => ({ ...m, notes: v }))} rows={2} />

            {uploadError && <div className="form-error" style={{ marginBottom: 8 }}>{uploadError}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => { setPending(null); setProgress(null); }}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={confirmUpload} disabled={upload.isPending}>
                {upload.isPending ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        )}

        {uploadError && !pending && <div className="form-error" style={{ marginBottom: 8 }}>{uploadError}</div>}
      </RoleGate>

      {/* Document list */}
      {docs.isLoading && <div className="skeleton skeleton-text" style={{ margin: '12px 0', width: '50%' }} />}
      {docs.data?.length === 0 && !pending && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '12px 0' }}>No documents uploaded</div>
      )}
      {docs.data?.map(doc => (
        <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 18 }}>📄</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'flex', gap: 8, marginTop: 2 }}>
              {doc.doc_type && <span>{doc.doc_type.replace(/_/g,' ')}</span>}
              <span>{fmtBytes(doc.file_size_bytes ?? 0)}</span>
              <span>{new Date(doc.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => download(doc)}>Download</button>
          <RoleGate allow={['admin','compliance']}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--red)' }}
              onClick={() => del.mutate({ id: doc.id, storage_path: doc.storage_path, account_id: accountId, contact_id: contactId })}
              disabled={del.isPending}
            >
              Delete
            </button>
          </RoleGate>
        </div>
      ))}
    </div>
  );
}
