-- =============================================================================
-- KarSathi — Supabase schema
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to re-run (idempotent where possible).
--
-- Tenancy: every table has firm_id and Row Level Security. A signed-in user
-- only ever sees rows of the firm they are a member of (see my_firm()).
-- Staff members only see clients assigned to them.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_phone text default '',
  contact_email text default '',
  address text default '',
  message_sender_name text default '',
  reminder_offsets int[] not null default '{10,5,2,0}',
  send_minute int not null default 600,          -- 10:00 Nepal time
  quiet_start int not null default 1200,         -- 20:00
  quiet_end int not null default 480,            -- 08:00
  messaging_provider text not null default 'console' check (messaging_provider in ('console','sms','viber')),
  sms_api_url text default '',
  sms_sender_id text default '',
  has_sms_token boolean not null default false,
  sms_cost_per_segment numeric not null default 1,
  app_url text,                                  -- where upload links point (set by the app)
  -- Designed for Khalti/eSewa billing later
  plan jsonb not null default '{"tier":"trial","status":"active","monthlyMessageQuota":1000,"paymentProvider":"none"}',
  created_at timestamptz not null default now()
);

-- Secrets live apart from firms and have NO select policy: only server-side
-- functions (security definer) can read them.
create table if not exists public.firm_secrets (
  firm_id uuid primary key references public.firms(id) on delete cascade,
  sms_token text
);

