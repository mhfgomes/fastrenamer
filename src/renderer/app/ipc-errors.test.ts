import { describe, expect, it } from 'vitest';
import { getErrorMessage, isPreviewSupersededError } from './ipc-errors';

describe('getErrorMessage', () => {
  it('strips the Electron remote-method prefix and the error name', () => {
    const error = new Error(
      "Error invoking remote method 'executeRenameBatch': OperationBusyError: Another undo is still running.",
    );
    expect(getErrorMessage(error)).toBe('Another undo is still running.');
  });

  it('keeps plain messages and falls back when empty', () => {
    expect(getErrorMessage(new Error('Disk full'))).toBe('Disk full');
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});

describe('isPreviewSupersededError', () => {
  it('recognises superseded previews', () => {
    expect(
      isPreviewSupersededError(
        new Error("Error invoking remote method 'generatePreview': PreviewSupersededError: Preview was superseded by a newer request."),
      ),
    ).toBe(true);
    expect(isPreviewSupersededError(new Error('Preview timed out'))).toBe(false);
  });
});
