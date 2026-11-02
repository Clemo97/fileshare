// Live end-to-end pairing test against the REAL Supabase project, as two anonymous users.
// Uses the same queries and Realtime subscriptions as apps/mobile/src/features/* (and checks the
// app source still contains them). Reads the URL and public key from apps/mobile/.env.local and
// never prints them. Needs `npm install` in apps/mobile (it borrows its @supabase/supabase-js).
//
//   node file-share-rtc/supabase/tests/e2e-live-pairing.mjs
//
// It leaves two throwaway anonymous users behind (their ids are printed). public.users has no
// foreign key to auth.users, so deleting an account does not delete its profile: remove both,
// e.g. with the SQL endpoint or the SQL editor:
//   delete from auth.users  where id in ('<A>', '<B>');
//   delete from public.users where id in ('<A>', '<B>');   -- cascades to codes, attempts, etc.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url)); // tests -> supabase -> file-share-rtc -> repo
const require = createRequire(`${REPO}/apps/mobile/package.json`);
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(
  fs.readFileSync(`${REPO}/apps/mobile/.env.local`, 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const SB_URL = env.EXPO_PUBLIC_SUPABASE_URL, KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!SB_URL || !KEY) throw new Error('missing env values');

// Make sure this test mirrors the app: the query strings below must exist in the app source.
const pairingSrc = fs.readFileSync(`${REPO}/apps/mobile/src/features/pairing.ts`, 'utf8');
const profilesSrc = fs.readFileSync(`${REPO}/apps/mobile/src/features/profiles.ts`, 'utf8');
const PROFILE_COLUMNS = 'id, colors(id, label), animals(label, emoji)';
const CONNECTIONS_SELECT = `user_1_id, user_2_id,
       user_1:users!user_connections_user_1_id_fkey(${PROFILE_COLUMNS}),
       user_2:users!user_connections_user_2_id_fkey(${PROFILE_COLUMNS})`;

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  if (!ok) failures++;
  results.push(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
  console.log(results.at(-1));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 12000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(150); } return fn(); }
const mk = () => createClient(SB_URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function listen(client, name, filter) {
  const events = [];
  const ch = client.channel(name).on('postgres_changes', filter, (p) => events.push(p));
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('subscribe timeout')), 15000);
    ch.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') { clearTimeout(t); res(); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(t); rej(new Error(status + (err ? ': ' + err.message : ''))); }
    });
  });
  return { ch, events, ready };
}

console.log('== source mirrors');
check('app uses the same profile columns', profilesSrc.includes(PROFILE_COLUMNS));
check('app uses the same embed names', pairingSrc.includes('users!user_connections_user_1_id_fkey') && pairingSrc.includes('users!user_connections_user_2_id_fkey'));
check('app uses the same RPC names', pairingSrc.includes("'create_pairing_code'") && pairingSrc.includes("'redeem_pairing_code'") && pairingSrc.includes('p_code'));

const A = mk(), B = mk(), ANON = mk();

console.log('\n== sign in');
const [{ data: da, error: ea }, { data: db, error: eb }] = await Promise.all([A.auth.signInAnonymously(), B.auth.signInAnonymously()]);
check('device A signs in anonymously', !ea && !!da?.user?.id, ea?.message);
check('device B signs in anonymously', !eb && !!db?.user?.id, eb?.message);
if (ea || eb) { console.log('cannot continue'); process.exit(1); }
const idA = da.user.id, idB = db.user.id;
console.log(`  INFO  throwaway users to delete afterwards: ${idA} ${idB}`);
check('two different users', idA !== idB);

console.log('\n== profiles (what home.tsx shows as "You")');
const prof = async (c, id) => (await c.from('users').select(PROFILE_COLUMNS).eq('id', id).maybeSingle());
const [pa, pb] = await Promise.all([prof(A, idA), prof(B, idB)]);
check('A can read its own profile with colour and animal', !pa.error && pa.data?.colors?.label && pa.data?.animals?.emoji, pa.error?.message || `${pa.data?.colors?.label} ${pa.data?.animals?.label}`);
check('B can read its own profile with colour and animal', !pb.error && pb.data?.colors?.label && pb.data?.animals?.emoji, pb.error?.message || `${pb.data?.colors?.label} ${pb.data?.animals?.label}`);
const strangerSees = await A.from('users').select('id').eq('id', idB);
check('before pairing, A cannot see B', !strangerSees.error && strangerSees.data.length === 0);

console.log('\n== realtime subscriptions (as ConnectionsSync does, on both devices)');
const connA = listen(A, 'connections:A', { event: '*', schema: 'public', table: 'user_connections' });
const connB = listen(B, 'connections:B', { event: '*', schema: 'public', table: 'user_connections' });
try { await Promise.all([connA.ready, connB.ready]); check('both devices subscribed to user_connections', true); }
catch (e) { check('both devices subscribed to user_connections', false, e.message); }

console.log('\n== A generates a code');
const created = await A.rpc('create_pairing_code');
check('create_pairing_code works for a signed-in anonymous user', !created.error && /^\d{4}$/.test(created.data?.code ?? ''), created.error?.message);
const code = created.data?.code;
const red = listen(A, `pairing:${code}`, { event: 'INSERT', schema: 'public', table: 'pairing_code_redemptions', filter: `pairing_code=eq.${code}` });
try { await red.ready; check('A subscribed to redemptions of its code', true); } catch (e) { check('A subscribed to redemptions of its code', false, e.message); }
check('nothing redeemed yet (hasRedemption is false)', (await A.from('pairing_code_redemptions').select('user_id').eq('pairing_code', code).maybeSingle()).data === null);

