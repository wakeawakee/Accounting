/**
 * Runs supabase/schema.sql on PGlite (real Postgres compiled to WASM) with
 * small stand-ins for Supabase's auth and storage schemas, then checks RLS
 * tenancy, staff scoping, the anonymous upload flow and the dispatcher.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema public, auth, storage to anon, authenticated;
`;

const GRANTS = `
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.default_templates to anon;
grant select, insert on storage.objects to anon, authenticated;
`;

let db: PGlite;
const ids: Record<string, string> = {};

async function as(user: string | null, email = '') {
  await db.exec('reset role');
  if (user === null) {
    await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '{}', false)`);
    await db.exec('set role anon');
    return;
  }
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [
    user,
    JSON.stringify({ email }),
  ]);
  await db.exec('set role authenticated');
}
async function asAdmin() {
  await db.exec('reset role');
}
const one = async <T = any>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const all = async <T = any>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUBS);
  await db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  await db.exec(GRANTS);
  for (const [k, email] of [['a', 'a@x.np'], ['b', 'b@x.np'], ['s', 'staff@x.np']]) {
    ids[k] = (await one<{ id: string }>(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;
  }
}, 60_000);

describe('schema.sql', () => {
  it('re-runs cleanly (idempotent)', async () => {
    await asAdmin();
    await db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  });

  it('isolates firms with RLS', async () => {
    await as(ids.a, 'a@x.np');
    ids.firmA = (await one(`select public.bootstrap('Firm A', 'Asha') as f`)).f;
    const c = await one(
      `insert into public.clients (firm_id, business_name, owner_name, phone, pan, vat_registered) values ($1, 'Shop A', 'Ram', '9841000001', '111111111', true) returning id`,
      [ids.firmA],
    );
    ids.clientA = c.id;

    await as(ids.b, 'b@x.np');
    ids.firmB = (await one(`select public.bootstrap('Firm B', 'Bina') as f`)).f;
    expect(await all(`select * from public.clients`)).toEqual([]);
    expect(await all(`select * from public.firms`)).toHaveLength(1);
    const upd = await db.query(`update public.clients set business_name = 'hacked' where id = $1`, [ids.clientA]);
    expect(upd.affectedRows).toBe(0);
    await expect(
      db.query(`insert into public.clients (firm_id, business_name, owner_name, phone, pan) values ($1, 'x', 'y', '9841000002', '222222222')`, [ids.firmA]),
    ).rejects.toThrow();
    await expect(db.query(`select * from public.firm_secrets`)).resolves.toMatchObject({ rows: [] });

    await as(ids.a, 'a@x.np');
    expect((await one(`select business_name from public.clients where id = $1`, [ids.clientA])).business_name).toBe('Shop A');
  });

  it('enforces phone and PAN formats in the database', async () => {
    await as(ids.a, 'a@x.np');
    await expect(
      db.query(`insert into public.clients (firm_id, business_name, owner_name, phone, pan) values ($1, 'x', 'y', '9612345678', '333333333')`, [ids.firmA]),
    ).rejects.toThrow(/check/);
  });

  it('staff join by invite and only see assigned clients', async () => {
    await as(ids.a, 'a@x.np');
    await db.query(`insert into public.invites (firm_id, email, name) values ($1, 'staff@x.np', 'Sita')`, [ids.firmA]);
    await as(ids.s, 'staff@x.np');
    expect((await one(`select public.bootstrap(null, null) as f`)).f).toBe(ids.firmA);
    expect((await one(`select public.my_role() as r`)).r).toBe('staff');
    expect(await all(`select * from public.clients`)).toEqual([]);
    await expect(db.query(`update public.firms set name = 'x'`)).resolves.toMatchObject({ affectedRows: 0 });

    await as(ids.a, 'a@x.np');
    await db.query(`update public.clients set assigned_staff_id = $1 where id = $2`, [ids.s, ids.clientA]);
    await as(ids.s, 'staff@x.np');
    expect(await all(`select id from public.clients`)).toHaveLength(1);
  });

  it('anonymous client upload flow: link → storage → register → docs_received, reminders stop', async () => {
    await as(ids.a, 'a@x.np');
    ids.task = (
      await one(
        `insert into public.tasks (firm_id, client_id, rule_id, rule_name, period_key, period_label, period_label_ne, due_date_bs, due_date_ad, due_label_en, due_label_ne)
         values ($1, $2, 'vat_monthly', '{"en":"VAT return & payment","ne":"भ्याट"}', '2083-07', '2083 Kartik', '२०८३ कात्तिक', '2083-08-25', current_date + 10, '25 Mangsir 2083', '२०८३ मंसिर २५') returning id`,
        [ids.firmA, ids.clientA],
      )
    ).id;
    await db.query(`insert into public.reminders (firm_id, task_id, client_id, offset_days, scheduled_for) values ($1, $2, $3, 5, now() + interval '5 days')`, [
      ids.firmA, ids.task, ids.clientA,
    ]);
    const token = (await one(`select public.get_upload_token($1) as t`, [ids.task])).t as string;
    expect(token).toMatch(/^[A-Za-z0-9]{12}$/);
    expect((await one(`select public.get_upload_token($1) as t`, [ids.task])).t).toBe(token);

    // Firm B cannot mint links for firm A's task
    await as(ids.b, 'b@x.np');
    await expect(db.query(`select public.get_upload_token($1)`, [ids.task])).rejects.toThrow(/Task not found/);

    await as(null);
    const info = (await one(`select public.get_upload_info($1) as i`, [token])).i;
    expect(info.client.businessName).toBe('Shop A');
    expect(info.task.periodLabel).toBe('2083 Kartik');
    const prefix = info.uploadPrefix as string;

    // Anonymous users cannot read any table directly
    await expect(db.query(`select * from public.clients`)).rejects.toThrow();

    // Storage: allowed only inside the link's folder
    await db.query(`insert into storage.objects (bucket_id, name) values ('documents', $1)`, [prefix + 'a.jpg']);
    await db.query(`insert into storage.objects (bucket_id, name) values ('documents', $1)`, [prefix + 'b.jpg']);
    await expect(db.query(`insert into storage.objects (bucket_id, name) values ('documents', $1)`, [`${ids.firmA}/x/y/${token}/c.jpg`])).rejects.toThrow();
    await expect(db.query(`insert into storage.objects (bucket_id, name) values ('documents', 'evil.jpg')`)).rejects.toThrow();

    // Registering a file that was never uploaded fails
    await expect(
      db.query(`select public.register_uploads($1, $2::jsonb)`, [token, JSON.stringify([{ path: prefix + 'nope.jpg', name: 'x', mime: 'image/jpeg', size: 1 }])]),
    ).rejects.toThrow(/not uploaded/);

    const files = ['a.jpg', 'b.jpg'].map((f) => ({ path: prefix + f, name: f, mime: 'image/jpeg', size: 1234 }));
    expect((await one(`select public.register_uploads($1, $2::jsonb, 'bills') as n`, [token, JSON.stringify(files)])).n).toBe(2);

    await as(ids.a, 'a@x.np');
    expect((await one(`select status from public.tasks where id = $1`, [ids.task])).status).toBe('docs_received');
    expect(await all(`select * from public.reminders where task_id = $1 and status = 'scheduled'`, [ids.task])).toEqual([]);
    expect(await all(`select * from public.documents where task_id = $1`, [ids.task])).toHaveLength(2);
    expect((await one(`select title from public.notifications`)).title).toBe('Shop A uploaded 2 file(s)');
  });

  it('dispatcher sends due reminders (console), renders Nepali template, marks missed, auto-stops', async () => {
    await as(ids.a, 'a@x.np');
    await db.query(`update public.firms set quiet_start = 0, quiet_end = 0, app_url = 'https://example.github.io/app/'`); // never quiet
    const t2 = (
      await one(
        `insert into public.tasks (firm_id, client_id, rule_id, rule_name, period_key, period_label, period_label_ne, due_date_bs, due_date_ad, due_label_en, due_label_ne)
         values ($1, $2, 'tds_monthly', '{"en":"TDS"}', '2083-07', '2083 Kartik', '२०८३ कात्तिक', '2083-08-25', current_date + 3, '25 Mangsir 2083', '२०८३ मंसिर २५') returning id`,
        [ids.firmA, ids.clientA],
      )
    ).id;
    const old = (
      await one(
        `insert into public.tasks (firm_id, client_id, rule_id, rule_name, period_key, period_label, due_date_bs, due_date_ad)
         values ($1, $2, 'tds_monthly', '{"en":"TDS"}', '2083-05', '2083 Bhadra', '2083-06-25', current_date - 30) returning id`,
        [ids.firmA, ids.clientA],
      )
    ).id;
    await db.query(`insert into public.reminders (firm_id, task_id, client_id, offset_days, scheduled_for) values ($1, $2, $3, 2, now() - interval '1 minute')`, [
      ids.firmA, t2, ids.clientA,
    ]);
    // A reminder for a task that already has docs → cancelled, not sent
    await db.query(`insert into public.reminders (firm_id, task_id, client_id, offset_days, scheduled_for) values ($1, $2, $3, 2, now() - interval '1 minute')`, [
      ids.firmA, ids.task, ids.clientA,
    ]);

    await asAdmin();
    expect((await one(`select public.dispatch_reminders() as n`)).n).toBe(1);
    const msg = await one(`select * from public.message_log where task_id = $1`, [t2]);
    expect(msg.body).toContain('नमस्ते Ram जी');
    expect(msg.body).toContain('२०८३ मंसिर २५');
    expect(msg.body).toMatch(/https:\/\/example\.github\.io\/app\/#\/u\/[A-Za-z0-9]{12}/);
    expect(msg.encoding).toBe('UCS-2');
    expect(msg.segments).toBeGreaterThan(1);
    expect((await one(`select status from public.tasks where id = $1`, [old])).status).toBe('missed');
    expect((await one(`select status from public.reminders where task_id = $1`, [ids.task])).status).toBe('cancelled');

    // Authenticated users cannot run the dispatcher themselves
    await as(ids.a, 'a@x.np');
    await expect(db.query(`select public.dispatch_reminders()`)).rejects.toThrow();
  });

  it('respects quiet hours by rescheduling', async () => {
    await as(ids.a, 'a@x.np');
    await db.query(`update public.firms set quiet_start = 0, quiet_end = 1439`); // quiet almost all day
    await db.query(`update public.tasks set status = 'pending' where rule_id = 'tds_monthly' and period_key = '2083-07'`);
    const t = (await one(`select id from public.tasks where rule_id = 'tds_monthly' and period_key = '2083-07'`)).id;
    await db.query(`insert into public.reminders (firm_id, task_id, client_id, offset_days, scheduled_for) values ($1, $2, $3, 0, now() - interval '1 minute')`, [
      ids.firmA, t, ids.clientA,
    ]);
    await asAdmin();
    const before = (await one(`select count(*)::int as n from public.message_log`)).n;
    await db.query(`select public.dispatch_reminders()`);
    const r = await one(`select status, scheduled_for from public.reminders where task_id = $1 and offset_days = 0`, [t]);
    expect(r.status).toBe('scheduled');
    expect(new Date(r.scheduled_for).getTime()).toBeGreaterThan(Date.now());
    expect((await one(`select count(*)::int as n from public.message_log`)).n).toBe(before);
  });

  it('only owners can store the SMS token, and nobody can read it back', async () => {
    await as(ids.s, 'staff@x.np');
    await expect(db.query(`select public.set_sms_token('secret')`)).rejects.toThrow(/owner/);
    await as(ids.a, 'a@x.np');
    await db.query(`select public.set_sms_token('secret')`);
    expect((await one(`select has_sms_token from public.firms`)).has_sms_token).toBe(true);
    expect(await all(`select * from public.firm_secrets`)).toEqual([]);
  });
});
