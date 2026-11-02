// Runs this repo's Supabase migrations in PGlite with the same stubbed `auth` schema as
// pairing.test.mjs, then exercises delete_my_account() the way PostgREST would: one call = one
// transaction, as the `authenticated` or `anon` role, with auth.uid() set from
// request.jwt.claim.sub.
//
//   cd file-share-rtc/supabase/tests && npm install && npm test
//
// What this does NOT cover: Supabase's real auth (its own tables hang off auth.users with
// cascading foreign keys, which the stub does not have), PostgREST, or Realtime.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

const db = new PGlite();

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
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`);

for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
}

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
const count = async (sql) => (await admin(`select count(*)::int as n from ${sql}`))[0].n;

const uid = async () => (await admin(`insert into auth.users default values returning id`))[0].id;
const [LEAVER, FRIEND, BYSTANDER] = [await uid(), await uid(), await uid()];

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

// Everything a user can own: a connection with a friend, a pairing code, a failed attempt, a
// request with its response, and signals in both directions.
await admin(`insert into user_connections (user_1_id, user_2_id) values ('${LEAVER}', '${FRIEND}')`);
await admin(`insert into user_connections (user_1_id, user_2_id) values ('${FRIEND}', '${BYSTANDER}')`);
await admin(`insert into pairing_codes (code, user_id) values ('1111', '${LEAVER}'), ('2222', '${FRIEND}')`);
await admin(`insert into pairing_attempts (user_id) values ('${LEAVER}'), ('${FRIEND}')`);
const [{ id: requestId }] = await admin(
  `insert into file_sharing_request (from_user_id, to_user_id, payload)
   values ('${LEAVER}', '${FRIEND}', '{"files":[{"name":"a.txt","size":1,"mimeType":"text/plain"}]}') returning id`,
);
await admin(`insert into file_sharing_request_response (request_id, accepted) values ('${requestId}', true)`);
await admin(`insert into web_rtc_signals (from_user_id, to_user_id, payload) values ('${LEAVER}', '${FRIEND}', '{}'), ('${FRIEND}', '${LEAVER}', '{}')`);

console.log('\ndelete_my_account');
await test('signed-in users can call it; anonymous callers and callers without a user cannot', async () => {
  const anon = await call('anon', null, `select delete_my_account()`);
  assert.match(anon.error, /permission denied/);
  const nobody = await asUser(null, `select delete_my_account()`);
  assert.match(nobody.error, /not_authenticated/);
  assert.equal(await count(`users where id = '${LEAVER}'`), 1, 'nothing was deleted by the failed calls');
});
await test('deletes the caller from users and auth.users', async () => {
  const r = await asUser(LEAVER, `select delete_my_account()`);
  assert.equal(r.error, undefined, r.error);
  assert.equal(await count(`users where id = '${LEAVER}'`), 0);
  assert.equal(await count(`auth.users where id = '${LEAVER}'`), 0);
});
await test('deletes everything that belonged to the caller', async () => {
  assert.equal(await count(`user_connections where '${LEAVER}' in (user_1_id, user_2_id)`), 0);
  assert.equal(await count(`pairing_codes where user_id = '${LEAVER}'`), 0);
  assert.equal(await count(`pairing_attempts where user_id = '${LEAVER}'`), 0);
  assert.equal(await count(`file_sharing_request where '${LEAVER}' in (from_user_id, to_user_id)`), 0);
  assert.equal(await count(`file_sharing_request_response where request_id = '${requestId}'`), 0);
  assert.equal(await count(`web_rtc_signals where '${LEAVER}' in (from_user_id, to_user_id)`), 0);
});
await test('leaves other users and their data alone', async () => {
  assert.equal(await count(`users where id in ('${FRIEND}', '${BYSTANDER}')`), 2);
  assert.equal(await count(`auth.users where id in ('${FRIEND}', '${BYSTANDER}')`), 2);
  assert.equal(await count(`user_connections where user_1_id = '${FRIEND}' and user_2_id = '${BYSTANDER}'`), 1);
  assert.equal(await count(`pairing_codes where user_id = '${FRIEND}'`), 1);
  assert.equal(await count(`pairing_attempts where user_id = '${FRIEND}'`), 1);
});
await test('the friend no longer sees the connection', async () => {
  const r = await asUser(FRIEND, `select user_1_id, user_2_id from user_connections`);
  assert.equal(r.error, undefined, r.error);
  assert.deepEqual(r.rows, [{ user_1_id: FRIEND, user_2_id: BYSTANDER }]);
});
await test('calling it again with the same (now stale) identity does nothing and does not fail', async () => {
  const r = await asUser(LEAVER, `select delete_my_account()`);
  assert.equal(r.error, undefined, r.error);
  assert.equal(await count(`users`), 2);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