console.log('\n== B enters codes');
const wrong = code === '0000' ? '0001' : '0000';
const w = await B.rpc('redeem_pairing_code', { p_code: wrong });
check('a wrong code returns null, not an error', !w.error && w.data === null, w.error?.message);
const own = await A.rpc('redeem_pairing_code', { p_code: code });
check("A cannot redeem its own code", !own.error && own.data === null, own.error?.message);
const ok = await B.rpc('redeem_pairing_code', { p_code: code });
check("the right code returns A's user id", !ok.error && ok.data === idA, ok.error?.message);

console.log('\n== both screens update (realtime + the poll fallback)');
check('A receives the redemption event (Realtime)', await waitFor(() => red.events.length > 0), `events=${red.events.length}`);
const polled = await A.from('pairing_code_redemptions').select('user_id').eq('pairing_code', code).maybeSingle();
check('hasRedemption poll sees it too', !polled.error && polled.data?.user_id === idB, polled.error?.message);
check('A receives a user_connections event', await waitFor(() => connA.events.length > 0), `events=${connA.events.map((e) => e.eventType)}`);
check('B receives a user_connections event', await waitFor(() => connB.events.length > 0), `events=${connB.events.map((e) => e.eventType)}`);

console.log('\n== connections list (the app\'s exact embedded query)');
const list = async (c, me) => {
  const { data, error } = await c.from('user_connections').select(CONNECTIONS_SELECT).or(`user_1_id.eq.${me},user_2_id.eq.${me}`).order('created_at');
  return { error, rows: data ?? [] };
};
const la = await list(A, idA), lb = await list(B, idB);
check('A sees exactly one connection', !la.error && la.rows.length === 1, la.error?.message);
check('B sees exactly one connection', !lb.error && lb.rows.length === 1, lb.error?.message);
const otherOfA = la.rows[0] && (la.rows[0].user_1_id === idA ? la.rows[0].user_2 : la.rows[0].user_1);
const otherOfB = lb.rows[0] && (lb.rows[0].user_1_id === idB ? lb.rows[0].user_2 : lb.rows[0].user_1);
check("A sees B's name and emoji", otherOfA?.id === idB && !!otherOfA?.colors?.label && !!otherOfA?.animals?.emoji, otherOfA && `${otherOfA.colors?.label} ${otherOfA.animals?.label}`);
check("B sees A's name and emoji", otherOfB?.id === idA && !!otherOfB?.colors?.label && !!otherOfB?.animals?.emoji, otherOfB && `${otherOfB.colors?.label} ${otherOfB.animals?.label}`);
check('creator is user_1, redeemer is user_2', la.rows[0]?.user_1_id === idA && la.rows[0]?.user_2_id === idB);

console.log('\n== single use, attempt limit, permissions');
const again = await B.rpc('redeem_pairing_code', { p_code: code });
check('a used code cannot be redeemed again', !again.error && again.data === null, again.error?.message);
let limited = null, tries = 0;
for (; tries < 8 && !limited; tries++) { const r = await B.rpc('redeem_pairing_code', { p_code: wrong }); if (r.error) limited = r.error.message; }
check('too many wrong guesses are refused with too_many_attempts', !!limited && limited.includes('too_many_attempts'), `refused after ${tries} more tries; "${limited}"`);
const ins1 = await A.from('pairing_codes').insert({ code: '4242', user_id: idA });
check('a client cannot insert pairing codes directly', !!ins1.error, ins1.error?.message);
// Reversed on purpose: B never created a code, so no redemption supports B as user_1. (A plain
// A-then-B insert would fail on the duplicate key and prove nothing about the policy.)
const ins2 = await A.from('user_connections').insert({ user_1_id: idB, user_2_id: idA });
check('a client cannot insert a connection that no redemption supports', !!ins2.error && /row-level security/i.test(ins2.error.message), ins2.error?.message);
const attempts = await A.from('pairing_attempts').select('*');
check('pairing_attempts is hidden from clients', !attempts.error && attempts.data.length === 0);
const anonCall = await ANON.rpc('create_pairing_code');
check('a client that is not signed in cannot call create_pairing_code', !!anonCall.error, anonCall.error?.message);

console.log('\n== delete a connection (the card\'s Delete button)');
const del = await A.from('user_connections').delete().or(`and(user_1_id.eq.${idA},user_2_id.eq.${idB}),and(user_1_id.eq.${idB},user_2_id.eq.${idA})`);
check('A can delete the connection', !del.error, del.error?.message);
const lb2 = await list(B, idB);
check('B no longer sees it after a refetch', !lb2.error && lb2.rows.length === 0);
const gotDelete = await waitFor(() => connB.events.some((e) => e.eventType === 'DELETE'), 6000);
console.log(`  INFO  B received a realtime DELETE event: ${gotDelete} (the app also refetches on foreground)`);

await Promise.all([A.removeAllChannels(), B.removeAllChannels()]);
await Promise.all([A.auth.signOut(), B.auth.signOut()]);
console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'} (${results.length} checks)`);
process.exit(failures === 0 ? 0 : 1);
