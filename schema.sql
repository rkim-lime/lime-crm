-- ============================================================
-- lime-crm Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

create type user_role as enum (
  'admin',
  'partner',
  'sales',
  'operations',
  'compliance',
  'analyst'
);

create type account_segment as enum (
  'hft',        -- High Frequency Trading Firm
  'hedge_fund',
  'quant_fund',
  'broker_dealer',
  'prop_trader',
  'algo_trader',
  'dma_user',
  'retail'
);

create type account_tier as enum (
  'institutional',
  'professional',
  'retail'
);

create type account_status as enum (
  'prospect',
  'active',
  'inactive',
  'suspended',
  'churned'
);

create type deal_stage as enum (
  'prospecting',
  'qualified',
  'proposal_sent',
  'technical_due_diligence',
  'negotiating',
  'onboarding',
  'closed_won',
  'closed_lost'
);

create type deal_motion as enum (
  'institutional_b2b',
  'retail_funnel'
);

create type asset_class as enum (
  'equities',
  'options',
  'futures'
);

create type contact_status as enum (
  'active',
  'warm',
  'cold',
  'new',
  'unsubscribed'
);

create type kyc_status as enum (
  'not_started',
  'in_progress',
  'pending_review',
  'approved',
  'rejected',
  'expired'
);

create type aml_status as enum (
  'clear',
  'flagged',
  'under_review',
  'escalated'
);

create type task_status as enum (
  'open',
  'in_progress',
  'completed',
  'cancelled'
);

create type task_priority as enum (
  'low',
  'medium',
  'high',
  'urgent'
);

create type activity_type as enum (
  'email',
  'call',
  'meeting',
  'note',
  'deal_stage_change',
  'document_uploaded',
  'task_completed',
  'onboarding_step'
);

create type document_type as enum (
  'nda',
  'master_agreement',
  'account_agreement',
  'kyc_document',
  'aml_document',
  'w9',
  'w8ben',
  'finra_registration',
  'other'
);

create type fix_version as enum (
  'fix_4_2',
  'fix_4_4',
  'fix_5_0',
  'fixatdl'
);

create type order_routing as enum (
  'retail_mm',       -- Retail market maker routing (PFOF)
  'dma',             -- Direct Market Access
  'sor',             -- Smart Order Routing
  'algo',            -- Algorithmic
  'colo'             -- Co-location / hosted algo
);

create type jurisdiction as enum (
  'us',
  'uk',
  'eu',
  'cayman',
  'singapore',
  'hong_kong',
  'other'
);

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null,
  full_name       text,
  avatar_url      text,
  role            user_role not null default 'analyst',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- ACCOUNTS
-- ============================================================

create table public.accounts (
  id                    uuid primary key default gen_random_uuid(),

  -- Core
  name                  text not null,
  segment               account_segment not null,
  tier                  account_tier not null default 'institutional',
  status                account_status not null default 'prospect',
  owner_id              uuid references public.profiles(id) on delete set null,

  -- Legal / Regulatory
  legal_entity_name     text,
  lei                   text,                    -- Legal Entity Identifier (20-char ISO 17442)
  mpid                  text,                    -- Market Participant ID (FINRA)
  crd_number            text,                    -- FINRA CRD number (for BDs)
  dtcc_participant_id   text,
  jurisdiction          jurisdiction,
  incorporation_country text,
  incorporation_state   text,

  -- Trading Profile
  asset_classes         asset_class[] default '{}',
  order_routing         order_routing[],
  fix_version           fix_version,
  colo_provider         text,                    -- e.g. "Equinix NY4", "NY5"
  colo_cage             text,
  avg_daily_volume_usd  bigint,                  -- estimated ADV in USD
  aum_usd               bigint,                  -- AUM in USD (for funds)

  -- Compliance
  kyc_status            kyc_status not null default 'not_started',
  kyc_approved_at       timestamptz,
  kyc_expiry_date       date,
  aml_status            aml_status not null default 'clear',
  aml_last_reviewed_at  timestamptz,
  accredited_investor   boolean,
  qualified_purchaser   boolean,
  finra_member          boolean default false,

  -- Metadata
  website               text,
  linkedin_url          text,
  notes                 text,
  tags                  text[] default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles(id) on delete set null
);

