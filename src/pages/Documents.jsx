import Layout from '../components/Layout';

export default function Documents() {
  return (
    <Layout title="Documents">
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
        <div style={{ fontSize: 16, fontWeight: 500 }}>Documents</div>
        <div style={{ fontSize: 13.5, marginTop: 6 }}>
          View documents from the Accounts or Contacts detail pages.
        </div>
      </div>
    </Layout>
  );
}
