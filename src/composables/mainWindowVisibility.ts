import type { Window } from '@tauri-apps/api/window';

import { setMainWindowRenderingSnapshot } from './renderingPower';

type MainWindowVisibilityTarget = Pick<
  Window,
  'isVisible' | 'isMinimized' | 'minimize' | 'show' | 'unminimize' | 'setFocus'
>;

export type MainWindowVisibilityAction = 'minimized' | 'restored';

export async function toggleMainWindowVisibility(
  mainWindow: MainWindowVisibilityTarget,
): Promise<MainWindowVisibilityAction> {
  const [visible, minimized] = await Promise.all([
    mainWindow.isVisible(),
    mainWindow.isMinimized(),
  ]);

  if (visible && !minimized) {
    if (/Linux/i.test(navigator.userAgent)) {
      await (mainWindow as unknown as { hide: () => Promise<void> }).hide();
    } else {
      await mainWindow.minimize();
    }
    setMainWindowRenderingSnapshot({
      windowFocused: false,
      windowVisible: true,
      windowMinimized: true,
    });
    return 'minimized';
  }

  await mainWindow.show();
  if (minimized) {
    await mainWindow.unminimize();
  }
  await mainWindow.setFocus();
  setMainWindowRenderingSnapshot({
    documentHidden: false,
    windowFocused: true,
    windowVisible: true,
    windowMinimized: false,
  });
  return 'restored';
}
