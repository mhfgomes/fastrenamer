import {
  Braces,
  Calendar,
  CaseSensitive,
  Eraser,
  FileCode,
  Hash,
  Replace,
  Scissors,
  Type,
} from 'lucide-react';
import type { RenameRule } from '@fast-renamer/rename-engine/types';
import type { useI18n } from '../i18n';

export function getRuleMeta(t: ReturnType<typeof useI18n>['t']): Record<
  RenameRule['type'],
  { label: string; color: string; icon: React.ComponentType<{ className?: string }> }
> {
  return {
    new_name: { label: t('rule.new_name'), color: '#38bdf8', icon: Type },
    custom_rule: { label: t('rule.custom_rule'), color: '#f97316', icon: Braces },
    find_replace: { label: t('rule.find_replace'), color: '#4e8fff', icon: Replace },
    prefix_suffix: { label: t('rule.prefix_suffix'), color: '#a78bfa', icon: Braces },
    case_transform: { label: t('rule.case_transform'), color: '#34d399', icon: CaseSensitive },
    trim_text: { label: t('rule.trim_text'), color: '#2dd4bf', icon: Scissors },
    remove_text: { label: t('rule.remove_text'), color: '#f87171', icon: Eraser },
    sequence_insert: { label: t('rule.sequence_insert'), color: '#fb923c', icon: Hash },
    letter_sequence_insert: { label: t('rule.letter_sequence_insert'), color: '#f59e0b', icon: Type },
    date_time: { label: t('rule.date_time'), color: '#fbbf24', icon: Calendar },
    extension_handling: { label: t('rule.extension_handling'), color: '#e879f9', icon: FileCode },
  };
}

export function getNewNameTokens(t: ReturnType<typeof useI18n>['t']) {
  return [
    { label: t('new_name.token.sequence.label'), detail: t('new_name.token.sequence.detail'), value: '{seq_num:0001}' },
    { label: t('new_name.token.letter_sequence.label'), detail: t('new_name.token.letter_sequence.detail'), value: '{seq_letter}' },
    { label: t('new_name.token.reverse_letter_sequence.label'), detail: t('new_name.token.reverse_letter_sequence.detail'), value: '{seq_letter_rev}' },
    { label: t('new_name.token.original.label'), detail: t('new_name.token.original.detail'), value: '{original_stem}' },
    { label: t('new_name.token.current.label'), detail: t('new_name.token.current.detail'), value: '{current_stem}' },
    { label: t('new_name.token.parent.label'), detail: t('new_name.token.parent.detail'), value: '{parent}' },
    { label: t('new_name.token.date.label'), detail: t('new_name.token.date.detail'), value: '{date}' },
    { label: t('new_name.token.time.label'), detail: t('new_name.token.time.detail'), value: '{time}' },
  ] as const;
}

export function getNewNameStarters(t: ReturnType<typeof useI18n>['t']) {
  return [
    { label: t('new_name.starter.simple'), value: 'name_{seq_num:0001}' },
    { label: t('new_name.starter.original'), value: '{original_stem}_{seq_num:0001}' },
    { label: t('new_name.starter.folder'), value: '{parent}_{seq_num:0001}' },
    { label: t('new_name.starter.date'), value: '{date}_{seq_num:0001}' },
  ] as const;
}

export function getCustomRuleQuickInsert() {
  return [
    { label: 'currentName', value: 'currentName' },
    { label: 'currentStem', value: 'currentStem' },
    { label: 'originalStem', value: 'originalStem' },
    { label: 'extension', value: 'extension' },
    { label: 'parent', value: 'parent' },
    { label: 'sourcePath', value: 'sourcePath' },
    { label: 'index', value: 'index' },
    { label: 'total', value: 'total' },
    { label: 'isDirectory', value: 'isDirectory' },
  ] as const;
}

export function getCustomRuleExamples() {
  return [
    {
      label: 'Snake + sequence',
      value: 'snake(originalStem) + "_" + pad(index, 3) + ext(lower(extension))',
    },
    {
      label: 'Parent prefix',
      value: 'kebab(parent) + "_" + kebab(currentStem) + ext(extension)',
    },
    {
      label: 'Conditional camera import',
      value:
        'startsWith(originalStem, "IMG_") ? "photo_" + pad(index, 4) + ext(lower(extension)) : currentName',
    },
  ] as const;
}

export const CUSTOM_RULE_HELPERS = [
  'lower(text)',
  'upper(text)',
  'trim(text)',
  'title(text)',
  'camel(text)',
  'pascal(text)',
  'kebab(text)',
  'snake(text)',
  'replace(text, search, replacement)',
  'replaceAll(text, search, replacement)',
  'regexReplace(text, pattern, replacement, flags)',
  'pad(value, width, fill?)',
  'slice(text, start, end?)',
  'startsWith(text, search)',
  'endsWith(text, search)',
  'includes(text, search)',
  'basename(path)',
  'dirname(path)',
  'len(text)',
  'when(condition, yes, no)',
  'ext(value)',
] as const;

export function createRule(type: RenameRule['type']): RenameRule {
  const id = `${type}-${crypto.randomUUID()}`;
  switch (type) {
    case 'new_name':
      return { id, type, enabled: true, template: 'name_{seq_num:0001}', reverseSequence: false };
    case 'custom_rule':
      return { id, type, enabled: true, expression: 'currentName' };
    case 'find_replace':
      return { id, type, enabled: true, find: '', replace: '', matchCase: false, useRegex: false, replaceAll: true };
    case 'prefix_suffix':
      return { id, type, enabled: true, prefix: '', suffix: '' };
    case 'case_transform':
      return { id, type, enabled: true, mode: 'title' };
    case 'trim_text':
      return { id, type, enabled: true, mode: 'collapse_spaces' };
    case 'remove_text':
      return { id, type, enabled: true, text: '', matchCase: false };
    case 'sequence_insert':
      return { id, type, enabled: true, position: 'prefix', start: 1, step: 1, padWidth: 3, separator: '_' };
    case 'letter_sequence_insert':
      return { id, type, enabled: true, position: 'prefix', start: 1, step: 1, casing: 'upper', separator: '_' };
    case 'date_time':
      return { id, type, enabled: true, position: 'suffix', format: 'YYYY-MM-DD', separator: '_' };
    case 'extension_handling':
      return { id, type, enabled: true, mode: 'lowercase', replacement: '' };
  }
}

export function moveRule(rules: RenameRule[], ruleId: string, direction: 'up' | 'down') {
  const index = rules.findIndex((r) => r.id === ruleId);
  if (index === -1) return rules;
  const nextIndex = direction === 'up' ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= rules.length) return rules;
  const next = [...rules];
  const [rule] = next.splice(index, 1);
  next.splice(nextIndex, 0, rule);
  return next;
}

export function reorderRule(rules: RenameRule[], draggedRuleId: string, targetRuleId: string) {
  const fromIndex = rules.findIndex((rule) => rule.id === draggedRuleId);
  const toIndex = rules.findIndex((rule) => rule.id === targetRuleId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return rules;
  }

  const next = [...rules];
  const [rule] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, rule);
  return next;
}
