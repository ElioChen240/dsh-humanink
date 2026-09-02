import { defineConfig } from 'tsdown';

const clientExternals = new Set([
  'react',
  'react/jsx-runtime',
]);

export default defineConfig([
  {
    name: 'dsh-humanink/host',
    entry: { index: 'packages/humanink-harness/src/index.ts' },
    outDir: 'dist/bundle',
    format: ['esm'],
    fixedExtension: false,
    dts: false,
    clean: true,
    deps: {
      alwaysBundle: ['@humanink/core', '@humanink/storage'],
    },
    outputOptions: { entryFileNames: 'index.mjs' },
  },
  {
    name: 'dsh-humanink/client',
    entry: { client: 'packages/humanink-client/src/index.ts' },
    outDir: 'dist/bundle',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: (specifier: string) => clientExternals.has(specifier),
      alwaysBundle: (specifier: string) => !clientExternals.has(specifier),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapExcludeSources: false,
      banner: 'window.__ModuleLoader__.load({ id: "dsh-humanink", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]);
