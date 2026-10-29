// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { RenameRule } from '@fastrenamer/rename-engine';
import { I18nProvider } from '../../i18n';
import { FindReplaceRuleEditor } from './RulesPanel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('inserts quick-insert tokens into the replacement selection and restores the cursor', () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  function Editor() {
    const [rule, setRule] = useState<Extract<RenameRule, { type: 'find_replace' }>>({
      id: 'test', type: 'find_replace', enabled: true, find: 'photo', replace: 'before_old_after',
      matchCase: false, useRegex: false, replaceAll: true,
    });
    return createElement(FindReplaceRuleEditor, { rule, update: (patch) => setRule(current => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) })) });
  }
  render(createElement(I18nProvider, null, createElement(Editor)));
  const replacement = screen.getByDisplayValue('before_old_after') as HTMLInputElement;
  replacement.focus();
  replacement.setSelectionRange(7, 10);
  fireEvent.click(screen.getByRole('button', { name: /Sequence 0001/ }));
  frames.forEach(callback => callback(0));
  expect(replacement.value).toBe('before_{seq_num:0001}_after');
  expect(replacement.selectionStart).toBe(21);
  expect(document.activeElement).toBe(replacement);
  expect(screen.getByDisplayValue('photo')).toBeTruthy();
  expect(screen.getAllByRole('button')).toHaveLength(8);
});
