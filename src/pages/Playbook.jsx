import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { TierBadge } from './shared';
import { usePlaybookStats } from '../hooks/usePlaybook';

// ── Stage content ─────────────────────────────────────────────────────────────

const ENT_STAGES = [
  {
    key: 'prospecting',
    label: 'Prospecting',
    what: 'Initial outreach, qualifying the opportunity.',
    actions: ['Research the firm', 'Log first contact', 'Assess technical requirements'],
    fields: ['Segment', 'Asset classes', 'AUM estimate', 'Infrastructure needs'],
    moveWhen: 'Decision maker identified, interest confirmed',
    quickAction: { label: '→ Deals', path: '/deals' },
  },
  {
    key: 'qualified',
    label: 'Qualified',
    what: 'Confirmed interest, budget and authority established.',
    actions: ['Schedule discovery call', 'Understand current provider', 'Identify pain points'],
    fields: ['ADV estimate', 'FIX version needed', 'Colocation requirements'],
    moveWhen: 'Technical requirements documented, champion identified',
    quickAction: { label: '→ Deals', path: '/deals' },
  },
  {
    key: 'proposal',
    label: 'Proposal',
    what: 'Formal proposal submitted.',
    actions: ['Send pricing', 'Send SLA terms', 'Send connectivity specs'],
    fields: ['Estimated commission', 'Close date', 'Probability'],
    moveWhen: 'Proposal acknowledged, feedback received',
    quickAction: { label: '→ Deals', path: '/deals' },
  },
  {
    key: 'legal_compliance',
    label: 'Legal & Compliance',
    what: 'Legal review and KYC/AML initiated.',
    actions: ['Send NDA', 'Initiate KYC process', 'Legal review of agreements'],
    fields: ['KYC status', 'LEI', 'MPID', 'W8/W9'],
    moveWhen: 'KYC approved, legal review complete',
    quickAction: { label: '→ Accounts', path: '/accounts' },
  },
  {
    key: 'negotiating',
    label: 'Negotiating',
    what: 'Commercial terms being finalized.',
    actions: ['Negotiate pricing', 'Agree SLA terms', 'Finalize connectivity terms'],
    fields: ['Final commission rate', 'Agreement version'],
    moveWhen: 'Terms agreed, ready to execute',
    quickAction: { label: '→ Deals', path: '/deals' },
  },
  {
    key: 'onboarding',
    label: 'Onboarding',
    what: 'Technical and operational setup.',
    actions: ['FIX connectivity testing', 'MPID activation', 'Colocation provisioning', 'User training'],
    fields: ['MPID', 'Colo details', 'Go-live date'],
    moveWhen: 'First successful test trade',
    quickAction: { label: '→ Accounts', path: '/accounts' },
  },
  {
    key: 'live',
    label: 'Live',
    what: 'Client is live and trading.',
    actions: ['Monitor ADV', 'Check in regularly', 'Log all touchpoints', 'Watch for expansion opportunities'],
    fields: ['Account health score', 'ADV vs expected'],
    moveWhen: 'N/A — ongoing',
    quickAction: { label: '→ Accounts', path: '/accounts' },
  },
  {
    key: 'lost',
    label: 'Lost',
    what: 'Deal did not close.',
    actions: ['Log lost reason', 'Note competitor', 'Set follow-up reminder for 6 months'],
    fields: ['Lost reason', 'Competitor'],
    moveWhen: 'N/A',
    quickAction: { label: '→ Deals', path: '/deals' },
  },
];

const PRO_STAGES = ENT_STAGES;