-- ============================================================
-- CONTACTS
-- ============================================================

create table public.contacts (
  id                    uuid primary key default gen_random_uuid(),

  -- Core
  first_name            text not null,
  last_name             text not null,
  email                 text,
  phone                 text,
  mobile                text,
  title                 text,
  department            text,

  -- Segmentation
  segment               account_segment,
  status                contact_status not null default 'new',
  lead_score            integer default 0 check (lead_score >= 0 and lead_score <= 100),
  owner_id              uuid references public.profiles(id) on delete set null,

  -- Location
  jurisdiction          jurisdiction,
  country               text,
  timezone              text,

  -- Trading / Technical profile (for individual/retail contacts)
  asset_classes         asset_class[] default '{}',
  order_routing         order_routing[],
  uses_fix              boolean default false,
  uses_rest_api         boolean default false,
  programming_languages text[],               -- e.g. ['python', 'c++', 'rust']

  -- Compliance (visible to compliance role only via RLS)
  kyc_status            kyc_status not null default 'not_started',
  kyc_approved_at       timestamptz,
  aml_status            aml_status not null default 'clear',
  accredited_investor   boolean,
  finra_registered      boolean default false,
  finra_crd             text,

  -- Engagement
  last_contacted_at     timestamptz,
  source                text,                 -- e.g. 'referral', 'conference', 'web_signup'
  do_not_contact        boolean default false,
  linkedin_url          text,
  notes                 text,
  tags                  text[] default '{}',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles(id) on delete set null
);

-- ============================================================
-- ACCOUNT_CONTACTS (junction — org chart relationships)
-- ============================================================

create table public.account_contacts (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  role        text,             -- e.g. "Head of Trading", "CTO", "Compliance Officer"
  is_primary  boolean default false,
  created_at  timestamptz not null default now(),
  unique(account_id, contact_id)
);

-- ============================================================
-- DEALS
-- ============================================================

create table public.deals (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid references public.accounts(id) on delete set null,
  contact_id            uuid references public.contacts(id) on delete set null,
  owner_id              uuid references public.profiles(id) on delete set null,

  name                  text not null,
  motion                deal_motion not null default 'institutional_b2b',
  stage                 deal_stage not null default 'prospecting',

  -- Financials
  estimated_adv_usd     bigint,              -- estimated daily volume contribution
  estimated_commission  numeric(12,4),       -- estimated annual commission $
  close_date            date,
  probability           integer default 0 check (probability >= 0 and probability <= 100),

  -- Context
  asset_classes         asset_class[] default '{}',
  order_routing         order_routing[],
  fix_required          boolean default false,
  colo_required         boolean default false,
  notes                 text,
  lost_reason           text,
  competitor            text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles(id) on delete set null,
  closed_at             timestamptz
);

-- ============================================================
-- TASKS
-- ============================================================

