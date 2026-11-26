// Browser fixture bundle only. No Next build, env files, server or provider credentials.
import { build } from 'vite'
import path from 'node:path'
await build({ configFile: false, envDir: false, publicDir: false, resolve: { alias: { '@': process.cwd() } },
  build: { outDir: '/tmp/ads-quality-hydrated', emptyOutDir: false, lib: {
    entry: path.resolve('tests/fixtures/quality-hydrated.tsx'), formats: ['es'], fileName: () => 'fixture.js' },
    minify: false }, define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' } })
