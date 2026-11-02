// Runs this repo's Supabase migrations in PGlite (Postgres compiled to WASM, no Docker or
// database needed) with a stubbed `auth` schema, then exercises create_pairing_code() and
// redeem_pairing_code() the way PostgREST would: one call = one transaction, as the
// `authenticated` or `anon` role, with auth.uid() set from request.jwt.claim.sub.
//
//   cd file-share-rtc/supabase/tests && npm install && npm test
//
// What this does NOT cover: Supabase's real auth, PostgREST, or Realtime. It is a check of the
// SQL and its row level security, not of a deployed project.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

const db = new PGlite();

// What Supabase provides before any migration runs.
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
  create publication supabase_realtime;
  grant usage on schema public, auth to anon, authenticated;
  -- Supabase's default privileges: new tables and functions are open to both roles
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`);

for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  console.log('applied', file);
}

// One call = one transaction, like one RPC request. Returns rows, or the error message.
async function call(role, uid, sql) {
  await db.exec(`begin; set local role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', true);`);
  try {
    const res = await db.query(sql);
    await db.exec('commit');
    return { rows: res.rows };
  } catch (e) {
    await db.exec('rollback');
    return { error: e.message };
  }
}
const asUser = (uid, sql) => call('authenticated', uid, sql);
const admin = async (sql) => (await db.query(sql)).rows;

const uid = async () => (await admin(`insert into auth.users default values returning id`))[0].id;
const [A, B, C] = [await uid(), await uid(), await uid()];

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok  ', name);
  } catch (e) {
    console.log('  FAIL', name, '\n      ', e.message);
    process.exitCode = 1;
  }
}

console.log('\nprofiles');
await test('signing up creates a users row with a colour and an animal', async () => {
  const rows = await admin(`select color_id, animal_id from users where id = '${A}'`);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].color_id && rows[0].animal_id);
});

console.log('\ncreate_pairing_code');
let code;
await test('returns a 4-digit code and a timestamp', async () => {
  const r = await asUser(A, `select create_pairing_code() as r`);
  assert.equal(r.error, undefined, r.error);
  code = r.rows[0].r.code;
  assert.match(code, /^\d{4}$/);
  assert.ok(Date.parse(r.rows[0].r.created_at));
});
await test('stores exactly one code for the caller', async () => {
  const rows = await admin(`select code from pairing_codes where user_id = '${A}'`);
  assert.deepEqual(rows.map((r) => r.code), [code]);
});
await test('creating another code replaces the first', async () => {
  const r = await asUser(A, `select create_pairing_code() as r`);
  assert.equal((await admin(`select count(*)::int as n from pairing_codes where user_id = '${A}'`))[0].n, 1);
  code = r.rows[0].r.code;
});
await test('codes look random (many draws are not all the same, all 4 digits)', async () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const r = await asUser(C, `select create_pairing_code() as r`);
    assert.match(r.rows[0].r.code, /^\d{4}$/);
    seen.add(r.rows[0].r.code);
  }
  assert.ok(seen.size > 30, `only ${seen.size} distinct codes in 40 draws`);
  await admin(`delete from pairing_codes where user_id = '${C}'`);
});
await test('an expired code is freed when someone else creates a code', async () => {
  await admin(`update pairing_codes set created_at = now() - interval '6 minutes' where user_id = '${A}'`);
  await asUser(B, `select create_pairing_code()`);
  assert.equal((await admin(`select count(*)::int as n from pairing_codes where user_id = '${A}'`))[0].n, 0);
  await admin(`delete from pairing_codes where user_id = '${B}'`);
  const r = await asUser(A, `select create_pairing_code() as r`); // A needs a live code again
  code = r.rows[0].r.code;
});
await test('rejects a signed-in role with no user', async () => {
  const r = await call('authenticated', '', `select create_pairing_code()`);
  assert.match(r.error, /not_authenticated/);
});
await test('is not callable by the anon role', async () => {
  const r = await call('anon', '', `select create_pairing_code()`);
  assert.match(r.error, /permission denied/);
});

