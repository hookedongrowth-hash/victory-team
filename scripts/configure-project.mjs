// Keeps the hosted project's auth settings the way the app expects.
// Sign up is closed: people only arrive through a code from the coach.
import { patchAuthConfig } from './mgmt.mjs';

await patchAuthConfig({
  disable_signup: true,
  external_anonymous_users_enabled: false,
  mailer_autoconfirm: false,
  site_url: 'https://hookedongrowth-hash.github.io/victory-team/',
  uri_allow_list: 'https://hookedongrowth-hash.github.io/victory-team/',
});
console.log('Project auth settings are in place.');