const IND_STAGES = [
  {
    key: 'visitor',
    label: 'Visitor',
    what: 'Showed interest, not yet a lead.',
    actions: ['Capture UTM source', 'Log where they came from'],
    fields: ['UTM source', 'UTM medium', 'UTM campaign'],
    moveWhen: 'Email captured / signup form submitted',
    quickAction: { label: '→ Leads', path: '/leads' },
  },
  {
    key: 'lead',
    label: 'Lead',
    what: 'Contact info captured.',
    actions: ['Send welcome email', 'Assess fit'],
    fields: ['Source', 'Asset classes', 'Uses REST API'],
    moveWhen: 'Expressed intent to trade',
    quickAction: { label: '→ Leads', path: '/leads' },
  },
  {
    key: 'nurture',
    label: 'Nurture',
    what: 'Educating and warming the prospect.',
    actions: ['Email drip campaign', 'Share platform docs', 'Invite to webinar'],
    fields: ['Programming languages', 'Trading frequency'],
    moveWhen: 'Requested demo or API access',
    quickAction: { label: '→ Leads', path: '/leads' },
  },
  {
    key: 'activated',
    label: 'Activated',
    what: 'Connected to the platform.',
    actions: ['Onboarding support', 'Send API documentation'],
    fields: ['Uses REST API', 'Programming languages'],
    moveWhen: 'Successful API connection or first login',
    quickAction: { label: '→ Leads', path: '/leads' },
  },
  {
    key: 'funded',
    label: 'Funded',
    what: 'Account funded / deposit made.',
    actions: ['Confirm funding', 'Send trading guide'],
    fields: ['Funded amount', 'First funded date'],
    moveWhen: 'First deposit confirmed',
    quickAction: { label: '→ Leads', path: '/leads' },
  },
  {
    key: 'first_trade',
    label: 'First Trade',
    what: 'First trade placed.',
    actions: ['Congratulate', 'Offer support', 'Identify upgrade potential'],
    fields: ['First trade date', 'Asset classes traded'],
    moveWhen: 'Trade confirmed',
    quickAction: { label: '→ Leads', path: '/leads' },
  },
  {
    key: 'active',
    label: 'Active',
    what: 'Regularly trading.',
    actions: [
      'Monitor health score',
      'Watch for upgrade signals — high volume, FIX interest, multiple asset classes',
    ],
    fields: ['Contact health score'],
    moveWhen: 'Becomes dormant, OR upgrade to Pro/Enterprise',
    quickAction: { label: '→ Contacts', path: '/contacts' },
  },
  {
    key: 'dormant',
    label: 'Dormant',
    what: 'Was active, stopped trading.',
    actions: ['Re-engagement campaign', 'Promotional outreach', 'Check-in call'],
    fields: ['Last activity date'],
    moveWhen: 'Resumes trading → Active, or no response → Churned',
    quickAction: { label: '→ Leads', path: '/leads' },
  },
  {
    key: 'churned',
    label: 'Churned',
    what: 'No longer active, account closed.',
    actions: ['Log churn reason', 'Note for future win-back campaign'],
    fields: ['Churn reason', 'Churn date'],
    moveWhen: 'N/A',
    quickAction: { label: '→ Leads', path: '/leads' },
  },
];

// ── Design tokens ─────────────────────────────────────────────────────────────

const TC = {
  enterprise: 'var(--tier-enterprise)',
  pro:        'var(--tier-pro)',
  individual: 'var(--tier-individual)',
};

// ── Shared flow primitives ────────────────────────────────────────────────────

function Arrow({ tierColor, label }) {
  const c = tierColor ?? 'var(--border)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 0' }}>
      {label && (
        <span style={{
          fontSize: 10.5, color: 'var(--text-tertiary)', background: 'var(--bg-secondary)',
          border: '1px solid var(--border)', padding: '1px 8px', borderRadius: 20, marginBottom: 4,
        }}>
          {label}
        </span>
      )}
      <div style={{ width: 2, height: 20, background: c, opacity: 0.35 }} />
      <div style={{
        width: 0, height: 0,
        borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
        borderTop: `7px solid ${c}`, opacity: 0.35,
      }} />
    </div>
  );
}

function StartNode({ label, sub }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{
        background: 'var(--text-primary)', color: '#fff',
        borderRadius: 30, padding: '9px 26px',
        fontSize: 13.5, fontWeight: 600,
        display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        boxShadow: 'var(--shadow-sm)',
      }}>
        {label}
        {sub && <span style={{ fontSize: 11, opacity: 0.6, fontWeight: 400 }}>{sub}</span>}
      </div>
    </div>
  );
}

function EndNode({ label }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{
        background: 'var(--green)', color: '#fff',
        borderRadius: 30, padding: '9px 26px',
        fontSize: 13.5, fontWeight: 600,
        boxShadow: 'var(--shadow-sm)',
      }}>
        ✓ {label}
      </div>
    </div>
  );
}

