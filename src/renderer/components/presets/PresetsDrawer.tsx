import { useState } from 'react';
import { Download, Save, Upload } from 'lucide-react';
import type { Preset, RenameRule } from '@fastrenamer/rename-engine/types';
import { Button, Drawer, Input, cn } from '../ui';
import { useI18n } from '../../i18n';
import { getErrorMessage } from '../../app/ipc-errors';
import { PresetList } from './PresetList';

type DrawerMessage = { tone: 'ok' | 'error'; text: string };

export function PresetsDrawer({
  open,
  onOpenChange,
  presets,
  rules,
  loadDisabled,
  onLoadRules,
  onPresetsChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: Preset[];
  /** Current rule stack, saved by "Save preset". */
  rules: RenameRule[];
  /** Loading a preset replaces the rules; blocked while a rename/undo runs. */
  loadDisabled: boolean;
  onLoadRules: (rules: RenameRule[]) => void;
  onPresetsChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [presetName, setPresetName] = useState('');
  const [presetSearch, setPresetSearch] = useState('');
  /** Preset whose name is being edited; while set, the form renames instead of saving. */
  const [renamingPresetId, setRenamingPresetId] = useState<number | null>(null);
  const [message, setMessage] = useState<DrawerMessage | null>(null);

  const needle = presetSearch.trim().toLowerCase();
  const filteredPresets = needle
    ? presets.filter((preset) => preset.name.toLowerCase().includes(needle))
    : presets;

  function stopRenaming() {
    setRenamingPresetId(null);
    setPresetName('');
  }

  async function run(task: () => Promise<DrawerMessage | null>, fallbackError: string) {
    try {
      const next = await task();
      setMessage(next);
    } catch (error) {
      setMessage({ tone: 'error', text: getErrorMessage(error, fallbackError) });
    }
  }

  function submit() {
    const name = presetName.trim();
    if (!name) {
      setMessage({ tone: 'error', text: t('error.preset_name_required') });
      return;
    }
    void run(async () => {
      if (renamingPresetId !== null) {
        await window.advancedRenamer.renamePreset({ id: renamingPresetId, name });
      } else {
        await window.advancedRenamer.savePreset({ name, rules });
      }
      stopRenaming();
      await onPresetsChanged();
      return null;
    }, t('error.save_preset'));
  }

  function deletePreset(preset: Preset) {
    void run(async () => {
      await window.advancedRenamer.deletePreset(preset.id);
      if (renamingPresetId === preset.id) {
        stopRenaming();
      }
      await onPresetsChanged();
      return null;
    }, t('error.delete_preset'));
  }

  function exportPresets(preset?: Preset) {
    void run(async () => {
      const result = preset
        ? await window.advancedRenamer.exportUserPreset(preset.id)
        : await window.advancedRenamer.exportUserPresets();
      return result.canceled ? null : { tone: 'ok', text: t('presets.exported', { count: result.exportedCount }) };
    }, t('error.export_presets'));
  }

  function importPresets() {
    void run(async () => {
      const result = await window.advancedRenamer.importUserPresets();
      if (result.canceled) return null;
      await onPresetsChanged();
      return { tone: 'ok', text: t('presets.imported', { count: result.importedCount }) };
    }, t('error.import_presets'));
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={t('presets.title')} description={t('presets.description')}>
      <div className="space-y-6 p-5">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-semibold text-foreground">
            {renamingPresetId !== null ? t('presets.rename') : t('presets.save_stack')}
          </p>
          <div className="mt-3 space-y-3">
            <Input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder={t('presets.name.placeholder')}
            />
            <div className="flex gap-2">
              <Button onClick={submit}>
                <Save className="h-3.5 w-3.5" />
                {renamingPresetId !== null ? t('presets.rename') : t('presets.save')}
              </Button>
              {renamingPresetId !== null && (
                <Button variant="secondary" onClick={stopRenaming}>
                  {t('presets.clear_target')}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">{t('presets.library')}</p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <div className="w-full sm:w-64">
                <Input
                  value={presetSearch}
                  onChange={(e) => setPresetSearch(e.target.value)}
                  placeholder={t('presets.search.placeholder')}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={importPresets}>
                  <Upload className="h-3.5 w-3.5" />
                  {t('presets.import')}
                </Button>
                <Button variant="secondary" onClick={() => exportPresets()}>
                  <Download className="h-3.5 w-3.5" />
                  {t('presets.export')}
                </Button>
              </div>
            </div>
          </div>
          {message && (
            <div
              role={message.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'rounded-lg border px-3 py-2 text-xs font-medium',
                message.tone === 'ok'
                  ? 'border-ok/20 bg-ok/10 text-ok'
                  : 'border-conflict/20 bg-conflict/10 text-conflict',
              )}
            >
              {message.text}
            </div>
          )}
          <PresetList
            presets={filteredPresets}
            loadDisabled={loadDisabled}
            onLoad={(preset) => {
              onLoadRules(preset.rules);
              onOpenChange(false);
            }}
            onEdit={(preset) => {
              setPresetName(preset.name);
              setRenamingPresetId(preset.id);
              setMessage(null);
            }}
            onExport={(preset) => exportPresets(preset)}
            onDelete={deletePreset}
            emptyMessage={presetSearch.trim() ? t('presets.empty_search') : t('presets.empty')}
          />
        </div>
      </div>
    </Drawer>
  );
}
