import { isPresetThemeId, type AppTheme } from '../themes';
import type { Translate } from '../i18n';

/** Localized display name: presets are translated, custom names fall back when left empty. */
export function getThemeName(theme: AppTheme, t: Translate) {
  if (theme.kind === 'preset' && isPresetThemeId(theme.id)) {
    return t(`theme.preset.${theme.id}.name`);
  }
  return theme.name.trim() || (theme.kind === 'custom' ? t('appearance.theme_name_placeholder') : theme.id);
}

export function getThemeDescription(theme: AppTheme, t: Translate) {
  if (theme.kind === 'preset' && isPresetThemeId(theme.id)) {
    return t(`theme.preset.${theme.id}.description`);
  }
  if (theme.kind === 'preset' || theme.description.trim()) {
    return theme.description;
  }
  return theme.basedOnName
    ? t('theme.custom.based_on', { name: theme.basedOnName })
    : t('theme.custom.fallback_description');
}
