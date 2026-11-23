-- Saved prescriptions, orders, and ratings.
-- Photos and PDFs are not stored. The service role bypasses row security.
-- The public anon and authenticated roles have no policies and no grants, so a browser key cannot insert or delete.

create table if not exists prescriptions (
  id text primary key,
  patient_name text not null,
  source_file_name text not null default '',
  saved_at text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists medications (
  id bigserial primary key,
  prescription_id text not null references prescriptions (id) on delete cascade,
  name text not null,
  strength text not null default '',
  frequency text not null default '',
  quantity text not null default '',
  supply_days integer not null
);

create table if not exists orders (
  id text primary key,
  prescription_id text not null default '',
  patient_name text not null,
  seller_id text not null,
  seller_name text not null,
  name text not null,
  strength text not null default '',
  supply_days integer not null,
  lead_days integer not null,
  ordered_at text not null,
  refill_due_on text not null,
  reminder_on text not null,
  status text not null,
  fulfilled_at text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists ratings (
  order_id text primary key references orders (id) on delete cascade,
  stars integer not null check (stars between 1 and 5),
  comment text not null default '',
  rated_at text not null default ''
);

alter table prescriptions enable row level security;
alter table medications enable row level security;
alter table orders enable row level security;
alter table ratings enable row level security;

revoke all on table prescriptions from anon, authenticated;
revoke all on table medications from anon, authenticated;
revoke all on table orders from anon, authenticated;
revoke all on table ratings from anon, authenticated;