function ProcessNode({ title, sub, fields, action, actionPath, tierColor }) {
  const navigate = useNavigate();
  return (
    <div style={{
      background: 'var(--bg-primary)',
      border: `1.5px solid var(--border)`,
      borderLeft: `4px solid ${tierColor}`,
      borderRadius: 8,
      padding: '14px 18px',
      maxWidth: 480,
      width: '100%',
      margin: '0 auto',
      boxShadow: 'var(--shadow-xs)',
    }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: (sub || fields?.length) ? 6 : 0 }}>
        {title}
      </div>
      {sub && (
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: fields?.length ? 10 : 0 }}>
          {sub}
        </div>
      )}
      {fields?.length > 0 && (
        <div style={{ marginBottom: action ? 12 : 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Fields</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {fields.map(f => (
              <span key={f} style={{
                fontSize: 11.5, background: 'var(--bg-secondary)',
                border: '1px solid var(--border)', padding: '2px 8px',
                borderRadius: 4, color: 'var(--text-secondary)',
              }}>{f}</span>
            ))}
          </div>
        </div>
      )}
      {action && (
        <div style={{ marginTop: 12 }}>
          <button
            className="btn btn-sm"
            style={{ background: tierColor, color: '#fff', border: 'none', fontSize: 12 }}
            onClick={() => navigate(actionPath)}
          >
            {action}
          </button>
        </div>
      )}
    </div>
  );
}

