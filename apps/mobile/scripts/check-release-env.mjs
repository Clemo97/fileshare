// Stops an EAS build that would silently turn into the offline demo or ship a secret.
//
// The app reads EXPO_PUBLIC_* values when its JavaScript is bundled. A cloud build has no
// .env.local (it is gitignored), so without EAS environment variables the build would succeed
// and the app would fall back to sample data (see src/lib/supabase.ts). Runs on the EAS build
// server after dependencies are installed ("eas-build-post-install" in package.json); a failing
// exit code is meant to fail the build [not yet seen on a real EAS build].
//
//   node scripts/check-release-env.mjs        (to try it locally: set the three variables first)
const problems = [];

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const privacy = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL;

if (!url) problems.push('EXPO_PUBLIC_SUPABASE_URL is not set');
else if (!/^https:\/\/[^/\s]+/.test(url)) problems.push('EXPO_PUBLIC_SUPABASE_URL must be an https URL');

if (!key) {
  problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is not set');
} else {
  // Everything EXPO_PUBLIC_ ends up readable inside the app. Refuse the keys that must stay private.
  if (key.startsWith('sb_secret_')) problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is a secret key');
  try {
    const role = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString()).role;
    if (role === 'service_role') problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is the service-role key');
  } catch {} // not a JWT: a new-style publishable key
}

if (!privacy) {
  problems.push('EXPO_PUBLIC_PRIVACY_POLICY_URL is not set (the app must link to its privacy policy)');
} else if (!/^https:\/\/[^/\s]+/.test(privacy)) {
  problems.push('EXPO_PUBLIC_PRIVACY_POLICY_URL must be an https URL');
}

if (problems.length) {
  console.error('\nRelease build stopped:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  console.error('\nSet them with `eas env:create --environment production` (see RELEASE_PLAN.md).\n');
  process.exit(1);
}
console.log('Release environment looks complete.');
