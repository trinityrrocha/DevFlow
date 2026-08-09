import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const frontendRoot = resolve(import.meta.dirname, '..');
const dockerfile = readFileSync(resolve(frontendRoot, 'Dockerfile'), 'utf8');
const viteConfig = readFileSync(resolve(frontendRoot, 'vite.config.js'), 'utf8');

describe('memoria e empacotamento do frontend', () => {
  it('amplia o heap do Node imediatamente antes do build no Docker', () => {
    const heap = 'ENV NODE_OPTIONS="--max-old-space-size=4096"';
    const build = 'RUN pnpm --filter @devflow/frontend build';
    expect(dockerfile).toContain(`${heap}\n${build}`);
  });

  it('isola Monaco em chunk dedicado do Rollup', () => {
    expect(viteConfig).toContain('manualChunks(id)');
    expect(viteConfig).toContain("/node_modules/monaco-editor/");
    expect(viteConfig).toContain("/node_modules/@monaco-editor/");
    expect(viteConfig).toContain("return 'monaco'");
  });
});
