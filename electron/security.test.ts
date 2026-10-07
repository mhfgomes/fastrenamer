import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAppUrlPolicy, isAllowedAppUrl, isTrustedIpcSender } from './security';

const indexPath = path.resolve('/Applications/Fast Renamer.app/Contents/Resources/app.asar/dist-renderer/index.html');
const indexUrl = pathToFileURL(indexPath).href;

describe('isAllowedAppUrl', () => {
  it('allows only the packaged index.html in production', () => {
    const policy = createAppUrlPolicy({ indexPath });

    expect(isAllowedAppUrl(indexUrl, policy)).toBe(true);
    expect(isAllowedAppUrl(`${indexUrl}#/settings`, policy)).toBe(true);
    expect(isAllowedAppUrl(`${indexUrl}?x=1`, policy)).toBe(true);

    expect(isAllowedAppUrl(pathToFileURL('/etc/passwd').href, policy)).toBe(false);
    expect(isAllowedAppUrl(pathToFileURL(path.join(path.dirname(indexPath), 'other.html')).href, policy)).toBe(false);
    expect(isAllowedAppUrl('file://evil.example/index.html', policy)).toBe(false);
    expect(isAllowedAppUrl('https://example.com/', policy)).toBe(false);
    expect(isAllowedAppUrl('http://localhost:5173/', policy)).toBe(false);
    expect(isAllowedAppUrl('not a url', policy)).toBe(false);
  });

  it('allows only the dev server origin in development', () => {
    const policy = createAppUrlPolicy({ devServerUrl: 'http://localhost:5173/', indexPath });

    expect(isAllowedAppUrl('http://localhost:5173/', policy)).toBe(true);
    expect(isAllowedAppUrl('http://localhost:5173/src/main.tsx?t=1', policy)).toBe(true);

    expect(isAllowedAppUrl('http://localhost:5174/', policy)).toBe(false);
    expect(isAllowedAppUrl('https://localhost:5173/', policy)).toBe(false);
    expect(isAllowedAppUrl('http://localhost.evil.com:5173/', policy)).toBe(false);
    expect(isAllowedAppUrl(indexUrl, policy)).toBe(false);
  });

  it('compares paths case-insensitively only on Windows', () => {
    const policy = createAppUrlPolicy({ indexPath });
    const upperCasedUrl = pathToFileURL(path.join(path.dirname(indexPath), 'INDEX.html')).href;
    expect(isAllowedAppUrl(upperCasedUrl, policy)).toBe(process.platform === 'win32');
  });
});

describe('isAllowedAppUrl with win32 path semantics', () => {
  const winIndexPath = 'C:\\Program Files\\Fast Renamer\\resources\\app.asar\\dist-renderer\\index.html';
  const winIndexUrl = 'file:///C:/Program%20Files/Fast%20Renamer/resources/app.asar/dist-renderer/index.html';
  const policy = createAppUrlPolicy({ indexPath: winIndexPath, platform: 'win32' });

  it('keeps the native drive-letter path', () => {
    expect(policy).toEqual({ kind: 'file', indexPath: winIndexPath, platform: 'win32' });
  });

  it('allows the packaged index.html file URL', () => {
    expect(isAllowedAppUrl(winIndexUrl, policy)).toBe(true);
    expect(isAllowedAppUrl(`${winIndexUrl}#/settings`, policy)).toBe(true);
    expect(isAllowedAppUrl(winIndexUrl.replace('file:///', 'file://localhost/'), policy)).toBe(true);
  });

  it('compares drive letter and path case-insensitively', () => {
    expect(isAllowedAppUrl(winIndexUrl.toLowerCase(), policy)).toBe(true);
    expect(isAllowedAppUrl(winIndexUrl.replace('index.html', 'INDEX.HTML'), policy)).toBe(true);
    expect(isAllowedAppUrl(winIndexUrl.replace('file:///C:', 'file:///c:'), policy)).toBe(true);
  });

  it('rejects other files, drives, UNC hosts and traversal', () => {
    expect(isAllowedAppUrl(winIndexUrl.replace('index.html', 'other.html'), policy)).toBe(false);
    expect(isAllowedAppUrl(winIndexUrl.replace('file:///C:', 'file:///D:'), policy)).toBe(false);
    expect(isAllowedAppUrl('file://server/share/index.html', policy)).toBe(false);
    expect(isAllowedAppUrl('file:///C:/Windows/System32/drivers/etc/hosts', policy)).toBe(false);
    expect(
      isAllowedAppUrl(winIndexUrl.replace('dist-renderer/index.html', 'dist-renderer/../index.html'), policy),
    ).toBe(false);
  });
});

describe('isTrustedIpcSender', () => {
  const policy = createAppUrlPolicy({ indexPath });
  const mainFrame = { url: indexUrl, processId: 4, routingId: 1 };
  const webContents = { mainFrame };
  const window = { isDestroyed: () => false, webContents };

  it('accepts the main frame of the main window on the app URL', () => {
    expect(isTrustedIpcSender({ sender: webContents, senderFrame: mainFrame }, window, policy)).toBe(true);
  });

  it('rejects other webContents, subframes, foreign URLs and missing frames', () => {
    expect(isTrustedIpcSender({ sender: {}, senderFrame: mainFrame }, window, policy)).toBe(false);
    expect(
      isTrustedIpcSender({ sender: webContents, senderFrame: { ...mainFrame, routingId: 2 } }, window, policy),
    ).toBe(false);
    expect(
      isTrustedIpcSender({ sender: webContents, senderFrame: { ...mainFrame, processId: 9 } }, window, policy),
    ).toBe(false);
    expect(
      isTrustedIpcSender(
        { sender: webContents, senderFrame: { ...mainFrame, url: 'https://evil.example/' } },
        window,
        policy,
      ),
    ).toBe(false);
    expect(isTrustedIpcSender({ sender: webContents, senderFrame: null }, window, policy)).toBe(false);
  });

  it('rejects when there is no live main window', () => {
    const event = { sender: webContents, senderFrame: mainFrame };
    expect(isTrustedIpcSender(event, null, policy)).toBe(false);
    expect(isTrustedIpcSender(event, { ...window, isDestroyed: () => true }, policy)).toBe(false);
  });
});
