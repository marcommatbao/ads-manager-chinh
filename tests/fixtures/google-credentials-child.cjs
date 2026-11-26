/* eslint-disable @typescript-eslint/no-require-imports -- Native cold-process TS loader, no runtime dependency added. */
// Isolated cold startup: only synthetic env supplied by the test. No Next server,
// provider, dotenv, or deployment configuration is loaded.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = process.argv[2];
const ts = require(path.join(root, 'node_modules/typescript'));
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...args);
};
require.extensions['.ts'] = function (module, file) {
  module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, file);
};
const { applySaved } = require(path.join(root, 'lib/settings/saved-credentials.ts'));
const { googleCredentialProvenance } = require(path.join(root, 'lib/settings/google-credentials.ts'));
const file = process.argv[3];
let raw;
try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { raw = {}; }
applySaved({ 'google-settings.json': raw }, process.env, co => co);
// Output only provenance, never values or secret digests.
process.stdout.write(JSON.stringify(googleCredentialProvenance(file, co => co)));
