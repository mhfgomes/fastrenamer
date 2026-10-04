const REMOTE_PREFIX = /^Error invoking remote method '[^']+':\s*/;
const ERROR_NAME_PREFIX = /^(?:[A-Z]\w*)?Error:\s*/;

/**
 * Errors thrown in the main process reach the renderer as
 * `Error invoking remote method 'x': SomeError: message`. Strip the transport noise.
 */
/** `fallback` must be a localized message; it is shown when the error carries no text. */
export function getErrorMessage(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = raw.replace(REMOTE_PREFIX, '').replace(ERROR_NAME_PREFIX, '').trim();
  return message || fallback;
}

/** A newer preview request replaced this one (PreviewSupersededError / WorkerTaskAbortedError). */
export function isPreviewSupersededError(error: unknown) {
  const raw = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return (
    raw.includes('PreviewSupersededError') ||
    raw.includes('WorkerTaskAbortedError') ||
    raw.includes('superseded by a newer request') ||
    raw.includes('a newer request replaced it')
  );
}
