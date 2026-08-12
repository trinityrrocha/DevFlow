import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const frontendRoot = resolve(import.meta.dirname, '..');
const dockerfile = readFileSync(resolve(frontendRoot, 'Dockerfile'), 'utf8');
const viteConfig = readFileSync(resolve(frontendRoot, 'vite.config.js'), 'utf8');
const indexHtml = readFileSync(resolve(frontendRoot, 'index.html'), 'utf8');
const themeBootstrap = readFileSync(resolve(frontendRoot, 'public/theme-bootstrap.js'), 'utf8');
const nginxRuntime = readFileSync(resolve(frontendRoot, '../docker/nginx.runtime.conf.template'), 'utf8');

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

  it('aplica o tema antes do primeiro paint sem violar script-src self', () => {
    const scriptTags = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    expect(scriptTags).toHaveLength(2);
    expect(scriptTags.every((match) => /\bsrc=/.test(match[1]) && match[2].trim() === '')).toBe(true);
    expect(indexHtml).toContain('<script src="/theme-bootstrap.js"></script>');
    expect(indexHtml.indexOf('/theme-bootstrap.js')).toBeLessThan(indexHtml.indexOf('<title>'));
    expect(themeBootstrap).toContain("localStorage.getItem(key)");
    expect(themeBootstrap).toContain("document.documentElement.classList.toggle('dark'");
    expect(nginxRuntime).toContain("script-src 'self'");
    expect(nginxRuntime).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});
