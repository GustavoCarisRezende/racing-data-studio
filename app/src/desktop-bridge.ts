export const GITHUB_URL = 'https://github.com/GustavoCarisRezende/racing-data-studio';

export function isFullscreenShortcut(event: Pick<KeyboardEvent, 'key' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey'>) {
  return event.key === 'F11' && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey;
}

export async function runFullscreenToggle(
  busy: { current: boolean },
  invoke: () => Promise<unknown>,
  onError: () => void,
): Promise<boolean> {
  if (busy.current) return false;
  busy.current = true;
  try {
    await invoke();
    return true;
  } catch {
    onError();
    return false;
  } finally {
    busy.current = false;
  }
}

export async function openProject(inDesktop: boolean, invoke: (command: string) => Promise<unknown>, open: (url: string, target: string, features: string) => unknown) {
  if (inDesktop) return invoke('open_github');
  return open(GITHUB_URL, '_blank', 'noopener,noreferrer');
}
