/* Compare real project CSS across a dependency upgrade; never rewrites source styles. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const loadConfig = require('tailwindcss/loadConfig');
const autoprefixer = require('autoprefixer');
const nested = require('postcss-nested');

async function main() {
  const [mode, destination] = process.argv.slice(2);
  assert.ok(['before', 'after'].includes(mode), 'Use before or after');
  assert.ok(destination, 'Provide an ignored evidence directory');
  const root = process.cwd();
  const output = path.resolve(destination);
  assert.ok(output.startsWith(path.resolve(root, '.taskbook-working') + path.sep));
  await fs.mkdir(output, { recursive: true });
  const config = loadConfig(path.join(root, 'tailwind.config.ts'));
  const globals = await fs.readFile('src/app/globals.css', 'utf8');
  const flow = await fs.readFile(require.resolve('@xyflow/react/dist/style.css'), 'utf8');
  const fixture = `@tailwind base; @tailwind components; @tailwind utilities;
.card, .panel {
  &:hover, &:focus-visible { @apply border-brand text-brand-ink; }
  & > :is(.a, .b) { @apply px-3; }
  .dark & { @apply bg-surface; }
  & + & { @apply mt-4; }
  &[data-state="open"] { @apply ring-2; }
}`;
  const variants = 'group-hover:text-brand-ink peer-checked:bg-brand hover:bg-brand-soft focus-visible:ring-2 md:grid-cols-2 [&>p]:mb-2 data-[state=open]:opacity-100 w-[calc(100%-2rem)] -translate-x-1/2 supports-[display:grid]:grid';
  const cases = [
    ['project', flow + '\n' + globals, config, false],
    ['nesting-and-variants', fixture, { ...config, content: [{ raw: variants, extension: 'html' }] }, true],
  ];
  const result = {};
  for (const [name, source, options, useNesting] of cases) {
    const compiled = await postcss([...(useNesting ? [nested()] : []), tailwind(options), autoprefixer()]).process(source, { from: path.join(root, 'src/app/globals.css'), map: false });
    const bytes = Buffer.from(compiled.css);
    const target = path.join(output, name + '-' + mode + '.css');
    await fs.writeFile(target, bytes, { flag: 'wx' });
    if (mode === 'after') assert.deepEqual(bytes, await fs.readFile(path.join(output, name + '-before.css')), name + ' CSS changed');
    result[name] = { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), warnings: compiled.warnings().map(w => w.text) };
  }
  // Resolve from each actual consumer: scoped overrides need not hoist to the root.
  const parserVersions = Object.fromEntries(['tailwindcss', 'postcss-nested'].map(name => [name, createRequire(require.resolve(name))('postcss-selector-parser/package.json').version]));
  const evidence = { mode, parserVersions, tailwind: require('tailwindcss/package.json').version, cases: result, ...(mode === 'after' ? { allBytesIdentical: true } : {}) };
  await fs.writeFile(path.join(output, 'css-' + mode + '.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(evidence));
}
main().catch(error => { console.error(error instanceof assert.AssertionError ? error.message : 'CSS compatibility check failed; inspect local files'); process.exitCode = 1; });