function DecisionNode({ question, branches }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{
        background: '#fffbeb',
        border: '2px dashed #fcd34d',
        borderRadius: 8,
        padding: '12px 20px',
        maxWidth: 480,
        width: '100%',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#b45309', marginBottom: 5 }}>
          Decision Point
        </div>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#92400e', marginBottom: 12 }}>{question}</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          {branches.map((b, i) => (
            <span key={i} style={{
              fontSize: 12,
              background: b.primary ? 'var(--bg-tertiary)' : '#fef3c7',
              border: `1px solid ${b.primary ? 'var(--border)' : '#fcd34d'}`,
              borderRadius: 20,
              padding: '3px 12px',
              color: b.primary ? 'var(--text-secondary)' : '#92400e',
              fontWeight: b.primary ? 400 : 500,
            }}>
              {b.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Stage pipeline ────────────────────────────────────────────────────────────

function StagePipeline({ stages, tierColor, pipelineLabel }) {
  const [selected, setSelected] = useState(null);
  const navigate = useNavigate();
  const detail = selected ? stages.find(s => s.key === selected) : null;

  return (
    <div style={{ maxWidth: 640, width: '100%', margin: '0 auto' }}>
      <div style={{
        fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
        color: 'var(--text-tertiary)', marginBottom: 8, textAlign: 'center',
      }}>
        {pipelineLabel ?? 'Pipeline'} — click any stage for details
      </div>

      <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 'max-content', padding: '2px 0' }}>
          {stages.map((stage, idx) => (
            <div key={stage.key} style={{ display: 'flex', alignItems: 'center' }}>
              {idx > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, width: 22 }}>
                  <div style={{ flex: 1, height: 1.5, background: selected === stage.key ? tierColor : 'var(--border)' }} />
                  <div style={{
                    width: 0, height: 0,
                    borderTop: '4px solid transparent', borderBottom: '4px solid transparent',
                    borderLeft: `5px solid ${selected === stage.key ? tierColor : 'var(--border)'}`,
                  }} />
                </div>
              )}
              <div
                onClick={() => setSelected(selected === stage.key ? null : stage.key)}
                style={{
                  padding: '7px 13px',
                  background: selected === stage.key ? tierColor + '1a' : 'var(--bg-primary)',
                  border: `1.5px solid ${selected === stage.key ? tierColor : 'var(--border)'}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: selected === stage.key ? 600 : 400,
                  fontSize: 12.5,
                  color: selected === stage.key ? tierColor : 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  transition: 'border-color 0.15s, color 0.15s, background 0.15s',
                  userSelect: 'none',
                  boxShadow: 'var(--shadow-xs)',
                }}
              >
                {stage.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {detail && (
        <div
          key={selected}
          className="playbook-detail-anim"
          style={{
            marginTop: 10,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderLeft: `4px solid ${tierColor}`,
            borderRadius: 8,
            padding: '16px 20px',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: tierColor }}>{detail.label}</div>
            <button
              onClick={() => setSelected(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: 'var(--text-tertiary)', lineHeight: 1, padding: '0 0 0 8px' }}
            >✕</button>
          </div>

          <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.5 }}>
            {detail.what}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-tertiary)', marginBottom: 6 }}>Key actions</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
                {detail.actions.map((a, i) => (
                  <li key={i} style={{ marginBottom: 4, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{a}</li>
                ))}
              </ul>
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-tertiary)', marginBottom: 6 }}>Fields to complete</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {detail.fields.map(f => (
                  <span key={f} style={{
                    fontSize: 11.5, background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)', padding: '2px 8px',
                    borderRadius: 4, color: 'var(--text-secondary)',
                  }}>{f}</span>
                ))}
              </div>
            </div>
          </div>

          <div style={{
            padding: '10px 14px', background: 'var(--bg-secondary)',
            borderRadius: 6, fontSize: 13, marginBottom: 12,
          }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Move to next stage when: </span>
            <span style={{ color: 'var(--text-secondary)' }}>{detail.moveWhen}</span>
          </div>

          <div style={{ textAlign: 'right' }}>
            <button
              className="btn btn-sm"
              style={{ background: tierColor, color: '#fff', border: 'none', fontSize: 12 }}
              onClick={() => navigate(detail.quickAction.path)}
            >
              {detail.quickAction.label}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Upgrade callout (Individual → Pro/Enterprise) ─────────────────────────────

function UpgradeCallout() {
  const navigate = useNavigate();
  return (
    <div style={{
      maxWidth: 480, width: '100%', margin: '24px auto 0',
      background: '#fffbeb', border: '2px dashed #fcd34d',
      borderRadius: 10, padding: '18px 22px',
    }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: '#b45309', marginBottom: 8 }}>
        ↑ Upgrading from Individual?
      </div>
      <div style={{ fontSize: 13, color: '#92400e', marginBottom: 12, lineHeight: 1.5 }}>
        When an Individual lead shows Pro signals (FIX interest, entity formation, high volume), convert them directly.
      </div>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#92400e' }}>
        <li style={{ marginBottom: 4 }}>Open the Lead record</li>
        <li style={{ marginBottom: 4 }}>Click <strong>Convert</strong></li>
        <li style={{ marginBottom: 4 }}>Select <strong>Pro</strong> or <strong>Enterprise</strong></li>
        <li>Create Deal (optional) or Convert Only</li>
      </ol>
      <div style={{ marginTop: 14 }}>
        <button
          className="btn btn-sm"
          style={{ background: '#b45309', color: '#fff', border: 'none', fontSize: 12 }}
          onClick={() => navigate('/leads')}
        >
          → View Individual Leads
        </button>
      </div>
    </div>
  );
}

// ── Tier workflow diagrams ────────────────────────────────────────────────────

function EnterpriseFlow() {
  const tc = TC.enterprise;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, padding: '4px 0 24px' }}>
      <StartNode label="New Prospect" sub="Institutional — Hedge Fund, HFT, Quant Fund, Broker-Dealer" />
      <Arrow tierColor={tc} />

      <ProcessNode
        title="Create Contact"
        fields={['Name', 'Email', 'Phone', 'Title', 'Segment']}
        action="→ New Contact"
        actionPath="/contacts"
        tierColor={tc}
      />
      <Arrow tierColor={tc} />

      <DecisionNode
        question="Entity or Individual?"
        branches={[
          { label: '← Individual → see Individual / Pro flow', primary: false },
          { label: '↓ Entity — continue below', primary: true },
        ]}
      />
      <Arrow tierColor={tc} label="Entity" />

      <ProcessNode
        title="Create Account"
        fields={['Legal entity name', 'LEI', 'MPID', 'Jurisdiction', 'Segment (HFT / Hedge Fund / Quant / BD / Family Office)']}
        action="→ New Account"
        actionPath="/accounts"
        tierColor={tc}
      />
      <Arrow tierColor={tc} />

      <ProcessNode
        title="Link Contact to Account"
        sub="Assign role (Head of Trading, CTO, PM, Compliance, CFO) and mark as primary contact."
        action="→ Link Contact"
        actionPath="/contacts"
        tierColor={tc}
      />
      <Arrow tierColor={tc} />

      <ProcessNode
        title="Create Deal"
        fields={['Deal name', 'Stage: Prospecting', 'Asset classes', 'Infrastructure requirements', 'Close date', 'Probability']}
        action="→ New Deal"
        actionPath="/deals"
        tierColor={tc}
      />
      <Arrow tierColor={tc} />

      <StagePipeline stages={ENT_STAGES} tierColor={tc} pipelineLabel="Deal Pipeline" />

      <Arrow tierColor={tc} label="from Live" />

      <ProcessNode
        title="Account Goes Active"
        sub="Health Score activates. RM assigned. Ongoing: log calls, emails, and meetings. Monitor ADV vs expected and watch for expansion opportunities."
        tierColor={tc}
      />
      <Arrow tierColor={tc} />

      <EndNode label="Active Enterprise Client" />
    </div>
  );
}

function ProFlow() {
  const tc = TC.pro;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, padding: '4px 0 24px' }}>
      <StartNode label="New Pro Prospect" sub="Web signup · referral · Individual upgrade" />
      <Arrow tierColor={tc} />

      <DecisionNode
        question="Upgrading from Individual?"
        branches={[
          { label: '← Yes → Convert Lead (see callout below)', primary: false },
          { label: '↓ No, new prospect — continue below', primary: true },
        ]}
      />
      <Arrow tierColor={tc} label="New prospect" />

      <ProcessNode
        title="Create Contact"
        fields={['Name', 'Email', 'Uses FIX', 'Uses REST API', 'Programming languages', 'ADV estimate']}
        action="→ New Contact"
        actionPath="/contacts"
        tierColor={tc}
      />
      <Arrow tierColor={tc} />

      <DecisionNode
        question="Entity or individual trader?"
        branches={[
          { label: '← Individual trader (prop trader, solo quant) — Account optional', primary: false },
          { label: '↓ Entity (small prop firm, family office)', primary: true },
        ]}
      />
      <Arrow tierColor={tc} label="Entity" />

      <ProcessNode
        title="Create Account"
        fields={['Legal entity name', 'Jurisdiction', 'Segment', 'AUM']}
        action="→ New Account"
        actionPath="/accounts"
        tierColor={tc}
      />
      <Arrow tierColor={tc} />

      <ProcessNode
        title="Create Deal"
        fields={['Deal name', 'Stage: Prospecting', 'Asset classes', 'Infrastructure', 'Close date']}
        action="→ New Deal"
        actionPath="/deals"
        tierColor={tc}
      />
      <Arrow tierColor={tc} />

      <StagePipeline stages={PRO_STAGES} tierColor={tc} pipelineLabel="Deal Pipeline" />

      <Arrow tierColor={tc} label="from Live" />

      <ProcessNode
        title="Account / Contact Goes Active"
        sub="Account Health Score activates (if entity). Contact Health Score activates (if individual trader). Ongoing: log all touchpoints."
        tierColor={tc}
      />
      <Arrow tierColor={tc} />

      <EndNode label="Active Pro Client" />

      <UpgradeCallout />
    </div>
  );
}

function IndividualFlow() {
  const tc = TC.individual;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, padding: '4px 0 24px' }}>
      <StartNode label="New Individual" sub="Web signup · marketing campaign · referral · organic" />
      <Arrow tierColor={tc} />

      <ProcessNode
        title="Contact + Lead Created"
        sub="UTM tracking captured: source, medium, campaign."
        fields={['Name', 'Email', 'Tier: Individual', 'Source', 'UTM params', 'Asset classes', 'Uses REST API', 'Programming languages']}
        action="→ New Lead"
        actionPath="/leads"
        tierColor={tc}
      />
      <Arrow tierColor={tc} />

      <StagePipeline stages={IND_STAGES} tierColor={tc} pipelineLabel="Lead Pipeline" />

      <Arrow tierColor={tc} label="from Active stage" />

      <DecisionNode
        question="Upgrade potential?"
        branches={[
          { label: '↑ Yes — High ADV, FIX interest, entity formation, multi-asset, programmatic volume', primary: false },
          { label: '→ No — continue monitoring health score', primary: true },
        ]}
      />
      <Arrow tierColor={tc} label="Upgrade" />

      <ProcessNode
        title="Convert Lead"
        sub="Open Lead → Click Convert → Choose Pro or Enterprise → Create Deal (optional) or Convert Only. Lead is marked Converted. Contact Health Score hands off to Deal Score."
        action="→ View Leads"
        actionPath="/leads"
        tierColor={tc}
      />
      <Arrow tierColor={tc} />

      <EndNode label="Upgraded to Pro or Enterprise" />
    </div>
  );
}

// ── Tier overview cards ───────────────────────────────────────────────────────

const CARD_META = {
  enterprise: {
    subtitle: 'Institutional B2B — Hedge Funds, HFT, Quant Funds, Broker-Dealers',
    miniFlow: ['Contact', 'Account', 'Deal', 'Live'],
  },
  pro: {
    subtitle: 'Professional traders, prop desks, quant developers',
    miniFlow: ['Contact', 'Account', 'Deal', 'Live'],
  },
  individual: {
    subtitle: 'Self-serve traders, algo developers, retail clients',
    miniFlow: ['Contact', 'Lead', 'Active', 'Convert ↑'],
  },
};

function TierCard({ tier, stats, active, onClick }) {
  const tc = TC[tier];
  const meta = CARD_META[tier];
  const isB2B = tier !== 'individual';

  const stat1 = isB2B
    ? { value: stats?.data?.[tier]?.accounts ?? '—', label: 'active accounts' }
    : { value: stats?.data?.individual?.leads ?? '—', label: 'active leads' };
  const stat2 = isB2B
    ? { value: stats?.data?.[tier]?.deals ?? '—', label: 'open deals' }
    : { value: stats?.data?.individual?.converted ?? '—', label: 'converted' };

  return (
    <div
      onClick={onClick}
      style={{
        flex: '1 1 200px',
        background: 'var(--bg-primary)',
        border: `2px solid ${active ? tc : 'var(--border)'}`,
        borderRadius: 10,
        padding: '16px 18px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: active ? `0 0 0 3px ${tc}22` : 'var(--shadow-xs)',
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <TierBadge tier={tier} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 14, lineHeight: 1.5 }}>
        {meta.subtitle}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {meta.miniFlow.map((step, idx) => (
          <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {idx > 0 && <span style={{ color: tc, fontSize: 11, opacity: 0.7 }}>→</span>}
            <span style={{
              fontSize: 11,
              background: active ? tc + '18' : 'var(--bg-secondary)',
              border: `1px solid ${active ? tc + '50' : 'var(--border)'}`,
              color: active ? tc : 'var(--text-secondary)',
              padding: '2px 9px', borderRadius: 20, fontWeight: 500,
            }}>{step}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{stat1.value}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{stat1.label}</div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{stat2.value}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{stat2.label}</div>
        </div>
      </div>

      <button
        className="btn btn-sm"
        style={{
          background: active ? tc : 'transparent',
          color: active ? '#fff' : tc,
          border: `1.5px solid ${tc}`,
          fontSize: 12,
          width: '100%',
          justifyContent: 'center',
        }}
      >
        {active ? 'Viewing Workflow ✓' : 'View Workflow →'}
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const FLOWS = {
  enterprise: <EnterpriseFlow />,
  pro:        <ProFlow />,
  individual: <IndividualFlow />,
};

export default function Playbook() {
  const [activeTier, setActiveTier] = useState('enterprise');
  const stats = usePlaybookStats();

  return (
    <Layout title="Playbook">
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          How to use the CRM — from first contact to active client
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 4 }}>
          Last updated: June 12, 2026
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
        {['enterprise', 'pro', 'individual'].map(tier => (
          <TierCard
            key={tier}
            tier={tier}
            stats={stats}
            active={activeTier === tier}
            onClick={() => setActiveTier(tier)}
          />
        ))}
      </div>

      <div
        key={activeTier}
        className="playbook-anim"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '24px 20px',
          marginBottom: 24,
        }}
      >
        <div style={{
          fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: 0.5,
          marginBottom: 20, textAlign: 'center',
        }}>
          {activeTier === 'enterprise' ? 'Enterprise' : activeTier === 'pro' ? 'Pro' : 'Individual'} Workflow
        </div>
        {FLOWS[activeTier]}
      </div>
    </Layout>
  );
}
