import { createHash } from 'node:crypto';

const INLINE_SCRIPT_PATTERN = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

/** Returns the text content of every inline (non-`src`) `<script>` element. */
export function extractInlineScripts(html: string): string[] {
  return [...html.matchAll(INLINE_SCRIPT_PATTERN)]
    .map((match) => match[1])
    .filter((content) => content.length > 0);
}

/** CSP source expression (`'sha256-…'`) for an inline script's exact text. */
export function hashInlineScript(content: string): string {
  return `'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`;
}

/**
 * Strict policy for the packaged renderer. Inline scripts are only allowed
 * when their exact content hash is listed.
 */
export function buildProductionCsp(inlineScriptHashes: readonly string[]): string {
  return [
    "default-src 'self'",
    ['script-src', "'self'", ...inlineScriptHashes].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * Relaxed policy for the Vite dev server: React Refresh injects an inline
 * module preamble and HMR needs a websocket back to the dev server.
 */
export function buildDevelopmentCsp(devServerUrl: string): string {
  const { origin, host } = new URL(devServerUrl);
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${origin} ws://${host} wss://${host}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * Injects a `<meta http-equiv="Content-Security-Policy">` tag (hashing every
 * inline script in the given HTML) directly after `<meta charset>`, so it is in
 * effect before any script runs.
 */
export function injectProductionCspMeta(html: string): string {
  const policy = buildProductionCsp(extractInlineScripts(html).map(hashInlineScript));
  const charsetMeta = /<meta\s+charset=["']?[^"'>\s]+["']?\s*\/?>/i;

  if (!charsetMeta.test(html)) {
    throw new Error('index.html must contain <meta charset> so the CSP meta tag can be injected.');
  }
  if (/http-equiv=["']?Content-Security-Policy/i.test(html)) {
    throw new Error('index.html already contains a CSP meta tag; it is generated at build time.');
  }

  return html.replace(
    charsetMeta,
    (match) => `${match}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
  );
}
