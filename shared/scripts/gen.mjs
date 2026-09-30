// Generates TypeScript types and precompiled (eval-free) Ajv validators from
// schema/quest.schema.json. Run with --check in CI to fail on stale output.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from 'json-schema-to-typescript';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const schemaPath = join(root, 'schema/quest.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const check = process.argv.includes('--check');

const banner = '/* eslint-disable */\n// GENERATED from schema/quest.schema.json by `npm run schema:gen`. Do not edit.\n';

const types = await compile(schema, 'QuestFile', {
  bannerComment: banner,
  unreachableDefinitions: true,
  additionalProperties: false,
  ignoreMinAndMaxItems: true,
  cwd: join(root, 'schema'),
});

const ajv = new Ajv2020({ code: { source: true, esm: true }, allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const id = schema.$id;
const validators =
  banner +
  standaloneCode(ajv, {
    validateOverworld: `${id}#/$defs/Overworld`,
    validateWorld: `${id}#/$defs/World`,
  });

// Ajv's "esm" output still require()s runtime helpers; point them at our ESM shim.
const RUNTIME = {
  'require("ajv/dist/runtime/equal").default': '__rt.equal',
  'require("ajv/dist/runtime/ucs2length").default': '__rt.ucs2length',
  'require("ajv-formats/dist/formats").fullFormats': '__rt.fullFormats',
};
let validatorCode = validators;
for (const [from, to] of Object.entries(RUNTIME)) validatorCode = validatorCode.split(from).join(to);
if (validatorCode.includes('require(')) throw new Error('Unhandled require() in Ajv output');
validatorCode = validatorCode.replace('"use strict";', '"use strict";import * as __rt from "./ajv-runtime.js";');

const outputs = {
  'shared/src/types.gen.ts': types,
  'shared/src/validators.gen.js': validatorCode,
};

let stale = false;
for (const [rel, content] of Object.entries(outputs)) {
  const path = join(root, rel);
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
      console.error(`stale: ${rel}`);
      stale = true;
    }
  } else {
    writeFileSync(path, content);
    console.log(`wrote ${rel}`);
  }
}
if (stale) {
  console.error('Run `npm run schema:gen` and commit the result.');
  process.exit(1);
}
