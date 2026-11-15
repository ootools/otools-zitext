import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

const root = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      root,
      environment: 'jsdom',
      include: process.env.ZITEXT_UPSTREAM_TESTS
        ? ['tests/**/*.test.ts', 'tests/**/*.test.js', 'src/**/*.test.ts', 'src/**/*.test.tsx']
        : ['tests/**/*.test.ts', 'tests/**/*.test.js'],
      exclude: ['**/node_modules/**', '**/dist/**'],
      testTimeout: 15000,
    },
  }),
);