create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  name text not null,
  email text not null,
  role text not null check (role in ('owner','staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists members_firm_idx on public.members(firm_id);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  email text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (email)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  business_name text not null,
  owner_name text not null,
  phone text not null check (phone ~ '^9[78][0-9]{8}$'),
  pan text not null check (pan ~ '^[0-9]{9}$'),
  vat_registered boolean not null default false,
  deducts_tds boolean not null default false,
  municipality text default '',
  assigned_staff_id uuid references auth.users(id) on delete set null,
  preferred_language text not null default 'ne' check (preferred_language in ('ne','en')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (firm_id, pan)
);
create index if not exists clients_firm_idx on public.clients(firm_id);

create table if not exists public.custom_rules (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  name_en text not null,
  name_ne text default '',
  frequency text not null check (frequency in ('monthly','trimester','annual')),
  due_rule jsonb not null,
  applies_to jsonb not null default '{}',
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  rule_id text not null,
  rule_name jsonb not null,
  period_key text not null,
  period_label text not null,
  period_label_ne text,
  fiscal_year text,
  due_date_bs text not null,
  due_date_ad date not null,
  due_label_en text,                 -- e.g. "25 Mangsir 2083" (used in SMS)
  due_label_ne text,                 -- e.g. "२०८३ मंसिर २५"
  holiday_flag text,
  status text not null default 'pending' check (status in ('pending','docs_received','filed','missed')),
  docs_received_at timestamptz,
  filed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (firm_id, client_id, rule_id, period_key)
);
create index if not exists tasks_firm_due_idx on public.tasks(firm_id, due_date_ad);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  offset_days int,                   -- days before due; -1 = manual "send now"
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','sending','sent','failed','cancelled')),
  attempt int not null default 0,
  request_id bigint,                 -- pg_net request id while an SMS is in flight
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reminders_due_idx on public.reminders(status, scheduled_for);

create table if not exists public.upload_links (
  token text primary key,
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '30 days'
);
create index if not exists upload_links_task_idx on public.upload_links(task_id);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_path text not null unique,
  original_name text,
  mime_type text not null,
  size int not null,
  note text,
  uploaded_at timestamptz not null default now()
);

create table if not exists public.message_log (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  reminder_id uuid references public.reminders(id) on delete set null,
  provider text,
  to_phone text,
  body text,
  segments int,
  encoding text,
  cost_estimate_npr numeric default 0,
  status text check (status in ('sent','failed')),
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.default_templates (
  type text not null,
  language text not null,
  body text not null,
  primary key (type, language)
);

create table if not exists public.templates (
  firm_id uuid not null references public.firms(id) on delete cascade,
  type text not null check (type in ('reminder','due_today')),
  language text not null check (language in ('ne','en')),
  body text not null,
  primary key (firm_id, type, language)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  type text,
  title text,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  firm_id uuid not null references public.firms(id) on delete cascade,
  user_id uuid,
  actor text,
  action text not null,
  entity text,
  entity_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- Default message templates (keep in sync with packages/shared/src/templates.ts)
insert into public.default_templates (type, language, body) values
  ('reminder', 'ne', 'नमस्ते {clientName} जी, {firmName} बाट सम्झना: {period} को बिलहरू {dueDateBs} भित्र पठाउनुहोस्। यहाँ अपलोड गर्नुहोस्: {uploadLink}'),
  ('reminder', 'en', 'Hi {clientName}, reminder from {firmName}: please send your {period} bills by {dueDateBs}. Upload here: {uploadLink}'),
  ('due_today', 'ne', '{clientName} जी, {period} को बिल पठाउने अन्तिम दिन आज ({dueDateBs}) हो। {firmName}: {uploadLink}'),
  ('due_today', 'en', '{clientName}, today ({dueDateBs}) is the last day to send your {period} bills. {firmName}: {uploadLink}')
on conflict (type, language) do update set body = excluded.body;

-- ---------------------------------------------------------------------------
-- Helper functions (security definer: they bypass RLS, so keep them tiny)
-- ---------------------------------------------------------------------------
create or replace function public.my_firm() returns uuid
language sql stable security definer set search_path = public as $$
  select firm_id from public.members where user_id = auth.uid() and active
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid() and active
$$;

-- Owners see every client of their firm; staff only their assigned clients.
create or replace function public.can_see_client(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c
    where c.id = p_client
      and c.firm_id = public.my_firm()
      and (public.my_role() = 'owner' or c.assigned_staff_id = auth.uid())
  )
$$;

create or replace function public.random_token(n int default 12) returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  bytes bytea := gen_random_bytes(n);
  out text := '';
begin
  for i in 0 .. n - 1 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.firms enable row level security;
alter table public.firm_secrets enable row level security;  -- no policies = no access
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.clients enable row level security;
alter table public.custom_rules enable row level security;
alter table public.tasks enable row level security;
alter table public.reminders enable row level security;
alter table public.upload_links enable row level security;
alter table public.documents enable row level security;
alter table public.message_log enable row level security;
alter table public.default_templates enable row level security;
alter table public.templates enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

-- Drop old policies so this file can be re-run.
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy firms_read on public.firms for select to authenticated using (id = public.my_firm());
create policy firms_update on public.firms for update to authenticated
  using (id = public.my_firm() and public.my_role() = 'owner') with check (id = public.my_firm());

create policy members_read on public.members for select to authenticated using (firm_id = public.my_firm());
create policy members_update on public.members for update to authenticated
  using (firm_id = public.my_firm() and public.my_role() = 'owner') with check (firm_id = public.my_firm());

create policy invites_all on public.invites for all to authenticated
  using (firm_id = public.my_firm() and public.my_role() = 'owner')
  with check (firm_id = public.my_firm() and public.my_role() = 'owner');

-- Uses the row's own columns (not a lookup) so INSERT ... RETURNING works.
create policy clients_read on public.clients for select to authenticated
  using (firm_id = public.my_firm() and (public.my_role() = 'owner' or assigned_staff_id = auth.uid()));
create policy clients_insert on public.clients for insert to authenticated
  with check (firm_id = public.my_firm() and (public.my_role() = 'owner' or assigned_staff_id = auth.uid()));
create policy clients_update on public.clients for update to authenticated
  using (firm_id = public.my_firm() and (public.my_role() = 'owner' or assigned_staff_id = auth.uid()))
  with check (firm_id = public.my_firm());

create policy rules_read on public.custom_rules for select to authenticated using (firm_id = public.my_firm());
create policy rules_write on public.custom_rules for all to authenticated
  using (firm_id = public.my_firm() and public.my_role() = 'owner')
  with check (firm_id = public.my_firm() and public.my_role() = 'owner');

create policy tasks_rw on public.tasks for all to authenticated
  using (firm_id = public.my_firm() and public.can_see_client(client_id))
  with check (firm_id = public.my_firm() and public.can_see_client(client_id));

create policy reminders_rw on public.reminders for all to authenticated
  using (firm_id = public.my_firm() and public.can_see_client(client_id))
  with check (firm_id = public.my_firm() and public.can_see_client(client_id));

create policy links_rw on public.upload_links for all to authenticated
  using (firm_id = public.my_firm() and public.can_see_client(client_id))
  with check (firm_id = public.my_firm() and public.can_see_client(client_id));

create policy documents_read on public.documents for select to authenticated
  using (firm_id = public.my_firm() and public.can_see_client(client_id));

create policy messages_read on public.message_log for select to authenticated
  using (firm_id = public.my_firm() and (client_id is null or public.can_see_client(client_id)));

create policy default_templates_read on public.default_templates for select to authenticated using (true);

create policy templates_read on public.templates for select to authenticated using (firm_id = public.my_firm());
create policy templates_write on public.templates for all to authenticated
  using (firm_id = public.my_firm() and public.my_role() = 'owner')
  with check (firm_id = public.my_firm() and public.my_role() = 'owner');

create policy notifications_rw on public.notifications for all to authenticated
  using (firm_id = public.my_firm()) with check (firm_id = public.my_firm());

create policy audit_read on public.audit_log for select to authenticated
  using (firm_id = public.my_firm() and public.my_role() = 'owner');

-- ---------------------------------------------------------------------------
-- Audit triggers
-- ---------------------------------------------------------------------------
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (firm_id, user_id, actor, action, entity, entity_id, meta)
  values (
    coalesce(new.firm_id, old.firm_id), auth.uid(),
    case when auth.uid() is null then 'system' else 'user' end,
    lower(tg_table_name) || '.' || lower(tg_op), tg_table_name, coalesce(new.id, old.id)::text,
    case when tg_table_name = 'tasks' then jsonb_build_object('status', to_jsonb(new) ->> 'status') else null end
  );
  return new;
end $$;

drop trigger if exists audit_clients on public.clients;
create trigger audit_clients after insert or update on public.clients for each row execute function public.audit_row();
drop trigger if exists audit_tasks on public.tasks;
create trigger audit_tasks after update of status on public.tasks for each row execute function public.audit_row();

-- Stop reminders automatically once docs arrive or the task is filed.
create or replace function public.cancel_reminders_on_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('docs_received', 'filed') and old.status is distinct from new.status then
    update public.reminders set status = 'cancelled' where task_id = new.id and status = 'scheduled';
  end if;
  return new;
end $$;
drop trigger if exists tasks_cancel_reminders on public.tasks;
create trigger tasks_cancel_reminders after update of status on public.tasks for each row execute function public.cancel_reminders_on_status();

-- ---------------------------------------------------------------------------
-- RPCs for signed-in users
-- ---------------------------------------------------------------------------

-- Called after login: joins an invited firm, or creates a new firm + owner.
create or replace function public.bootstrap(p_firm_name text default null, p_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_firm uuid;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_inv public.invites;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select firm_id into v_firm from public.members where user_id = auth.uid();
  if v_firm is not null then return v_firm; end if;

  select * into v_inv from public.invites where lower(email) = v_email;
  if found then
    insert into public.members (user_id, firm_id, name, email, role) values (auth.uid(), v_inv.firm_id, v_inv.name, v_email, 'staff');
    delete from public.invites where id = v_inv.id;
    return v_inv.firm_id;
  end if;

  if coalesce(trim(p_firm_name), '') = '' then return null; end if;
  insert into public.firms (name, contact_email, message_sender_name) values (trim(p_firm_name), v_email, trim(p_firm_name)) returning id into v_firm;
  insert into public.members (user_id, firm_id, name, email, role) values (auth.uid(), v_firm, coalesce(nullif(trim(p_name), ''), v_email), v_email, 'owner');
  return v_firm;
end $$;

create or replace function public.set_sms_token(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'owner' then raise exception 'Only the firm owner can do this'; end if;
  insert into public.firm_secrets (firm_id, sms_token) values (public.my_firm(), p_token)
  on conflict (firm_id) do update set sms_token = excluded.sms_token;
  update public.firms set has_sms_token = true where id = public.my_firm();
end $$;

-- Returns (or creates) the magic upload token for a task.
create or replace function public.get_upload_token(p_task uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_task public.tasks;
  v_token text;
begin
  select * into v_task from public.tasks where id = p_task and firm_id = public.my_firm();
  if not found or not public.can_see_client(v_task.client_id) then raise exception 'Task not found'; end if;
  select token into v_token from public.upload_links where task_id = p_task and expires_at > now() + interval '7 days' limit 1;
  if v_token is null then
    v_token := public.random_token(12);
    insert into public.upload_links (token, firm_id, client_id, task_id) values (v_token, v_task.firm_id, v_task.client_id, v_task.id);
  end if;
  return v_token;
end $$;

-- ---------------------------------------------------------------------------
-- Public (anonymous) upload flow — the client never logs in.
-- ---------------------------------------------------------------------------
create or replace function public.get_upload_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l public.upload_links; t public.tasks; c public.clients; f public.firms;
begin
  select * into l from public.upload_links where token = p_token;
  if not found then raise exception 'Link not found'; end if;
  if l.expires_at < now() then raise exception 'This link has expired. Please ask your accountant for a new one.'; end if;
  select * into t from public.tasks where id = l.task_id;
  select * into c from public.clients where id = l.client_id;
  select * into f from public.firms where id = l.firm_id;
  if not c.active then raise exception 'Link not found'; end if;
  return jsonb_build_object(
    'firm', jsonb_build_object('name', f.name, 'phone', f.contact_phone, 'hasLogo', false),
    'client', jsonb_build_object('businessName', c.business_name, 'ownerName', c.owner_name, 'preferredLanguage', c.preferred_language),
    'task', jsonb_build_object('ruleName', t.rule_name, 'periodLabel', t.period_label, 'periodLabelNe', t.period_label_ne, 'dueDateBs', t.due_date_bs, 'status', t.status),
    'uploadedCount', (select count(*) from public.documents d where d.task_id = t.id),
    'uploadPrefix', l.firm_id || '/' || l.client_id || '/' || l.task_id || '/' || l.token || '/',
    'expiresAt', l.expires_at
  );
end $$;

-- Used by the storage policy: anonymous uploads are only allowed into the
-- folder of a valid, unexpired link: {firm}/{client}/{task}/{token}/{file}
create or replace function public.upload_path_ok(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.upload_links l
    where l.expires_at > now()
      and p_name like (l.firm_id || '/' || l.client_id || '/' || l.task_id || '/' || l.token || '/%')
      and l.token = split_part(p_name, '/', 4)
  ) and array_length(string_to_array(p_name, '/'), 1) = 5
$$;

-- After uploading files to storage, the upload page registers them.
create or replace function public.register_uploads(p_token text, p_files jsonb, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  l public.upload_links; c public.clients; t public.tasks;
  f jsonb; n int := 0; prefix text;
begin
  select * into l from public.upload_links where token = p_token and expires_at > now();
  if not found then raise exception 'Link not found'; end if;
  prefix := l.firm_id || '/' || l.client_id || '/' || l.task_id || '/' || l.token || '/';
  for f in select * from jsonb_array_elements(p_files) loop
    if (f ->> 'path') not like prefix || '%' then raise exception 'Invalid file path'; end if;
    if (f ->> 'mime') not in ('image/jpeg', 'image/png', 'application/pdf') then raise exception 'Only JPG, PNG or PDF'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = f ->> 'path') then
      raise exception 'File was not uploaded';
    end if;
    insert into public.documents (firm_id, client_id, task_id, file_path, original_name, mime_type, size, note)
    values (l.firm_id, l.client_id, l.task_id, f ->> 'path', left(f ->> 'name', 200), f ->> 'mime', (f ->> 'size')::int, left(p_note, 500))
    on conflict (file_path) do nothing;
    if found then n := n + 1; end if;
  end loop;
  if n > 0 then
    update public.tasks set status = 'docs_received', docs_received_at = now()
      where id = l.task_id and status in ('pending', 'missed');
    update public.reminders set status = 'cancelled' where task_id = l.task_id and status = 'scheduled';
    select * into c from public.clients where id = l.client_id;
    select * into t from public.tasks where id = l.task_id;
    insert into public.notifications (firm_id, type, title, body, link)
    values (l.firm_id, 'docs_received', c.business_name || ' uploaded ' || n || ' file(s)',
            t.period_label || ' · ' || coalesce(t.rule_name ->> 'en', t.rule_id), '/clients/' || c.id);
    insert into public.audit_log (firm_id, actor, action, entity, entity_id, meta)
    values (l.firm_id, 'client', 'documents.upload', 'tasks', l.task_id::text, jsonb_build_object('count', n));
  end if;
  return n;
end $$;

grant execute on function public.get_upload_info(text) to anon, authenticated;
grant execute on function public.register_uploads(text, jsonb, text) to anon, authenticated;
grant execute on function public.upload_path_ok(text) to anon, authenticated;
revoke execute on function public.bootstrap(text, text) from public, anon;
grant execute on function public.bootstrap(text, text) to authenticated;
revoke execute on function public.set_sms_token(text) from public, anon;
grant execute on function public.set_sms_token(text) to authenticated;
revoke execute on function public.get_upload_token(uuid) from public, anon;
grant execute on function public.get_upload_token(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for client documents (10 MB, JPG/PNG/PDF only)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "karsathi upload via magic link" on storage.objects;
create policy "karsathi upload via magic link" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'documents' and public.upload_path_ok(name));

drop policy if exists "karsathi firm reads documents" on storage.objects;
create policy "karsathi firm reads documents" on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and split_part(name, '/', 1) = public.my_firm()::text
    and public.can_see_client(nullif(split_part(name, '/', 2), '')::uuid)
  );

-- ---------------------------------------------------------------------------
-- Reminder dispatcher (runs every minute via pg_cron)
-- ---------------------------------------------------------------------------
create or replace function public.sms_segments(p_body text) returns int
language sql immutable as $$
  select case
    when p_body ~ '[^\x01-\x7E]' then case when length(p_body) <= 70 then 1 else ceil(length(p_body) / 67.0)::int end
    else case when length(p_body) <= 160 then 1 else ceil(length(p_body) / 153.0)::int end
  end
$$;

create or replace function public.dispatch_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record; v_body text; v_tpl text; v_token text; v_lang text; v_type text;
  v_local timestamp := now() at time zone 'Asia/Kathmandu';
  v_minute int := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_quiet boolean; v_resume timestamptz; v_req bigint; v_secret text; n int := 0;
  resp record;
begin
  -- 1. Overdue pending tasks become "missed".
  update public.tasks set status = 'missed' where status = 'pending' and due_date_ad < v_local::date;

  -- 2. Settle SMS requests that pg_net has answered.
  if to_regclass('net._http_response') is not null then
    for resp in
      execute 'select rm.id, rm.firm_id, rm.attempt, h.status_code, h.error_msg, left(h.content, 500) as content
               from public.reminders rm join net._http_response h on h.id = rm.request_id
               where rm.status = ''sending'''
    loop
      if resp.status_code between 200 and 299 then
        update public.reminders set status = 'sent', sent_at = now(), request_id = null where id = resp.id;
        update public.message_log set status = 'sent' where reminder_id = resp.id and status is null;
      else
        update public.reminders set
          status = case when resp.attempt >= 3 then 'failed' else 'scheduled' end,
          scheduled_for = now() + (power(2, resp.attempt) || ' minutes')::interval,
          last_error = coalesce(resp.error_msg, 'HTTP ' || resp.status_code || ' ' || coalesce(resp.content, '')),
          request_id = null
        where id = resp.id;
        update public.message_log set status = 'failed', error = coalesce(resp.error_msg, 'HTTP ' || resp.status_code)
          where reminder_id = resp.id and status is null;
      end if;
    end loop;
  end if;

  -- 3. Send due reminders.
  for r in
    select rm.*, t.status as task_status, t.period_label, t.period_label_ne, t.due_label_en, t.due_label_ne,
           c.owner_name, c.phone, c.preferred_language, c.active as client_active,
           f.name as firm_name, f.message_sender_name, f.quiet_start, f.quiet_end, f.app_url,
           f.messaging_provider, f.sms_api_url, f.sms_sender_id, f.sms_cost_per_segment
    from public.reminders rm
    join public.tasks t on t.id = rm.task_id
    join public.clients c on c.id = rm.client_id
    join public.firms f on f.id = rm.firm_id
    where rm.status = 'scheduled' and rm.scheduled_for <= now()
    order by rm.scheduled_for
    limit 100
    for update of rm skip locked
  loop
    -- Auto-stop
    if r.task_status not in ('pending', 'missed') or not r.client_active then
      update public.reminders set status = 'cancelled' where id = r.id;
      continue;
    end if;

    -- Quiet hours (Nepal time). Manual sends (offset -1) also respect them.
    v_quiet := case when r.quiet_start > r.quiet_end then v_minute >= r.quiet_start or v_minute < r.quiet_end
                    else v_minute >= r.quiet_start and v_minute < r.quiet_end end;
    if v_quiet then
      v_resume := ((case when r.quiet_start > r.quiet_end and v_minute >= r.quiet_start then v_local::date + 1 else v_local::date end)
                   + make_interval(mins => r.quiet_end)) at time zone 'Asia/Kathmandu';
      update public.reminders set scheduled_for = v_resume where id = r.id;
      continue;
    end if;

    -- Build the message
    v_lang := coalesce(r.preferred_language, 'ne');
    v_type := case when r.offset_days = 0 then 'due_today' else 'reminder' end;
    select body into v_tpl from public.templates where firm_id = r.firm_id and type = v_type and language = v_lang;
    if v_tpl is null then select body into v_tpl from public.default_templates where type = v_type and language = v_lang; end if;
    select token into v_token from public.upload_links where task_id = r.task_id and expires_at > now() + interval '7 days' limit 1;
    if v_token is null then
      v_token := public.random_token(12);
      insert into public.upload_links (token, firm_id, client_id, task_id) values (v_token, r.firm_id, r.client_id, r.task_id);
    end if;
    v_body := replace(replace(replace(replace(replace(v_tpl,
      '{clientName}', r.owner_name),
      '{firmName}', coalesce(nullif(r.message_sender_name, ''), r.firm_name)),
      '{period}', case when v_lang = 'ne' then coalesce(r.period_label_ne, r.period_label) else r.period_label end),
      '{dueDateBs}', case when v_lang = 'ne' then coalesce(r.due_label_ne, '') else coalesce(r.due_label_en, '') end),
      '{uploadLink}', coalesce(r.app_url, '') || '#/u/' || v_token);

    if r.messaging_provider = 'sms' and coalesce(r.sms_api_url, '') <> '' and to_regclass('net.http_request_queue') is not null then
      select sms_token into v_secret from public.firm_secrets where firm_id = r.firm_id;
      -- Sparrow-style gateway: GET ?token=&from=&to=&text=
      execute 'select net.http_get(url := $1, params := $2)' into v_req
        using r.sms_api_url, jsonb_build_object('token', coalesce(v_secret, ''), 'from', coalesce(r.sms_sender_id, ''), 'to', r.phone, 'text', v_body);
      update public.reminders set status = 'sending', attempt = attempt + 1, request_id = v_req where id = r.id;
      insert into public.message_log (firm_id, client_id, task_id, reminder_id, provider, to_phone, body, segments, encoding, cost_estimate_npr, status)
      values (r.firm_id, r.client_id, r.task_id, r.id, 'sms', r.phone, v_body, public.sms_segments(v_body),
              case when v_body ~ '[^\x01-\x7E]' then 'UCS-2' else 'GSM-7' end, public.sms_segments(v_body) * r.sms_cost_per_segment, null);
    else
      -- Console provider: log only (no real SMS). Good for testing.
      update public.reminders set status = 'sent', sent_at = now(), attempt = attempt + 1 where id = r.id;
      insert into public.message_log (firm_id, client_id, task_id, reminder_id, provider, to_phone, body, segments, encoding, cost_estimate_npr, status)
      values (r.firm_id, r.client_id, r.task_id, r.id, 'console', r.phone, v_body, public.sms_segments(v_body),
              case when v_body ~ '[^\x01-\x7E]' then 'UCS-2' else 'GSM-7' end, 0, 'sent');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.dispatch_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule the dispatcher every minute (needs pg_cron; pg_net for real SMS).
-- If this block fails, enable both under Database → Extensions and re-run it.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_net;
  exception when others then raise notice 'pg_net not enabled: %', sqlerrm;
  end;
  begin
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'karsathi-dispatch';
    perform cron.schedule('karsathi-dispatch', '* * * * *', 'select public.dispatch_reminders()');
  exception when others then raise notice 'pg_cron not enabled: % — enable it under Database → Extensions, then re-run this block', sqlerrm;
  end;
end $$;