console.log('\nredeem_pairing_code');
await test('a wrong code returns null and is counted as an attempt', async () => {
  const wrong = code === '0000' ? '0001' : '0000';
  const r = await asUser(B, `select redeem_pairing_code('${wrong}') as r`);
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.rows[0].r, null);
  assert.equal((await admin(`select count(*)::int as n from pairing_attempts where user_id = '${B}'`))[0].n, 1);
});
await test('you cannot redeem your own code', async () => {
  const r = await asUser(A, `select redeem_pairing_code('${code}') as r`);
  assert.equal(r.rows[0].r, null);
});
await test('the right code returns the creator id', async () => {
  const r = await asUser(B, `select redeem_pairing_code('${code}') as r`);
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.rows[0].r, A);
});
await test('it records the redemption and creates the connection (creator = user_1)', async () => {
  const red = await admin(`select user_id from pairing_code_redemptions where pairing_code = '${code}'`);
  assert.deepEqual(red.map((r) => r.user_id), [B]);
  const conns = await admin(`select user_1_id, user_2_id from user_connections`);
  assert.deepEqual(conns, [{ user_1_id: A, user_2_id: B }]);
});
await test('a used code cannot be redeemed again by someone else', async () => {
  const r = await asUser(C, `select redeem_pairing_code('${code}') as r`);
  assert.equal(r.rows[0].r, null);
});
await test('an expired code returns null', async () => {
  const fresh = (await asUser(A, `select create_pairing_code() as r`)).rows[0].r.code;
  await admin(`update pairing_codes set created_at = now() - interval '6 minutes' where code = '${fresh}'`);
  const r = await asUser(C, `select redeem_pairing_code('${fresh}') as r`);
  assert.equal(r.rows[0].r, null);
  await admin(`delete from pairing_attempts where user_id = '${C}'`);
});
await test('pairing the same two users again does not duplicate the connection', async () => {
  const fresh = (await asUser(B, `select create_pairing_code() as r`)).rows[0].r.code; // B creates this time
  const r = await asUser(A, `select redeem_pairing_code('${fresh}') as r`);
  assert.equal(r.rows[0].r, B);
  assert.equal((await admin(`select count(*)::int as n from user_connections`))[0].n, 1);
});
await test('the 6th wrong guess within 10 minutes is refused', async () => {
  await admin(`delete from pairing_attempts`);
  for (let i = 0; i < 5; i++) {
    const r = await asUser(C, `select redeem_pairing_code('9999') as r`);
    assert.equal(r.rows[0].r, null);
  }
  const blocked = await asUser(C, `select redeem_pairing_code('9999') as r`);
  assert.match(blocked.error, /too_many_attempts/);
});
await test('even the right code is refused while blocked', async () => {
  const live = (await asUser(A, `select create_pairing_code() as r`)).rows[0].r.code;
  const r = await asUser(C, `select redeem_pairing_code('${live}') as r`);
  assert.match(r.error, /too_many_attempts/);
});
await test('attempts older than 10 minutes stop counting', async () => {
  await admin(`update pairing_attempts set created_at = now() - interval '11 minutes' where user_id = '${C}'`);
  const live = (await asUser(A, `select create_pairing_code() as r`)).rows[0].r.code;
  const r = await asUser(C, `select redeem_pairing_code('${live}') as r`);
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.rows[0].r, A);
});
await test('rejects a signed-in role with no user', async () => {
  const r = await call('authenticated', '', `select redeem_pairing_code('1234')`);
  assert.match(r.error, /not_authenticated/);
});
await test('is not callable by the anon role', async () => {
  const r = await call('anon', '', `select redeem_pairing_code('1234')`);
  assert.match(r.error, /permission denied/);
});

console.log('\nrow level security (what each user can see)');
await admin(`delete from user_connections where user_2_id = '${C}'`); // leave only A-B
await test('a stranger sees no connections', async () => {
  const r = await asUser(C, `select count(*)::int as n from user_connections`);
  assert.equal(r.rows[0].n, 0);
});
await test('both ends of a connection see it', async () => {
  for (const u of [A, B]) {
    const r = await asUser(u, `select count(*)::int as n from user_connections`);
    assert.equal(r.rows[0].n, 1, `user ${u}`);
  }
});
await test('after connecting, each end can read the other profile with colour and animal', async () => {
  const r = await asUser(B, `select u.id, c.label as color, a.label as animal from users u join colors c on c.id = u.color_id join animals a on a.id = u.animal_id order by u.id`);
  assert.deepEqual(r.rows.map((x) => x.id).sort(), [A, B].sort());
  assert.ok(r.rows.every((x) => x.color && x.animal));
});
await test('a stranger cannot read either profile', async () => {
  const r = await asUser(C, `select id from users where id in ('${A}','${B}')`);
  assert.equal(r.rows.length, 0);
});
await test('users cannot read the attempts table', async () => {
  await admin(`insert into pairing_attempts (user_id) values ('${B}')`);
  const r = await asUser(B, `select count(*)::int as n from pairing_attempts`);
  assert.equal(r.rows[0].n, 0);
});
await test('users cannot insert pairing codes or connections directly', async () => {
  const a = await asUser(B, `insert into pairing_codes (code, user_id) values ('4242', '${B}')`);
  assert.ok(a.error, 'direct insert into pairing_codes should be blocked');
  const b = await asUser(C, `insert into user_connections (user_1_id, user_2_id) values ('${C}', '${A}')`);
  assert.ok(b.error, 'direct insert into user_connections should be blocked');
});
await test('either end can delete the connection', async () => {
  const r = await asUser(B, `delete from user_connections where user_1_id = '${A}' and user_2_id = '${B}'`);
  assert.equal(r.error, undefined, r.error);
  assert.equal((await admin(`select count(*)::int as n from user_connections`))[0].n, 0);
});

console.log('\nedge cases');
await test('create_pairing_code gives up cleanly when all 10,000 codes are taken', async () => {
  await admin(`delete from pairing_codes`);
  await admin(`insert into pairing_codes (code, user_id) select lpad(g::text, 4, '0'), '${C}' from generate_series(0, 9999) g`);
  const r = await asUser(A, `select create_pairing_code()`);
  assert.match(r.error, /no_code_available/);
  await admin(`delete from pairing_codes`);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
