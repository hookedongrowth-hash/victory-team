// Talks to the Supabase Management API. Needs SUPABASE_ACCESS_TOKEN and
// SUPABASE_PROJECT_REF in the environment. Never prints a secret or any query result.
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;

export function need() {
  if (!TOKEN || !REF) throw new Error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required.');
  if (!/^[a-z0-9]{20}$/.test(REF)) throw new Error('SUPABASE_PROJECT_REF does not look right.');
}

async function call(method, path, body) {
  need();
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} failed with ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export const sql = (query) => call('POST', '/database/query', { query });
export const patchAuthConfig = (cfg) => call('PATCH', '/config/auth', cfg);
