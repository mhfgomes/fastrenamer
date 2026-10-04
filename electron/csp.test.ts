import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildDevelopmentCsp,
  extractInlineScripts,
  hashInlineScript,
  injectProductionCspMeta,
} from './csp';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function cspFromHtml(html: string) {
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  if (!match) {
    throw new Error('CSP meta tag not found');
  }
  return match[1];
}

describe('production CSP', () => {
  it('finds the inline theme bootstrap script in index.html', () => {
    const scripts = extractInlineScripts(indexHtml);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('theme_snapshot');
  });

  it('allows exactly the hash of the inline theme script and no unsafe-inline scripts', () => {
    const [script] = extractInlineScripts(indexHtml);
    const expectedHash = `'sha256-${createHash('sha256').update(script).digest('base64')}'`;
    const policy = cspFromHtml(injectProductionCspMeta(indexHtml));
    const scriptSrc = policy.split('; ').find((directive) => directive.startsWith('script-src '));

    expect(scriptSrc).toBe(`script-src 'self' ${expectedHash}`);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
  });

  it('does not allow a modified inline script', () => {
    const [script] = extractInlineScripts(indexHtml);
    const policy = cspFromHtml(injectProductionCspMeta(indexHtml));
    expect(policy).not.toContain(hashInlineScript(`${script}alert(1);`));
  });

  it('places the CSP meta before any script', () => {
    const html = injectProductionCspMeta(indexHtml);
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'));
  });

  it('refuses to inject twice', () => {
    expect(() => injectProductionCspMeta(injectProductionCspMeta(indexHtml))).toThrow();
  });
});

describe('development CSP', () => {
  it('allows the dev server websocket for HMR', () => {
    const policy = buildDevelopmentCsp('http://localhost:5173/');
    expect(policy).toContain("connect-src 'self' http://localhost:5173 ws://localhost:5173 wss://localhost:5173");
  });
});
