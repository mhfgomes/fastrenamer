import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Braces,
  Calendar,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Eraser,
  FileCode,
  GripVertical,
  Hash,
  Plus,
  Replace,
  Scissors,
  Trash2,
  Type,
} from 'lucide-react';
import type { RenameRule } from '@fast-renamer/rename-engine/types';
import {
  Badge,
  Button,
  Checkbox,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  Panel,
  PanelHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tooltip,
  cn,
} from '../ui';
import { RULE_TYPE_ORDER } from '../../app/defaults';
import {
  CUSTOM_RULE_HELPERS,
  createRule,
  getCustomRuleExamples,
  getCustomRuleQuickInsert,
  getNewNameStarters,
  getNewNameTokens,
  getRuleMeta,
  moveRule,
  reorderRule,
} from '../../app/rule-utils';
import { useI18n } from '../../i18n';

export { createRule, moveRule, reorderRule };

export function RulesPanel({
  rules,
  onAddRule,
  onUpdateRule,
  onMoveRule,
  onReorderRule,
  onDeleteRule,
}: {
  rules: RenameRule[];
  onAddRule: (type: RenameRule['type']) => void;
  onUpdateRule: (id: string, updater: (r: RenameRule) => RenameRule) => void;
  onMoveRule: (id: string, dir: 'up' | 'down') => void;
  onReorderRule: (draggedRuleId: string, targetRuleId: string) => void;
  onDeleteRule: (id: string) => void;
}) {
  const { t } = useI18n();
  const ruleMeta = useMemo(() => getRuleMeta(t), [t]);
  const [draggedRuleId, setDraggedRuleId] = useState<string | null>(null);
  const [dropTargetRuleId, setDropTargetRuleId] = useState<string | null>(null);
  const [collapsedRuleIds, setCollapsedRuleIds] = useState<string[]>([]);

  useEffect(() => {
    setCollapsedRuleIds((current) => current.filter((ruleId) => rules.some((rule) => rule.id === ruleId)));
  }, [rules]);

  function toggleRuleCollapsed(ruleId: string) {
    setCollapsedRuleIds((current) =>
      current.includes(ruleId) ? current.filter((id) => id !== ruleId) : [...current, ruleId],
    );
  }

  return (
    <Panel className="h-full">
      <PanelHeader
        title={t('rules.title')}
        detail={t('rules.detail')}
        actions={
          <DropdownMenuRoot>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm">
                <Plus className="h-3.5 w-3.5" />
                {t('rules.add')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('rules.type')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {RULE_TYPE_ORDER.map((type) => {
                const meta = ruleMeta[type];
                const Icon = meta.icon;
                return (
                  <DropdownMenuItem key={type} onClick={() => onAddRule(type)}>
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded"
                      style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
                    >
                      <Icon className="h-3 w-3" />
                    </span>
                    {meta.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenuRoot>
        }
      />

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
        {rules.length === 0 && (
          <EmptyState message={t('rules.empty')} />
        )}
        {rules.map((rule, index) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            index={index}
            dragging={draggedRuleId === rule.id}
            dropTarget={dropTargetRuleId === rule.id}
            collapsed={collapsedRuleIds.includes(rule.id)}
            onUpdate={(updater) => onUpdateRule(rule.id, updater)}
            onMove={(dir) => onMoveRule(rule.id, dir)}
            onToggleCollapsed={() => toggleRuleCollapsed(rule.id)}
            onDragStart={() => {
              setDraggedRuleId(rule.id);
              setDropTargetRuleId(rule.id);
            }}
            onDragEnter={() => {
              if (draggedRuleId && draggedRuleId !== rule.id) {
                setDropTargetRuleId(rule.id);
              }
            }}
            onDragEnd={() => {
              setDraggedRuleId(null);
              setDropTargetRuleId(null);
            }}
            onDrop={() => {
              if (draggedRuleId && draggedRuleId !== rule.id) {
                onReorderRule(draggedRuleId, rule.id);
              }
              setDraggedRuleId(null);
              setDropTargetRuleId(null);
            }}
            onDelete={() => onDeleteRule(rule.id)}
          />
        ))}
      </div>
    </Panel>
  );
}

export function RuleCard({
  rule,
  index,
  dragging,
  dropTarget,
  collapsed,
  onUpdate,
  onMove,
  onToggleCollapsed,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
  onDelete,
}: {
  rule: RenameRule;
  index: number;
  dragging: boolean;
  dropTarget: boolean;
  collapsed: boolean;
  onUpdate: (updater: (r: RenameRule) => RenameRule) => void;
  onMove: (dir: 'up' | 'down') => void;
  onToggleCollapsed: () => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const meta = getRuleMeta(t)[rule.type];
  const Icon = meta.icon;

  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDragEnter={onDragEnter}
      onDragEnd={onDragEnd}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className={cn(
        'rounded-xl border bg-surface transition-all duration-150',
        !rule.enabled && 'opacity-50',
        dragging && 'scale-[0.99] opacity-70',
        dropTarget && !dragging && 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.35)]',
      )}
      style={{ borderColor: `${meta.color}30`, borderLeftColor: meta.color, borderLeftWidth: '3px' }}
    >
      {/* Card header */}
      <div
        className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3.5 py-3"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onToggleCollapsed();
          }
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                onDragStart();
              }}
              className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-surface-elevated hover:text-foreground active:cursor-grabbing"
              aria-label={t('rules.drag')}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
            <Tooltip content={collapsed ? t('rules.expand') : t('rules.collapse')}>
              <IconButton className="h-7 w-7" onClick={onToggleCollapsed} aria-label={collapsed ? t('rules.expand') : t('rules.collapse')}>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-150', !collapsed && 'rotate-180')} />
              </IconButton>
            </Tooltip>
          </div>
        </div>
        <div className="flex min-w-0 items-center justify-center gap-2.5">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="flex min-h-7 flex-col justify-center text-center">
            <p className="text-sm font-semibold leading-none text-foreground">{meta.label}</p>
            <p className="mt-1 text-[10px] leading-none text-muted-foreground">{t('rules.step', { count: index + 1 })}</p>
          </div>
        </div>

        <div className="flex items-center justify-self-end gap-0.5">
          <Switch
            checked={rule.enabled}
            onCheckedChange={(checked) => onUpdate((r) => ({ ...r, enabled: checked }))}
          />
          <Tooltip content={t('rules.move_up')}>
            <IconButton className="h-7 w-7" onClick={() => onMove('up')}>
              <ChevronUp className="h-3.5 w-3.5" />
            </IconButton>
          </Tooltip>
          <Tooltip content={t('rules.move_down')}>
            <IconButton className="h-7 w-7" onClick={() => onMove('down')}>
              <ChevronDown className="h-3.5 w-3.5" />
            </IconButton>
          </Tooltip>
          <Tooltip content={t('rules.delete')}>
            <IconButton
              className="h-7 w-7 text-destructive hover:bg-destructive/10"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {!collapsed && (
        <div className="border-t px-3.5 py-3" style={{ borderColor: `${meta.color}18` }}>
          <RuleEditor rule={rule} onChange={(next) => onUpdate(() => next)} />
        </div>
      )}
    </div>
  );
}

