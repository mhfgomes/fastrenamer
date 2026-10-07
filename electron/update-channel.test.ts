import { describe, expect, it } from 'vitest';
import {
  applyUpdateChannelSettings,
  getReleaseDownloadUrl,
  resolveDefaultUpdateChannel,
  toUpdaterChannel,
} from './update-channel';

describe('update channel helpers', () => {
  it('defaults stable installs to the stable channel', () => {
    expect(resolveDefaultUpdateChannel('0.2.6')).toBe('stable');
  });

  it('defaults early access installs to the ea channel', () => {
    expect(resolveDefaultUpdateChannel('0.2.6-ea.42')).toBe('ea');
  });

  it('maps app channels to electron-updater channels', () => {
    expect(toUpdaterChannel('stable')).toBe('latest');
    expect(toUpdaterChannel('ea')).toBe('ea');
  });

  it('configures electron-updater for each channel', () => {
    const updater = {
      channel: 'latest',
      allowPrerelease: false,
      allowDowngrade: false,
    };

    applyUpdateChannelSettings(updater, 'ea');
    expect(updater.channel).toBe('ea');
    expect(updater.allowPrerelease).toBe(true);

    applyUpdateChannelSettings(updater, 'stable');
    expect(updater.channel).toBe('latest');
    expect(updater.allowPrerelease).toBe(false);
  });

  it('never allows downgrades even though electron-updater enables them when setting the channel', () => {
    // Mirrors electron-updater 6.x AppUpdater: the `channel` setter forces
    // `allowDowngrade = true`.
    class FakeAppUpdater {
      private _channel: string | null = null;
      allowPrerelease = false;
      allowDowngrade = false;

      get channel() {
        return this._channel;
      }

      set channel(value: string | null) {
        this._channel = value;
        this.allowDowngrade = true;
      }
    }

    const updater = new FakeAppUpdater();

    applyUpdateChannelSettings(updater, 'ea');
    expect(updater.channel).toBe('ea');
    expect(updater.allowDowngrade).toBe(false);

    // Switching EA -> Stable must not downgrade a newer prerelease build to
    // an older stable release.
    applyUpdateChannelSettings(updater, 'stable');
    expect(updater.channel).toBe('latest');
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
  });

  it('builds manual download URLs per channel', () => {
    expect(getReleaseDownloadUrl('stable')).toBe('https://github.com/mhfgomes/fastrenamer/releases/latest');
    expect(getReleaseDownloadUrl('stable', '0.2.7')).toBe(
      'https://github.com/mhfgomes/fastrenamer/releases/tag/v0.2.7',
    );
    expect(getReleaseDownloadUrl('ea')).toBe('https://github.com/mhfgomes/fastrenamer/releases?prerelease=1');
    expect(getReleaseDownloadUrl('ea', '0.2.6-ea.42')).toBe(
      'https://github.com/mhfgomes/fastrenamer/releases/tag/v0.2.6-ea.42',
    );
  });
});
