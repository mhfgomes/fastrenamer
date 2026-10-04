import { Download, ExternalLink, Palette, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import type { PlatformTarget } from '@fastrenamer/rename-engine/types';
import type { UpdateChannel } from '@shared/contracts';
import {
  Badge,
  Button,
  Drawer,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '../ui';
import { AVAILABLE_LOCALES, useI18n, type AppLocale } from '../../i18n';
import { formatBytes, formatPercent, getUpdateStatusLabel, getUpdateSummary, getUpdateTone } from '../../app/update-utils';
import type { useUpdates } from '../../hooks/useUpdates';
import type { useThemeManager } from '../../hooks/useThemeManager';
import { THEME_TOKEN_FIELDS } from '../../themes';
import { getThemeName } from '../../app/theme-labels';
import { SettingsSection, ThemeOptionCard, ThemeTokenEditor, type SettingsSectionId } from './SettingsTheme';

export function SettingsDrawer({
  open,
  onOpenChange,
  platform,
  updates,
  themeManager,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: PlatformTarget;
  updates: ReturnType<typeof useUpdates>;
  themeManager: ReturnType<typeof useThemeManager>;
}) {
  const { locale, setLocale, t } = useI18n();
  const [openSettingsSection, setOpenSettingsSection] = useState<SettingsSectionId | null>(null);
  const { updateState, updateAction } = updates;
  const {
    theme,
    themes,
    setTheme,
    cycleTheme,
    createThemeFromActive,
    createThemeFromId,
    renameCustomTheme,
    updateCustomThemeToken,
    deleteCustomTheme,
  } = themeManager;
  const activeCustomTheme = theme.kind === 'custom' ? theme : null;
  const idPrefix = useId();
  const channelId = `${idPrefix}-channel`;
  const localeId = `${idPrefix}-locale`;
  const themeNameId = `${idPrefix}-theme-name`;
  const unknownVersion = t('updates.version_unknown');

  function toggleSettingsSection(section: SettingsSectionId) {
    setOpenSettingsSection((current) => (current === section ? null : section));
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings.title')}
      description={t('settings.description')}
    >
      <div className="space-y-3 p-5">
        <SettingsSection
          title={t('settings.updates')}
          badge={(
            <div className="flex items-center gap-2">
              <Badge tone="unchanged">
                {updateState.channel === 'ea' ? t('updates.channel.ea') : t('updates.channel.stable')}
              </Badge>
              <Badge tone={getUpdateTone(updateState.status)} dot>
                {getUpdateStatusLabel(updateState.status, t)}
              </Badge>
            </div>
          )}
          open={openSettingsSection === 'updates'}
          onToggle={() => toggleSettingsSection('updates')}
        >
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="space-y-2">
              <label htmlFor={channelId} className="text-xs text-muted-foreground">{t('updates.channel.label')}</label>
              <Select
                value={updateState.channel}
                onValueChange={(value) => void updates.changeUpdateChannel(value as UpdateChannel)}
              >
                <SelectTrigger id={channelId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stable">{t('updates.channel.stable')}</SelectItem>
                  <SelectItem value="ea">{t('updates.channel.ea')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {updateState.channel === 'ea' ? t('updates.channel.helper_ea') : t('updates.channel.helper_stable')}
              </p>
            </div>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">{getUpdateSummary(updateState, t, locale)}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Badge>{t('updates.current', { version: updateState.currentVersion || unknownVersion })}</Badge>
            {updateState.availableVersion && updateState.availableVersion !== updateState.currentVersion && (
              <Badge tone="accent">{t('updates.latest', { version: updateState.availableVersion })}</Badge>
            )}
            {updateState.checkedAt && (
              <Badge tone="unchanged">
                {t('updates.checked', { date: new Date(updateState.checkedAt).toLocaleString(locale) })}
              </Badge>
            )}
          </div>

          {updateState.progress && updateState.status === 'downloading' && (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${Math.max(4, Math.min(100, updateState.progress.percent))}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t('updates.speed', {
                  percent: formatPercent(updateState.progress.percent, locale),
                  speed: formatBytes(updateState.progress.bytesPerSecond, locale),
                })}
              </p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={updateAction !== 'idle' || updateState.status === 'disabled'}
              onClick={() => void updates.checkForUpdates()}
            >
              <RefreshCcw className={cn('h-3.5 w-3.5', updateAction === 'checking' && 'animate-spin')} />
              {t('updates.check_now')}
            </Button>
            <Button
              size="sm"
              disabled={
                updateState.manualDownloadOnly
                  ? updateState.status !== 'available' || updateAction === 'installing'
                  : updateState.status !== 'downloaded' || updateAction === 'installing'
              }
              onClick={() =>
                void (updateState.manualDownloadOnly ? updates.openUpdateDownload() : updates.installUpdate())
              }
            >
              {updateState.manualDownloadOnly ? (
                <ExternalLink className="h-3.5 w-3.5" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {updateState.manualDownloadOnly ? t('updates.download') : t('updates.restart_install')}
            </Button>
          </div>
        </SettingsSection>
        <SettingsSection
          title={t('settings.language')}
          badge={<Badge tone="accent">{AVAILABLE_LOCALES.find((option) => option.code === locale)?.nativeLabel ?? locale}</Badge>}
          open={openSettingsSection === 'language'}
          onToggle={() => toggleSettingsSection('language')}
        >
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="space-y-2">
              <label htmlFor={localeId} className="text-xs text-muted-foreground">{t('locale.label')}</label>
              <Select value={locale} onValueChange={(value) => setLocale(value as AppLocale)}>
                <SelectTrigger id={localeId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_LOCALES.map((option) => (
                    <SelectItem key={option.code} value={option.code}>
                      {option.nativeLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('locale.helper')}</p>
            </div>
          </div>
        </SettingsSection>
        <SettingsSection
          title={t('settings.appearance')}
          badge={<Badge tone="accent">{getThemeName(theme, t)}</Badge>}
          open={openSettingsSection === 'appearance'}
          onToggle={() => toggleSettingsSection('appearance')}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{t('updates.theme_library')}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('updates.theme_library_help')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={cycleTheme}>
                  <Palette className="h-3.5 w-3.5" />
                  {t('appearance.cycle')}
                </Button>
                <Button size="sm" onClick={createThemeFromActive}>
                  <Plus className="h-3.5 w-3.5" />
                  {t('appearance.new_custom')}
                </Button>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {themes.map((candidate) => (
                <ThemeOptionCard
                  key={candidate.id}
                  theme={candidate}
                  active={candidate.id === theme.id}
                  onSelect={() => setTheme(candidate.id)}
                  onDuplicate={() => createThemeFromId(candidate.id)}
                />
              ))}
            </div>

            {activeCustomTheme ? (
              <div className="space-y-4 rounded-xl border border-border bg-surface/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t('appearance.edit_custom')}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t('appearance.edit_help')}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => deleteCustomTheme(activeCustomTheme.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('appearance.delete_custom')}
                  </Button>
                </div>

                <div className="space-y-2">
                  <label htmlFor={themeNameId} className="text-xs text-muted-foreground">{t('appearance.theme_name')}</label>
                  <Input
                    id={themeNameId}
                    value={activeCustomTheme.name}
                    onChange={(event) => renameCustomTheme(activeCustomTheme.id, event.target.value)}
                    onBlur={(event) => {
                      const nextName = event.target.value.trim() || t('appearance.theme_name_placeholder');
                      if (nextName !== activeCustomTheme.name) {
                        renameCustomTheme(activeCustomTheme.id, nextName);
                      }
                    }}
                    placeholder={t('appearance.theme_name_placeholder')}
                  />
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  {THEME_TOKEN_FIELDS.map((field) => (
                    <ThemeTokenEditor
                      key={field.key}
                      label={t(`theme.token.${field.key}.label`)}
                      description={t(`theme.token.${field.key}.description`)}
                      value={activeCustomTheme.tokens[field.key]}
                      onChange={(value) => updateCustomThemeToken(activeCustomTheme.id, field.key, value)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-card/70 p-4">
                <p className="text-sm font-semibold text-foreground">{t('appearance.editor_title')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('appearance.editor_help')}</p>
              </div>
            )}
          </div>
        </SettingsSection>
        <SettingsSection
          title={t('settings.platform_rules')}
          open={openSettingsSection === 'platformRules'}
          onToggle={() => toggleSettingsSection('platformRules')}
        >
          <p className="text-xs text-muted-foreground">{t('platform_rules.description', { platform })}</p>
        </SettingsSection>
        <SettingsSection
          title={t('settings.execution_profile')}
          open={openSettingsSection === 'executionProfile'}
          onToggle={() => toggleSettingsSection('executionProfile')}
        >
          <p className="text-xs text-muted-foreground">{t('execution_profile.description')}</p>
        </SettingsSection>
      </div>
    </Drawer>
  );
}
