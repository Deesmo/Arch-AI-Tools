/**
 * Node module hooks that let `node:test` import the app's TypeScript sources
 * directly. Uses esbuild (already present as Vite's compiler) to strip types;
 * nothing is bundled and no extra dev dependency is needed.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const TS_EXT = /\.tsx?$/;
const HAS_EXT = /\.[cm]?[jt]sx?$/;

export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('.') || specifier.startsWith('/')) && !HAS_EXT.test(specifier)) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (existsSync(candidate)) return { url: `file://${candidate}`, shortCircuit: true };
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (!TS_EXT.test(url)) return next(url, context);
  const source = await readFile(new URL(url), 'utf8');
  const { code } = transformSync(source, {
    loader: url.endsWith('x') ? 'tsx' : 'ts',
    format: 'esm',
    target: 'es2022',
    sourcefile: fileURLToPath(url),
  });
  return { format: 'module', source: code, shortCircuit: true };
}
