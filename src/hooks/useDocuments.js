import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const BUCKET = 'documents';

export function useDocuments(filters = {}) {
  return useQuery({
    queryKey: ['documents', filters],
    queryFn: async () => {
      let q = supabase
        .from('documents')
        .select('id,file_name,storage_path,file_size_bytes,mime_type,doc_type,notes,expiry_date,version,uploaded_by,created_at,account_id,contact_id')
        .order('created_at', { ascending: false });
      if (filters.account) q = q.eq('account_id', filters.account);
      if (filters.contact) q = q.eq('contact_id', filters.contact);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!(filters.account || filters.contact),
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, metadata, onProgress }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const ext = file.name.split('.').pop();
      const path = `${metadata.account_id ?? metadata.contact_id ?? 'misc'}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      // Upload to storage with XHR for progress tracking
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;
        xhr.open('POST', url);
        xhr.setRequestHeader('Authorization', `Bearer ${(supabase.auth.getSession?.()?.data?.session?.access_token ?? '')}`);
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText)));
        xhr.onerror = () => reject(new Error('Upload failed'));
        // Use supabase client upload instead for auth simplicity
        xhr.abort();
        resolve();
      }).catch(() => null);

      // Use supabase client upload (simpler, handles auth)
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      onProgress?.(100);

      const { data, error } = await supabase.from('documents').insert({
        storage_path: path,
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type,
        uploaded_by: user?.id,
        ...metadata,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, { metadata }) => {
      qc.invalidateQueries({ queryKey: ['documents', { account: metadata.account_id }] });
      qc.invalidateQueries({ queryKey: ['documents', { contact: metadata.contact_id }] });
    },
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, storage_path, account_id, contact_id }) => {
      await supabase.storage.from(BUCKET).remove([storage_path]);
      const { error } = await supabase.from('documents').delete().eq('id', id);
      if (error) throw error;
      return { account_id, contact_id };
    },
    onSuccess: ({ account_id, contact_id }) => {
      qc.invalidateQueries({ queryKey: ['documents', { account: account_id }] });
      qc.invalidateQueries({ queryKey: ['documents', { contact: contact_id }] });
    },
  });
}

export async function getSignedUrl(storagePath) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}
