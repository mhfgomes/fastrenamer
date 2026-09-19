import type { UpdateChannel } from '../src/shared/contracts';

const GITHUB_RELEASES_URL = 'https://github.com/mhfgomes/fastrenamer/releases';

function toReleaseTag(version: string) {
  return version.startsWith('v') ? version : `v${version}`;
}

export function resolveDefaultUpdateChannel(version: string): UpdateChannel {
  return version.includes('-ea') ? 'ea' : 'stable';
}

export function toUpdaterChannel(channel: UpdateChannel) {
  return channel === 'ea' ? 'ea' : 'latest';
}

export function applyUpdateChannelSettings(
  updater: { channel: string | null; allowPrerelease: boolean },
  channel: UpdateChannel,
) {
  updater.channel = toUpdaterChannel(channel);
  updater.allowPrerelease = channel === 'ea';
}

export function getReleaseDownloadUrl(channel: UpdateChannel, version?: string) {
  if (channel === 'ea') {
    if (version) {
      return `${GITHUB_RELEASES_URL}/tag/${toReleaseTag(version)}`;
    }

    return `${GITHUB_RELEASES_URL}?prerelease=1`;
  }

  if (!version) {
    return `${GITHUB_RELEASES_URL}/latest`;
  }

  return `${GITHUB_RELEASES_URL}/tag/${toReleaseTag(version)}`;
}
