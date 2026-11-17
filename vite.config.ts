import { defineConfig } from 'vite';

// The app is served from https://<user>.github.io/victory-team/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/victory-team/',
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['tests/unit/**/*.test.ts', 'tests/rls/**/*.test.ts'] },
} as any);
