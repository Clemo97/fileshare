/**
 * The privacy policy page. Apple wants a link to it inside the app as well as in App Store
 * Connect (App Review Guideline 5.1.1(i)). The app shows the link only once this is set, so
 * set EXPO_PUBLIC_PRIVACY_POLICY_URL (in .env.local, and as an EAS environment variable for
 * store builds) before submitting. Public by design, like the Supabase values.
 */
export const PRIVACY_POLICY_URL = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL;