create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  status        task_status not null default 'open',
  priority      task_priority not null default 'medium',
  due_date      timestamptz,
  completed_at  timestamptz,

  -- Associations (any combination)
  account_id    uuid references public.accounts(id) on delete cascade,
  contact_id    uuid references public.contacts(id) on delete cascade,
  deal_id       uuid references public.deals(id) on delete cascade,

  assigned_to   uuid references public.profiles(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- DOCUMENTS
-- ============================================================

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  doc_type        document_type not null,
  storage_path    text,            -- Supabase Storage bucket path
  file_size_bytes bigint,
  mime_type       text,
  version         integer default 1,
  is_executed     boolean default false,
  executed_at     timestamptz,
  expiry_date     date,
  notes           text,

  -- Associations
  account_id      uuid references public.accounts(id) on delete cascade,
  contact_id      uuid references public.contacts(id) on delete cascade,
  deal_id         uuid references public.deals(id) on delete cascade,

  uploaded_by     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ============================================================
-- ACTIVITIES (audit / timeline log)
-- ============================================================

create table public.activities (
  id            uuid primary key default gen_random_uuid(),
  type          activity_type not null,
  title         text not null,
  body          text,
  occurred_at   timestamptz not null default now(),

  -- Associations
  account_id    uuid references public.accounts(id) on delete cascade,
  contact_id    uuid references public.contacts(id) on delete cascade,
  deal_id       uuid references public.deals(id) on delete cascade,
  task_id       uuid references public.tasks(id) on delete cascade,
  document_id   uuid references public.documents(id) on delete cascade,

  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),

  -- For email/calendar integrations
  external_id   text,            -- Gmail message ID, Google Calendar event ID, etc.
  metadata      jsonb default '{}'
);

-- ============================================================
-- UPDATED_AT triggers
-- ============================================================

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();
create trigger set_updated_at before update on public.accounts
  for each row execute procedure public.set_updated_at();
create trigger set_updated_at before update on public.contacts
  for each row execute procedure public.set_updated_at();
create trigger set_updated_at before update on public.deals
  for each row execute procedure public.set_updated_at();
create trigger set_updated_at before update on public.tasks
  for each row execute procedure public.set_updated_at();
create trigger set_updated_at before update on public.documents
  for each row execute procedure public.set_updated_at();

-- ============================================================
-- INDEXES
-- ============================================================

