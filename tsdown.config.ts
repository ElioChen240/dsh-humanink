import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['packages/humanink-harness/src/index.ts'],
  outDir: 'dist/bundle',
  format: ['esm'],
  dts: false,
  clean: true,
  deps: {
    alwaysBundle: ['@humanink/core', '@humanink/storage'],
  },
});
