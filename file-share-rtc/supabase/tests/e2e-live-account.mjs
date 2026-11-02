// Live end-to-end test of account deletion against the REAL Supabase project, as two anonymous
// users, with the same RPC the app calls (apps/mobile/src/features/session.tsx). Reads the URL
// and public key from apps/mobile/.env.local and never prints them. Needs `npm install` in
// apps/mobile (it borrows its @supabase/supabase-js).
//
//   node file-share-rtc/supabase/tests/e2e-live-account.mjs
//
// Unlike e2e-live-pairing.mjs it leaves nothing behind: both throwaway users delete themselves
// with delete_my_account(), which is the thing under test.
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

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
}
const mk = () => createClient(SB_URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('== source mirrors');
const sessionSrc = fs.readFileSync(`${REPO}/apps/mobile/src/features/session.tsx`, 'utf8');
check('app calls the same RPC and signs out locally afterwards',
  sessionSrc.includes("client.rpc('delete_my_account')") && sessionSrc.includes("signOut({ scope: 'local' })"));

const A = mk(), B = mk(), ANON = mk();

console.log('\n== set up: two paired users with a pending request and a signal');
const [{ data: da, error: ea }, { data: db, error: eb }] = await Promise.all([A.auth.signInAnonymously(), B.auth.signInAnonymously()]);
check('both devices sign in anonymously', !ea && !eb && !!da?.user?.id && !!db?.user?.id, ea?.message || eb?.message);
if (ea || eb) process.exit(1);
const idA = da.user.id, idB = db.user.id;

const code = (await A.rpc('create_pairing_code')).data?.code;
const redeemed = await B.rpc('redeem_pairing_code', { p_code: code });
check('B redeems A\'s code', redeemed.data === idA, redeemed.error?.message);

const request = await A.from('file_sharing_request').insert({
  from_user_id: idA, to_user_id: idB, payload: { files: [{ name: 'a.txt', size: 1, mimeType: 'text/plain' }] },
}).select('id').single();
check('A creates a transfer request for B', !request.error, request.error?.message);
const signal = await A.from('web_rtc_signals').insert({ from_user_id: idA, to_user_id: idB, payload: { type: 'offer' } });
check('A sends B a signal', !signal.error, signal.error?.message);

const before = await B.from('user_connections').select('user_1_id');
const reqBefore = await B.from('file_sharing_request').select('id').eq('from_user_id', idA);
const sigBefore = await B.from('web_rtc_signals').select('id').eq('from_user_id', idA);
check('before deleting, B sees the connection, the request and the signal',
  before.data?.length === 1 && reqBefore.data?.length === 1 && sigBefore.data?.length === 1);

console.log('\n== who may call delete_my_account');
const anon = await ANON.rpc('delete_my_account');
check('a client that is not signed in is refused', !!anon.error, anon.error?.message);

console.log('\n== A deletes the account');
const del = await A.rpc('delete_my_account');
check('delete_my_account succeeds for a signed-in user', !del.error, del.error?.message);

const gone = await A.auth.getUser();
check('the auth user no longer exists (the old token is rejected by the server)', !!gone.error && !gone.data?.user, gone.error?.message);

await A.auth.signOut({ scope: 'local' }); // what the app does next: no server call, the user is gone
const again = await A.auth.signInAnonymously();
check('the app can then sign in as someone new', !again.error && !!again.data?.user?.id && again.data.user.id !== idA, again.error?.message);

const after = await B.from('user_connections').select('user_1_id');
const reqAfter = await B.from('file_sharing_request').select('id').eq('from_user_id', idA);
const sigAfter = await B.from('web_rtc_signals').select('id').eq('from_user_id', idA);
check('B no longer sees the connection', !after.error && after.data.length === 0, after.error?.message);
check('the request and the signal are gone too', reqAfter.data?.length === 0 && sigAfter.data?.length === 0);

const stillB = await B.auth.getUser();
check('B is untouched and still signed in', !stillB.error && stillB.data?.user?.id === idB);

console.log('\n== clean up: the new identity and B delete themselves');
const delNew = await A.rpc('delete_my_account');
const delB = await B.rpc('delete_my_account');
check('the new identity deletes itself', !delNew.error, delNew.error?.message);
check('B deletes itself', !delB.error, delB.error?.message);
const bGone = await B.auth.getUser();
check('B is gone', !!bGone.error && !bGone.data?.user, bGone.error?.message);

console.log(`\n${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