export function NewNameRuleEditor({
  rule,
  onChange,
}: {
  rule: Extract<RenameRule, { type: 'new_name' }>;
  onChange: (rule: Extract<RenameRule, { type: 'new_name' }>) => void;
}) {
  const { t } = useI18n();
  const tokens = useMemo(() => getNewNameTokens(t), [t]);
  const starters = useMemo(() => getNewNameStarters(t), [t]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function insertToken(token: string) {
    const input = inputRef.current;
    if (!input) {
      onChange({ ...rule, template: `${rule.template}${token}` });
      return;
    }

    const start = input.selectionStart ?? rule.template.length;
    const end = input.selectionEnd ?? rule.template.length;
    const nextTemplate = `${rule.template.slice(0, start)}${token}${rule.template.slice(end)}`;
    onChange({ ...rule, template: nextTemplate });

    requestAnimationFrame(() => {
      const nextCursor = start + token.length;
      input.focus();
      input.setSelectionRange(nextCursor, nextCursor);
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Input
          ref={inputRef}
          value={rule.template}
          onChange={(e) => onChange({ ...rule, template: e.target.value })}
          placeholder={t('editor.new_name.placeholder')}
        />
        <p className="text-xs text-muted-foreground">
          {t('editor.new_name.help')}
        </p>
      </div>

      <Checkbox
        checked={rule.reverseSequence ?? false}
        onCheckedChange={(checked) => onChange({ ...rule, reverseSequence: checked === true })}
        label={t('editor.new_name.reverse_sequence')}
      />

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('editor.new_name.quick_insert')}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {tokens.map((token) => (
            <button
              key={token.value}
              type="button"
              onClick={() => insertToken(token.value)}
              className={cn(
                'rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors',
                'hover:border-accent/40 hover:bg-surface-elevated',
              )}
            >
              <div className="text-xs font-semibold text-foreground">{token.label}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{token.detail}</div>
              <code className="mt-1 block text-[11px] text-accent">{token.value}</code>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('editor.new_name.starters')}
        </p>
        <div className="flex flex-wrap gap-2">
          {starters.map((template) => (
            <Button
              key={template.value}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onChange({ ...rule, template: template.value })}
            >
              {template.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CustomRuleEditor({
  rule,
  onChange,
}: {
  rule: Extract<RenameRule, { type: 'custom_rule' }>;
  onChange: (rule: Extract<RenameRule, { type: 'custom_rule' }>) => void;
}) {
  const { t } = useI18n();
  const quickInsert = useMemo(() => getCustomRuleQuickInsert(), []);
  const examples = useMemo(() => getCustomRuleExamples(), []);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  function insertSnippet(snippet: string) {
    const input = inputRef.current;
    if (!input) {
      onChange({ ...rule, expression: `${rule.expression}${snippet}` });
      return;
    }

    const start = input.selectionStart ?? rule.expression.length;
    const end = input.selectionEnd ?? rule.expression.length;
    const nextExpression = `${rule.expression.slice(0, start)}${snippet}${rule.expression.slice(end)}`;
    onChange({ ...rule, expression: nextExpression });

    requestAnimationFrame(() => {
      const nextCursor = start + snippet.length;
      input.focus();
      input.setSelectionRange(nextCursor, nextCursor);
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-accent/20 bg-accent/5 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{t('editor.custom.beta')}</Badge>
          <p className="text-xs font-medium text-foreground">{t('editor.custom.help')}</p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('editor.custom.return_label')}</p>
      </div>

      <div className="space-y-2">
        <textarea
          ref={inputRef}
          value={rule.expression}
          onChange={(event) => onChange({ ...rule, expression: event.target.value })}
          placeholder={t('editor.custom.placeholder')}
          spellCheck={false}
          className={cn(
            'min-h-[120px] w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none',
            'font-mono leading-6 placeholder:text-muted-foreground transition-colors',
            'focus:border-accent/60 focus:ring-2 focus:ring-accent/10',
          )}
        />
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('editor.custom.quick_insert')}
        </p>
        <div className="flex flex-wrap gap-2">
          {quickInsert.map((snippet) => (
            <Button
              key={snippet.value}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => insertSnippet(snippet.value)}
              className="font-mono"
            >
              {snippet.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('editor.custom.examples')}
        </p>
        <div className="grid gap-2">
          {examples.map((example) => (
            <button
              key={example.label}
              type="button"
              onClick={() => onChange({ ...rule, expression: example.value })}
              className={cn(
                'rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors',
                'hover:border-accent/40 hover:bg-surface-elevated',
              )}
            >
              <div className="text-xs font-semibold text-foreground">{example.label}</div>
              <code className="mt-1 block text-[11px] leading-5 text-accent">{example.value}</code>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('editor.custom.reference')}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {CUSTOM_RULE_HELPERS.map((helper) => (
            <div key={helper} className="rounded-lg border border-border/80 bg-surface px-3 py-2">
              <code className="text-[11px] text-foreground">{helper}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RuleEditor({ rule, onChange }: { rule: RenameRule; onChange: (r: RenameRule) => void }) {
  const { t } = useI18n();
  switch (rule.type) {
    case 'new_name':
      return <NewNameRuleEditor rule={rule} onChange={onChange} />;

    case 'custom_rule':
      return <CustomRuleEditor rule={rule} onChange={onChange} />;

    case 'find_replace':
      return (
        <div className="space-y-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={rule.find}
              onChange={(e) => onChange({ ...rule, find: e.target.value })}
              placeholder={t('editor.find.placeholder')}
            />
            <Input
              value={rule.replace}
              onChange={(e) => onChange({ ...rule, replace: e.target.value })}
              placeholder={t('editor.replace.placeholder')}
            />
          </div>
          <div className="flex flex-wrap gap-4">
            <Checkbox
              checked={rule.matchCase}
              onCheckedChange={(checked) => onChange({ ...rule, matchCase: checked === true })}
              label={t('editor.match_case')}
            />
            <Checkbox
              checked={rule.useRegex}
              onCheckedChange={(checked) => onChange({ ...rule, useRegex: checked === true })}
              label={t('editor.regex')}
            />
            <Checkbox
              checked={rule.replaceAll}
              onCheckedChange={(checked) => onChange({ ...rule, replaceAll: checked === true })}
              label={t('editor.replace_all')}
            />
          </div>
        </div>
      );

    case 'prefix_suffix':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={rule.prefix}
            onChange={(e) => onChange({ ...rule, prefix: e.target.value })}
            placeholder={t('editor.prefix.placeholder')}
          />
          <Input
            value={rule.suffix}
            onChange={(e) => onChange({ ...rule, suffix: e.target.value })}
            placeholder={t('editor.suffix.placeholder')}
          />
        </div>
      );

    case 'case_transform':
      return (
        <Select
          value={rule.mode}
          onValueChange={(value) => onChange({ ...rule, mode: value as typeof rule.mode })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lower">{t('editor.case.lower')}</SelectItem>
            <SelectItem value="upper">{t('editor.case.upper')}</SelectItem>
            <SelectItem value="title">{t('editor.case.title')}</SelectItem>
            <SelectItem value="sentence">{t('editor.case.sentence')}</SelectItem>
            <SelectItem value="camel">{t('editor.case.camel')}</SelectItem>
            <SelectItem value="pascal">{t('editor.case.pascal')}</SelectItem>
            <SelectItem value="kebab">{t('editor.case.kebab')}</SelectItem>
            <SelectItem value="snake">{t('editor.case.snake')}</SelectItem>
          </SelectContent>
        </Select>
      );

    case 'trim_text':
      return (
        <Select
          value={rule.mode}
          onValueChange={(value) => onChange({ ...rule, mode: value as typeof rule.mode })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="trim">{t('editor.trim.trim')}</SelectItem>
            <SelectItem value="trim_start">{t('editor.trim.trim_start')}</SelectItem>
            <SelectItem value="trim_end">{t('editor.trim.trim_end')}</SelectItem>
            <SelectItem value="collapse_spaces">{t('editor.trim.collapse_spaces')}</SelectItem>
            <SelectItem value="remove_spaces">{t('editor.trim.remove_spaces')}</SelectItem>
            <SelectItem value="remove_dashes">{t('editor.trim.remove_dashes')}</SelectItem>
            <SelectItem value="remove_underscores">{t('editor.trim.remove_underscores')}</SelectItem>
          </SelectContent>
        </Select>
      );

    case 'remove_text':
      return (
        <div className="space-y-2.5">
          <Input
            value={rule.text}
            onChange={(e) => onChange({ ...rule, text: e.target.value })}
            placeholder={t('editor.remove.placeholder')}
          />
          <Checkbox
            checked={rule.matchCase}
            onCheckedChange={(checked) => onChange({ ...rule, matchCase: checked === true })}
            label={t('editor.match_case')}
          />
        </div>
      );

    case 'sequence_insert':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            value={rule.position}
            onValueChange={(value) => onChange({ ...rule, position: value as typeof rule.position })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prefix">{t('editor.position.prefix')}</SelectItem>
              <SelectItem value="suffix">{t('editor.position.suffix')}</SelectItem>
              <SelectItem value="before_extension">{t('editor.position.before_extension')}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={rule.separator}
            onChange={(e) => onChange({ ...rule, separator: e.target.value })}
            placeholder={t('editor.separator.placeholder')}
          />
          <Input
            type="number"
            value={rule.start}
            onChange={(e) => onChange({ ...rule, start: Number(e.target.value) })}
            placeholder={t('editor.start.placeholder')}
          />
          <Input
            type="number"
            value={rule.step}
            onChange={(e) => onChange({ ...rule, step: Number(e.target.value) })}
            placeholder={t('editor.step.placeholder')}
          />
          <Input
            type="number"
            value={rule.padWidth}
            onChange={(e) => onChange({ ...rule, padWidth: Number(e.target.value) })}
            placeholder={t('editor.pad.placeholder')}
          />
        </div>
      );

    case 'letter_sequence_insert':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            value={rule.position}
            onValueChange={(value) => onChange({ ...rule, position: value as typeof rule.position })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prefix">{t('editor.position.prefix')}</SelectItem>
              <SelectItem value="suffix">{t('editor.position.suffix')}</SelectItem>
              <SelectItem value="before_extension">{t('editor.position.before_extension')}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={rule.casing}
            onValueChange={(value) => onChange({ ...rule, casing: value as typeof rule.casing })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="upper">{t('editor.letter_case.upper')}</SelectItem>
              <SelectItem value="lower">{t('editor.letter_case.lower')}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={rule.separator}
            onChange={(e) => onChange({ ...rule, separator: e.target.value })}
            placeholder={t('editor.separator.placeholder')}
          />
          <Input
            type="number"
            min={1}
            value={rule.start}
            onChange={(e) => onChange({ ...rule, start: Math.max(1, Number(e.target.value) || 1) })}
            placeholder={t('editor.start.placeholder')}
          />
          <Input
            type="number"
            min={1}
            value={rule.step}
            onChange={(e) => onChange({ ...rule, step: Math.max(1, Number(e.target.value) || 1) })}
            placeholder={t('editor.step.placeholder')}
          />
        </div>
      );

    case 'date_time':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            value={rule.position}
            onValueChange={(value) => onChange({ ...rule, position: value as typeof rule.position })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prefix">{t('editor.position.prefix')}</SelectItem>
              <SelectItem value="suffix">{t('editor.position.suffix')}</SelectItem>
              <SelectItem value="before_extension">{t('editor.position.before_extension')}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={rule.format}
            onChange={(e) => onChange({ ...rule, format: e.target.value })}
            placeholder={t('editor.date_format.placeholder')}
          />
          <Input
            value={rule.separator}
            onChange={(e) => onChange({ ...rule, separator: e.target.value })}
            placeholder={t('editor.separator.placeholder')}
          />
        </div>
      );

    case 'extension_handling':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            value={rule.mode}
            onValueChange={(value) => onChange({ ...rule, mode: value as typeof rule.mode })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="keep">{t('editor.extension.keep')}</SelectItem>
              <SelectItem value="lowercase">{t('editor.extension.lowercase')}</SelectItem>
              <SelectItem value="uppercase">{t('editor.extension.uppercase')}</SelectItem>
              <SelectItem value="replace">{t('editor.extension.replace')}</SelectItem>
              <SelectItem value="remove">{t('editor.extension.remove')}</SelectItem>
            </SelectContent>
          </Select>
          {rule.mode === 'replace' && (
            <Input
              value={rule.replacement}
              onChange={(e) => onChange({ ...rule, replacement: e.target.value })}
              placeholder="jpg"
            />
          )}
        </div>
      );
  }
}
