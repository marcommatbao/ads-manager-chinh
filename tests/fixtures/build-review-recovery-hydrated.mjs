// Explicitly isolated Vite build: no project config, env files, providers or server.
import { build } from 'vite'
import path from 'node:path'
await build({ configFile: false, envFile: false, envDir: false, publicDir: false,
  resolve: { alias: { '@': process.cwd() } },
  build: { outDir: path.resolve('tests/fixtures/local/review-recovery'), emptyOutDir: false,
    lib: { entry: path.resolve('tests/fixtures/review-recovery-hydrated.tsx'), formats: ['es'], fileName: () => 'fixture.js' }, minify: false },
  define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' } })
