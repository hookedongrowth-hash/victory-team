import { defineConfig } from 'vite';

// The app is served from https://<user>.github.io/victory-team/
// A content security policy that only lets the page talk to its own Supabase project.
function csp() {
  return {
    name: 'csp',
    transformIndexHtml(html: string) {
      const raw = process.env.VITE_SUPABASE_URL || 'https://*.supabase.co';
      const origin = raw.includes('*') ? raw : new URL(raw).origin;
      const policy = [
        "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:", `connect-src 'self' ${origin}`, "object-src 'self' blob:", "frame-src 'self' blob:",
        "base-uri 'none'", "form-action 'none'",
      ].join('; ');
      return html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${policy}">`);
    },
  };
}

export default defineConfig({
  plugins: [csp()],
  base: process.env.VITE_BASE ?? '/victory-team/',
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['tests/unit/**/*.test.ts', 'tests/rls/**/*.test.ts'] },
} as any);