create index on public.accounts(owner_id);
create index on public.accounts(status);
create index on public.accounts(segment);
create index on public.accounts(kyc_status);
create index on public.contacts(owner_id);
create index on public.contacts(status);
create index on public.contacts(segment);
create index on public.contacts(lead_score desc);
create index on public.account_contacts(account_id);
create index on public.account_contacts(contact_id);
create index on public.deals(account_id);
create index on public.deals(owner_id);
create index on public.deals(stage);
create index on public.deals(motion);
create index on public.tasks(assigned_to);
create index on public.tasks(due_date);
create index on public.tasks(status);
create index on public.activities(account_id, occurred_at desc);
create index on public.activities(contact_id, occurred_at desc);
create index on public.activities(deal_id, occurred_at desc);
create index on public.documents(account_id);
create index on public.documents(contact_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles         enable row level security;
alter table public.accounts         enable row level security;
alter table public.contacts         enable row level security;
alter table public.account_contacts enable row level security;
alter table public.deals            enable row level security;
alter table public.tasks            enable row level security;
alter table public.documents        enable row level security;
alter table public.activities       enable row level security;

-- Helper: get current user's role
create or replace function public.current_user_role()
returns user_role as $$
  select role from public.profiles where id = auth.uid();
$$ language sql security definer stable;

-- Helper: is current user admin
create or replace function public.is_admin()
returns boolean as $$
  select current_user_role() = 'admin';
$$ language sql security definer stable;

-- ── PROFILES ──────────────────────────────────────────────
-- Users can read their own profile; admins can read all
create policy "profiles_select" on public.profiles for select
  using (id = auth.uid() or is_admin());

create policy "profiles_update_self" on public.profiles for update
  using (id = auth.uid());

create policy "profiles_admin_all" on public.profiles for all
  using (is_admin());

-- ── ACCOUNTS ──────────────────────────────────────────────
-- All authenticated users can read accounts
create policy "accounts_select" on public.accounts for select
  using (auth.uid() is not null);

-- Sales can insert/update their own accounts; ops can update; admin can all
create policy "accounts_insert" on public.accounts for insert
  with check (
    current_user_role() in ('admin', 'sales', 'operations')
  );

create policy "accounts_update" on public.accounts for update
  using (
    is_admin()
    or current_user_role() = 'operations'
    or (current_user_role() = 'sales' and owner_id = auth.uid())
  );

create policy "accounts_delete" on public.accounts for delete
  using (is_admin());

-- ── CONTACTS ──────────────────────────────────────────────
create policy "contacts_select" on public.contacts for select
  using (auth.uid() is not null);

create policy "contacts_insert" on public.contacts for insert
  with check (current_user_role() in ('admin', 'sales', 'operations'));

create policy "contacts_update" on public.contacts for update
  using (
    is_admin()
    or current_user_role() = 'operations'
    or (current_user_role() = 'sales' and owner_id = auth.uid())
  );

create policy "contacts_delete" on public.contacts for delete
  using (is_admin());

-- ── ACCOUNT_CONTACTS ──────────────────────────────────────
create policy "account_contacts_select" on public.account_contacts for select
  using (auth.uid() is not null);

create policy "account_contacts_write" on public.account_contacts for all
  using (current_user_role() in ('admin', 'sales', 'operations'));

-- ── DEALS ─────────────────────────────────────────────────
create policy "deals_select" on public.deals for select
  using (auth.uid() is not null);

create policy "deals_insert" on public.deals for insert
  with check (current_user_role() in ('admin', 'sales'));

create policy "deals_update" on public.deals for update
  using (
    is_admin()
    or (current_user_role() = 'sales' and owner_id = auth.uid())
  );

create policy "deals_delete" on public.deals for delete
  using (is_admin());

-- ── TASKS ─────────────────────────────────────────────────
create policy "tasks_select" on public.tasks for select
  using (auth.uid() is not null);

create policy "tasks_write" on public.tasks for all
  using (
    is_admin()
    or assigned_to = auth.uid()
    or created_by = auth.uid()
    or current_user_role() in ('sales', 'operations')
  );

-- ── DOCUMENTS ─────────────────────────────────────────────
create policy "documents_select" on public.documents for select
  using (auth.uid() is not null);

create policy "documents_insert" on public.documents for insert
  with check (current_user_role() in ('admin', 'sales', 'operations', 'compliance'));

create policy "documents_update" on public.documents for update
  using (
    is_admin()
    or current_user_role() in ('operations', 'compliance')
    or uploaded_by = auth.uid()
  );

create policy "documents_delete" on public.documents for delete
  using (is_admin() or current_user_role() = 'compliance');

-- ── ACTIVITIES ────────────────────────────────────────────
create policy "activities_select" on public.activities for select
  using (auth.uid() is not null);

create policy "activities_insert" on public.activities for insert
  with check (auth.uid() is not null);

create policy "activities_update" on public.activities for update
  using (is_admin() or created_by = auth.uid());

-- ============================================================
-- UAT SEED DATA
-- ============================================================

-- NOTE: Profiles are created automatically via the auth trigger when
-- users sign up. To seed test users for UAT, create them via:
-- Supabase Dashboard → Authentication → Users → Add User
-- Then update their role here:
--
-- update public.profiles set role = 'admin' where email = 'your@email.com';

-- Seed accounts
insert into public.accounts (name, segment, tier, status, legal_entity_name, lei, mpid, jurisdiction, asset_classes, order_routing, fix_version, avg_daily_volume_usd, aum_usd, kyc_status, aml_status, accredited_investor, qualified_purchaser, finra_member, notes) values
('Meridian Capital LP',   'hedge_fund',     'institutional', 'active',   'Meridian Capital LP',          'MERIDIAN0000000000001', 'MERD', 'cayman',    array['equities','options']::asset_class[],           array['dma','sor']::order_routing[],  'fix_4_4', 40000000,  2400000000, 'approved', 'clear', true, true,  false, 'Requires FIX 4.4 integration, colocation at NY4. Live trading volume ~$40M/day.'),
('Apex HFT Systems',      'hft',            'institutional', 'active',   'Apex HFT Systems Inc',         'APEXHFT0000000000001',  'APHX', 'us',        array['equities','futures']::asset_class[],           array['colo','dma']::order_routing[],  'fix_4_4', 200000000, null,       'approved', 'clear', null,  null,  false, 'Latency requirements sub-100μs. Evaluating co-lo options at NY4/NY5. Decision Q3.'),
('Sigma Quant Partners',  'quant_fund',     'institutional', 'prospect', 'Sigma Quant Partners LLC',     'SIGMAQP0000000000001',  null,   'us',        array['equities','options','futures']::asset_class[], array['algo','sor']::order_routing[],  'fix_4_2', 15000000,  820000000,  'in_progress','clear',true, false, false, 'Python/C++ stack, interested in smart order routing algos.'),
('Frontier Securities LLC','broker_dealer', 'institutional', 'active',   'Frontier Securities LLC',      'FRONTSC0000000000001',  'FRNT', 'us',        array['equities']::asset_class[],                     array['retail_mm','dma']::order_routing[], null,   5000000,   null,       'approved', 'clear', null,  null,  true,  'Correspondent BD, routing equities order flow. MPID assigned.'),
('BluePath Trading',      'prop_trader',    'professional',  'prospect', 'BluePath Trading Group LLC',   null,                    null,   'us',        array['equities','options']::asset_class[],           array['dma','sor']::order_routing[],  null,      8000000,   null,       'in_progress','clear',null,  null,  false, '16-person prop desk, interested in DMA + smart routing for options.'),
('Lighthouse Fund',       'hedge_fund',     'institutional', 'prospect', 'Lighthouse Capital Fund Ltd',  'LHTCAP0000000000001',   null,   'cayman',    array['futures']::asset_class[],                      array['algo']::order_routing[],       'fix_4_4', 3000000,   340000000,  'not_started','clear',true, false, false, 'Futures focused. Currently with competitor. Re-engage Q4.');

-- Seed contacts
insert into public.contacts (first_name, last_name, email, phone, title, segment, status, lead_score, jurisdiction, asset_classes, order_routing, uses_fix, uses_rest_api, kyc_status, aml_status, accredited_investor, source) values
('David',  'Chen',    'd.chen@meridiancap.com',   '+12125550181', 'Head of Trading',       'hedge_fund',     'active', 92, 'us', array['equities','options']::asset_class[], array['dma','sor']::order_routing[], true,  false, 'approved',    'clear', true,  'referral'),
('Rachel', 'Ngo',     'r.ngo@apexhft.com',        '+16465550034', 'CTO',                   'hft',            'active', 88, 'us', array['equities','futures']::asset_class[], array['colo','dma']::order_routing[], true, false, 'approved',    'clear', null,  'conference'),
('James',  'Liu',     'j.liu@sigmaquant.io',       '+12125550276', 'Portfolio Manager',     'quant_fund',     'warm',   74, 'us', array['equities','options','futures']::asset_class[], array['algo','sor']::order_routing[], true, false, 'in_progress','clear', true,  'referral'),
('Maria',  'Santos',  'm.santos@frontiersec.com',  '+17185550099', 'COO',                   'broker_dealer',  'active', 96, 'us', array['equities']::asset_class[], array['retail_mm','dma']::order_routing[], false, false, 'approved',   'clear', null,  'conference'),
('Tom',    'Wallis',  't.wallis@bluepath.co',      '+13125550145', 'Head Trader',           'prop_trader',    'warm',   61, 'us', array['equities','options']::asset_class[], array['dma','sor']::order_routing[], false, false, 'in_progress','clear', null,  'web_signup'),
('Aiko',   'Yamamoto','aiko@dev.io',               '+81355550182', 'Quant Developer',       'algo_trader',    'new',    45, 'other', array['equities','futures']::asset_class[], array['algo']::order_routing[], false, true,  'not_started','clear', null,  'web_signup'),
('Ben',    'Okafor',  'ben.okafor@pm.me',          '+442079460310','Prop Trader',           'dma_user',       'warm',   38, 'uk', array['equities']::asset_class[], array['dma']::order_routing[], false, false, 'not_started','clear', null,  'web_signup'),
('Priya',  'Sharma',  'priya@tradecraft.dev',      '+14155550293', 'Algo Trader / Dev',     'algo_trader',    'new',    52, 'us', array['equities','options']::asset_class[], array['algo','sor']::order_routing[], false, true, 'not_started','clear', null,  'web_signup');

-- Link contacts to accounts
-- (requires subquery to get IDs — this assumes seed order above)
do $$
declare
  acc_meridian  uuid := (select id from public.accounts where name = 'Meridian Capital LP');
  acc_apex      uuid := (select id from public.accounts where name = 'Apex HFT Systems');
  acc_sigma     uuid := (select id from public.accounts where name = 'Sigma Quant Partners');
  acc_frontier  uuid := (select id from public.accounts where name = 'Frontier Securities LLC');
  acc_blue      uuid := (select id from public.accounts where name = 'BluePath Trading');
  acc_light     uuid := (select id from public.accounts where name = 'Lighthouse Fund');
  con_david     uuid := (select id from public.contacts where email = 'd.chen@meridiancap.com');
  con_rachel    uuid := (select id from public.contacts where email = 'r.ngo@apexhft.com');
  con_james     uuid := (select id from public.contacts where email = 'j.liu@sigmaquant.io');
  con_maria     uuid := (select id from public.contacts where email = 'm.santos@frontiersec.com');
  con_tom       uuid := (select id from public.contacts where email = 't.wallis@bluepath.co');
begin
  insert into public.account_contacts (account_id, contact_id, role, is_primary) values
    (acc_meridian, con_david,  'Head of Trading', true),
    (acc_apex,     con_rachel, 'CTO',             true),
    (acc_sigma,    con_james,  'Portfolio Manager',true),
    (acc_frontier, con_maria,  'COO',             true),
    (acc_blue,     con_tom,    'Head Trader',     true);
end $$;

-- Seed deals
do $$
declare
  acc_meridian  uuid := (select id from public.accounts where name = 'Meridian Capital LP');
  acc_apex      uuid := (select id from public.accounts where name = 'Apex HFT Systems');
  acc_sigma     uuid := (select id from public.accounts where name = 'Sigma Quant Partners');
  acc_frontier  uuid := (select id from public.accounts where name = 'Frontier Securities LLC');
  acc_blue      uuid := (select id from public.accounts where name = 'BluePath Trading');
  acc_light     uuid := (select id from public.accounts where name = 'Lighthouse Fund');
begin
  insert into public.deals (account_id, name, motion, stage, estimated_adv_usd, estimated_commission, close_date, probability, asset_classes, order_routing, fix_required, colo_required, notes) values
  (acc_meridian, 'Meridian Capital – Full Onboarding',        'institutional_b2b', 'negotiating',            40000000, 480000,  '2025-09-30', 80, array['equities','options']::asset_class[], array['dma','sor']::order_routing[],  true,  false, 'FIX 4.4 required. Legal review of master agreement in progress.'),
  (acc_apex,     'Apex HFT – Colo + DMA',                    'institutional_b2b', 'technical_due_diligence',200000000,2400000, '2025-10-15', 65, array['equities','futures']::asset_class[], array['colo','dma']::order_routing[], true,  true,  'Sub-100μs latency requirement. Evaluating NY4 vs NY5.'),
  (acc_sigma,    'Sigma Quant – SOR Algo Suite',              'institutional_b2b', 'proposal_sent',          15000000, 180000,  '2025-11-01', 50, array['equities','options','futures']::asset_class[], array['algo','sor']::order_routing[], true, false, 'Proposal includes algo suite + FIX connectivity.'),
  (acc_frontier, 'Frontier Securities – Correspondent BD',   'institutional_b2b', 'onboarding',             5000000,  60000,   '2025-08-15', 95, array['equities']::asset_class[], array['retail_mm','dma']::order_routing[], false, false, 'MPID assigned. Clearing agreement countersigned.'),
  (acc_blue,     'BluePath – DMA Options Access',            'institutional_b2b', 'qualified',              8000000,  96000,   '2025-12-01', 40, array['equities','options']::asset_class[], array['dma','sor']::order_routing[], false, false, 'Needs site visit first.'),
  (acc_light,    'Lighthouse Fund – Futures Pipeline',       'institutional_b2b', 'prospecting',            3000000,  36000,   '2026-01-15', 15, array['futures']::asset_class[], array['algo']::order_routing[], true,  false, 'Currently with competitor. Low probability, long cycle.');
end $$;

-- Seed tasks
do $$
declare
  acc_meridian  uuid := (select id from public.accounts where name = 'Meridian Capital LP');
  acc_apex      uuid := (select id from public.accounts where name = 'Apex HFT Systems');
  deal_frontier uuid := (select id from public.deals where name like 'Frontier%');
begin
  insert into public.tasks (title, description, priority, status, due_date, account_id) values
  ('Send FIX spec sheet to Rachel Ngo',       'Include latency SLA and NY4 colo pricing',       'high',   'open',       now() + interval '2 days',  acc_apex),
  ('Countersign master agreement – Meridian', 'Legal has reviewed, ready for signature',         'urgent', 'open',       now() + interval '1 day',   acc_meridian),
  ('Schedule BluePath site visit',            'NYC office, options desk tour with Tom Wallis',   'medium', 'open',       now() + interval '1 week',  null),
  ('Complete KYC review – Sigma Quant',       'Outstanding: W-8BEN and LEI certificate',         'high',   'in_progress',now() + interval '3 days',  null),
  ('MPID activation confirmation – Frontier', 'Confirm with FINRA operations team',              'high',   'completed',  now() - interval '1 day',   acc_meridian);
end $$;

-- Seed activities
do $$
declare
  acc_meridian  uuid := (select id from public.accounts where name = 'Meridian Capital LP');
  acc_apex      uuid := (select id from public.accounts where name = 'Apex HFT Systems');
  acc_sigma     uuid := (select id from public.accounts where name = 'Sigma Quant Partners');
  acc_frontier  uuid := (select id from public.accounts where name = 'Frontier Securities LLC');
  con_david     uuid := (select id from public.contacts where email = 'd.chen@meridiancap.com');
  con_rachel    uuid := (select id from public.contacts where email = 'r.ngo@apexhft.com');
begin
  insert into public.activities (type, title, body, occurred_at, account_id, contact_id) values
  ('email',             'Follow-up sent to Rachel Ngo',                  'Attached latency spec sheet and NY4 colo pricing.',             now() - interval '2 hours',  acc_apex,     con_rachel),
  ('call',              'Call with David Chen – 40 min',                 'Discussed FIX 4.4 connectivity and master agreement timeline.', now() - interval '1 day',    acc_meridian, con_david),
  ('deal_stage_change', 'Frontier Securities moved to Onboarding',       'MPID assigned. Clearing agreement countersigned.',              now() - interval '1 day',    acc_frontier, null),
  ('email',             'Proposal sent to Sigma Quant Partners',         'SOR algo overview + pricing included.',                         now() - interval '3 days',   acc_sigma,    null),
  ('note',              'BluePath site visit scheduled',                  'NYC office, options desk tour with Tom Wallis.',               now() - interval '4 days',   null,         null),
  ('meeting',           'Intro call: Priya Sharma',                      'Individual algo trader, interested in REST API onboarding.',    now() - interval '5 days',   null,         null);
end $$;
