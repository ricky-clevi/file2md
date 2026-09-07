import { rm, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
const tsc = fileURLToPath(
  new URL('../node_modules/typescript/bin/tsc', import.meta.url)
);
await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
// One implementation avoids duplicated code and different error/class identities
// when a consumer uses both import and require in the same process.
execFileSync(
  process.execPath,
  [
    tsc,
    '-p',
    'tsconfig.build.json',
    '--module',
    'commonjs',
    '--moduleResolution',
    'node',
    '--outDir',
    'dist/cjs'
  ],
  { cwd: root, stdio: 'inherit' }
);
await mkdir(new URL('../dist/cjs', import.meta.url), { recursive: true });
await writeFile(
  new URL('../dist/cjs/package.json', import.meta.url),
  '{"type":"commonjs"}\n'
);
const api = createRequire(import.meta.url)('../dist/cjs/index.js');
const names = Object.keys(api).filter((name) => name !== '__esModule');
await writeFile(
  new URL('../dist/index.js', import.meta.url),
  `import api from './cjs/index.js';\nexport const { ${names.join(', ')} } = api;\n`
);
await writeFile(
  new URL('../dist/index.d.ts', import.meta.url),
  "export * from './cjs/index.js';\n"
);
