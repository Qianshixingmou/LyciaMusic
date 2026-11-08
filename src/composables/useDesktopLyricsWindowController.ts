import { emitTo } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, availableMonitors, currentMonitor, cursorPosition } from '@tauri-apps/api/window';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { computed, onMounted, onUnmounted, ref, watch, type CSSProperties, type Ref } from 'vue';

import { loadSystemLyricsFonts } from './lyrics';
import {
  DESKTOP_LYRICS_BOUNDS_EVENT,
  DESKTOP_LYRICS_PLAYBACK_EVENT,
  DESKTOP_LYRICS_READY_EVENT,
  DESKTOP_LYRICS_REVEAL_SURFACE_EVENT,
  DESKTOP_LYRICS_REQUEST_STATE_EVENT,
  DESKTOP_LYRICS_STATE_EVENT,
  DESKTOP_LYRICS_VISIBILITY_EVENT,
  type DesktopLyricsPlaybackPayload,
  type DesktopLyricsStatePayload,
  type DesktopLyricsWindowBounds,
  type DesktopLyricsWindowSettings,
} from '../features/desktopLyrics/shared';
import { windowApi } from '../services/tauri/windowApi';

const FULLSCREEN_POLL_INTERVAL_MS = 300;
const RESIZE_VISIBILITY_HOLD_MS = 1200;

export function shouldAutoHideDesktopLyrics({
  autoHideWhenFullscreen,
  autoHideWhenPaused,
  isForegroundFullscreen,
  isPlaying,
  isResizeInteractionActive,
}: {
  autoHideWhenFullscreen: boolean;
  autoHideWhenPaused: boolean;
  isForegroundFullscreen: boolean;
  isPlaying: boolean;
  isResizeInteractionActive: boolean;
}) {
  if (isResizeInteractionActive) {
    return false;
  }

  return (autoHideWhenFullscreen && isForegroundFullscreen)
    || (autoHideWhenPaused && !isPlaying);
}

export function useDesktopLyricsWindowController(options: {
  showDragShadow: Ref<boolean>;
  settings: Ref<DesktopLyricsWindowSettings>;
  playbackTime: Ref<number>;
  isPlaying: Ref<boolean>;
  handlePayload: (payload: DesktopLyricsStatePayload) => void;
  handlePlaybackPayload: (payload: DesktopLyricsPlaybackPayload) => void;
}) {
  const {
    showDragShadow,
    settings,
    playbackTime,
    isPlaying,
    handlePayload,
    handlePlaybackPayload,
  } = options;

  const appWindow = getCurrentWindow();
  let isApplyingCenterPosition = false;
  let centerPositionFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let centerPositionDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function forceCenterHorizontally() {
    if (isApplyingCenterPosition) return;
    try {
      let monitor = await currentMonitor();
      if (!monitor) {
        const monitors = await availableMonitors();
        if (monitors.length > 0) {
          monitor = monitors[0];
        }
      }
      if (!monitor) return;

      const workArea = monitor.workArea;
      const size = await appWindow.outerSize();
      const position = await appWindow.outerPosition();
      const targetX = workArea.position.x + Math.round((workArea.size.width - size.width) / 2);

      if (Math.abs(position.x - targetX) > 1) {
        isApplyingCenterPosition = true;
        if (centerPositionFallbackTimer) {
          clearTimeout(centerPositionFallbackTimer);
        }
        centerPositionFallbackTimer = setTimeout(() => {
          isApplyingCenterPosition = false;
          centerPositionFallbackTimer = null;
        }, 300);

        try {
          await appWindow.setPosition(new PhysicalPosition(targetX, position.y));
        } catch (err) {
          console.warn('Failed to call setPosition:', err);
          isApplyingCenterPosition = false;
          if (centerPositionFallbackTimer) {
            clearTimeout(centerPositionFallbackTimer);
            centerPositionFallbackTimer = null;
          }
        }

        await emitWindowBounds({
          x: targetX,
          y: position.y,
          width: size.width,
          height: size.height,
        });
      }
    } catch (error) {
      console.warn('Failed to force center horizontally:', error);
      isApplyingCenterPosition = false;
      if (centerPositionFallbackTimer) {
        clearTimeout(centerPositionFallbackTimer);
        centerPositionFallbackTimer = null;
      }
    }
  }
  const isSystemHidden = ref(false);
  const isHoverDimmed = ref(false);
  const isToolbarVisible = ref(false);
  const isResizeInteractionActive = ref(false);
  const isCursorOverLockButton = ref(false);
  let lockPollingTimer: ReturnType<typeof setInterval> | null = null;

  const isAutoHidden = computed(() => shouldAutoHideDesktopLyrics({
    autoHideWhenFullscreen: settings.value.autoHideWhenFullscreen,
    autoHideWhenPaused: settings.value.autoHideWhenPaused,
    isForegroundFullscreen: isSystemHidden.value,
    isPlaying: isPlaying.value,
    isResizeInteractionActive: isResizeInteractionActive.value,
  }));

  let hoverDimTimer: ReturnType<typeof setTimeout> | null = null;
  let toolbarHideTimer: ReturnType<typeof setTimeout> | null = null;
  let autoHideTimer: ReturnType<typeof setInterval> | null = null;
  let resizeVisibilityTimer: ReturnType<typeof setTimeout> | null = null;
  let frameId = 0;
  let dragShadowTimer: ReturnType<typeof setTimeout> | null = null;
  let unlistenState: (() => void) | null = null;
  let unlistenPlayback: (() => void) | null = null;
  let unlistenRevealSurface: (() => void) | null = null;
  let unlistenCloseRequested: (() => void) | null = null;
  let unlistenMoved: (() => void) | null = null;
  let unlistenResized: (() => void) | null = null;

  function startPlaybackClock() {
    stopPlaybackClock();

    let lastTime = performance.now();
    const tick = (now: number) => {
      if (isPlaying.value) {
        playbackTime.value += (now - lastTime) / 1000;
      }

      lastTime = now;
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
  }

  function stopPlaybackClock() {
    if (frameId !== 0) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
  }

  function startAutoHideLoop() {
    stopAutoHideLoop();

    const pollForegroundFullscreen = async () => {
      if (isResizeInteractionActive.value) {
        isSystemHidden.value = false;
        return;
      }

      if (!settings.value.autoHideWhenFullscreen) {
        isSystemHidden.value = false;
        return;
      }

      try {
        const state = await windowApi.getForegroundFullscreenState();
        isSystemHidden.value = state.isFullscreen;
      } catch {
        isSystemHidden.value = false;
      }
    };

    autoHideTimer = setInterval(async () => {
      await pollForegroundFullscreen();
    }, FULLSCREEN_POLL_INTERVAL_MS);

    void pollForegroundFullscreen();
  }

  function stopAutoHideLoop() {
    if (autoHideTimer) {
      clearInterval(autoHideTimer);
      autoHideTimer = null;
    }
  }

  // 统一的窗口状态校正：锁定/穿透/工具栏可见性都在这里计算，
  // 设置面板、窗口上的锁按钮、启动恢复走的是同一套逻辑。
  async function checkLockCursorProximity() {
    if (!settings.value.isLocked) {
      if (isCursorOverLockButton.value) isCursorOverLockButton.value = false;
      if (isToolbarVisible.value && !isAutoHidden.value) isToolbarVisible.value = true;
      return;
    }

    try {
      const position = await cursorPosition();
      const winPos = await appWindow.outerPosition();
      const size = await appWindow.outerSize();
      const scaleFactor = await appWindow.scaleFactor();

      // Wayland 下 outerPosition() 恒为 (0,0)，基于窗口坐标的“鼠标是否悬停锁图标”不可靠。
      // 这种情况下不做悬停例外，保持穿透（解锁请到设置里关闭）。
      const positionUnavailable = winPos.x === 0 && winPos.y === 0;

      let isOver = false;
      if (!positionUnavailable) {
        const x = position.x - winPos.x;
        const y = position.y - winPos.y;
        const toleranceY = 48 * scaleFactor;
        const toleranceX = 28 * scaleFactor;
        const centerX = size.width / 2;
        isOver = y >= 0 && y <= toleranceY && x >= centerX - toleranceX && x <= centerX + toleranceX;
      }

      isToolbarVisible.value = isOver;
      isCursorOverLockButton.value = isOver;
    } catch (err) {
      console.warn('Failed to check cursor proximity:', err);
    }
  }

  let reconcileTicks = 0;

  async function reconcileDesktopWindowState() {
    await checkLockCursorProximity();
    reconcileTicks += 1;
    const desiredIgnore = (settings.value.isLocked && !isCursorOverLockButton.value) || isAutoHidden.value;

    // 锁定期间定期重申穿透状态：GTK/Wayland 下首次设置有时不生效，
    // 只在“状态变化时调用”会导致切换一次后穿透丢失。
    const shouldReassert = desiredIgnore && reconcileTicks % 5 === 0;
    if (desiredIgnore !== lastAppliedIgnoreCursor || shouldReassert) {
      await applyTransientWindowFlags();
    }
  }

  function startLockPolling() {
    stopLockPolling();
    lockPollingTimer = setInterval(() => {
      void reconcileDesktopWindowState();
    }, 100);
  }

  function stopLockPolling() {
    if (lockPollingTimer) {
      clearInterval(lockPollingTimer);
      lockPollingTimer = null;
    }
  }

  // 记录最近一次成功应用的穿透状态，供轮询校正
  let lastAppliedIgnoreCursor: boolean | null = null;

  async function applyTransientWindowFlags() {
    // 修复：窗口尚未显示（GTK 窗口还未 realize）时调用 setIgnoreCursorEvents，
    // tao 会在 window.window().unwrap() 处 panic 导致整个应用崩溃。
    try {
      if (!(await appWindow.isVisible())) {
        return;
      }
    } catch {
      return;
    }
    const shouldIgnoreCursor = (settings.value.isLocked && !isCursorOverLockButton.value) || isAutoHidden.value;
    try {
      await appWindow.setIgnoreCursorEvents(shouldIgnoreCursor);
      await appWindow.setFocusable(!shouldIgnoreCursor);
      lastAppliedIgnoreCursor = shouldIgnoreCursor;
      // Wayland 下 GTK 的 input region 在切换后可能失效，交给 KWin 直接关闭输入接收
      await invoke('set_lyrics_ignore_input', { enabled: shouldIgnoreCursor });
    } catch (err) {
      console.warn('Failed to apply desktop lyrics window flags:', err);
    }
  }

  async function applyAlwaysOnTopState(enabled: boolean) {
    await appWindow.setAlwaysOnTop(enabled);
    await windowApi.refreshCurrentWindowTopmost(enabled);

    if (enabled) {
      await windowApi.startTopmostGuard();
      return;
    }

    await windowApi.stopTopmostGuard();
  }

  function clearHoverDimTimer() {
    if (hoverDimTimer) {
      clearTimeout(hoverDimTimer);
      hoverDimTimer = null;
    }
  }

  function clearToolbarHideTimer() {
    if (toolbarHideTimer) {
      clearTimeout(toolbarHideTimer);
      toolbarHideTimer = null;
    }
  }

  function clearResizeVisibilityTimer() {
    if (resizeVisibilityTimer) {
      clearTimeout(resizeVisibilityTimer);
      resizeVisibilityTimer = null;
    }
  }

  function holdVisibleForResize() {
    clearResizeVisibilityTimer();
    clearHoverDimTimer();
    clearToolbarHideTimer();

    isResizeInteractionActive.value = true;
    isSystemHidden.value = false;
    isHoverDimmed.value = false;
    revealToolbar();
    // 注意：这里不再显示“拖动阴影背景”。
    // 合成器重新映射/调整窗口时也会触发 Resized 事件，
    // 会让本来关闭的阴影背景莫名闪现。

    resizeVisibilityTimer = setTimeout(() => {
      isResizeInteractionActive.value = false;
      resizeVisibilityTimer = null;
    }, RESIZE_VISIBILITY_HOLD_MS);
  }

  function revealToolbar() {
    clearToolbarHideTimer();

    if (settings.value.isLocked || isAutoHidden.value) {
      isToolbarVisible.value = false;
      return;
    }

    isToolbarVisible.value = true;
  }

  function hideToolbar(delay = 140) {
    clearToolbarHideTimer();

    toolbarHideTimer = setTimeout(() => {
      isToolbarVisible.value = false;
      toolbarHideTimer = null;
    }, delay);
  }

  function revealDragShadow() {
    showDragShadow.value = true;

    if (dragShadowTimer) {
      clearTimeout(dragShadowTimer);
    }

    dragShadowTimer = setTimeout(() => {
      showDragShadow.value = false;
      dragShadowTimer = null;
    }, 1500);
  }

  function queueHoverDim() {
    clearHoverDimTimer();

    if (settings.value.isLocked || isAutoHidden.value || isResizeInteractionActive.value) {
      return;
    }

    hoverDimTimer = setTimeout(() => {
      isHoverDimmed.value = true;
    }, 850);
  }

  function handlePointerEnter() {
    if (settings.value.isLocked) {
      return;
    }
    revealToolbar();
    isHoverDimmed.value = false;
    queueHoverDim();
  }

  function handlePointerMove() {
    if (settings.value.isLocked) {
      return;
    }

    revealToolbar();
    isHoverDimmed.value = false;
    queueHoverDim();
  }

  function handlePointerLeave() {
    if (settings.value.isLocked) {
      return;
    }
    clearHoverDimTimer();
    isHoverDimmed.value = false;

    if (isResizeInteractionActive.value) {
      return;
    }

    hideToolbar();
  }

  // 用户手动拖动后，不再强行水平居中：拖动即代表想要的位置
  let userDraggingWindow = false;

  async function startWindowDrag(event: MouseEvent) {
    if (settings.value.isLocked || isAutoHidden.value) return;
    if ((event.target as HTMLElement).closest('button, .settings-menu')) return;

    revealDragShadow();
    userDraggingWindow = true;
    // 拖动结束（松手）立刻恢复透明背景，不依赖合成器事件
    window.addEventListener(
      'pointerup',
      () => {
        showDragShadow.value = false;
      },
      { once: true },
    );
    await appWindow.startDragging();
  }

  async function emitWindowBounds(bounds: DesktopLyricsWindowBounds) {
    await emitTo<DesktopLyricsWindowBounds>('main', DESKTOP_LYRICS_BOUNDS_EVENT, bounds);
  }

  const widgetShellStyle = computed<CSSProperties>(() => ({
    opacity: isAutoHidden.value ? '0' : (isHoverDimmed.value ? '0.34' : '1'),
    transform: isAutoHidden.value ? 'scale(0.96)' : 'scale(1)',
    pointerEvents: isAutoHidden.value ? 'none' : 'auto',
  }));

  onMounted(async () => {
    startPlaybackClock();
    startAutoHideLoop();
    startLockPolling();
    void loadSystemLyricsFonts();

    try {
      await appWindow.setBackgroundColor([0, 0, 0, 0]);
    } catch (error) {
      console.warn('Failed to force transparent background for desktop lyrics window:', error);
    }

    // 窗口创建时是隐藏的，applyTransientWindowFlags 在 isVisible() 为 false 时会直接返回，
    // 导致“锁定 = 鼠标穿透”在窗口刚出现时不生效。等它真正可见后补一次。
    let flagProbeAttempts = 0;
    const flagProbe = setInterval(async () => {
      flagProbeAttempts += 1;
      try {
        if (await appWindow.isVisible()) {
          clearInterval(flagProbe);
          await applyTransientWindowFlags();
        }
      } catch {
        clearInterval(flagProbe);
      }
      if (flagProbeAttempts > 60) {
        clearInterval(flagProbe);
      }
    }, 120);

    unlistenState = await appWindow.listen<DesktopLyricsStatePayload>(DESKTOP_LYRICS_STATE_EVENT, (event) => {
      handlePayload(event.payload);
    });

    unlistenPlayback = await appWindow.listen<DesktopLyricsPlaybackPayload>(DESKTOP_LYRICS_PLAYBACK_EVENT, (event) => {
      handlePlaybackPayload(event.payload);
    });

    unlistenRevealSurface = await appWindow.listen(DESKTOP_LYRICS_REVEAL_SURFACE_EVENT, () => {
      // 仅用于刷新窗口表面，不显示拖动阴影背景
    });

    unlistenCloseRequested = await appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await appWindow.hide();
      await emitTo('main', DESKTOP_LYRICS_VISIBILITY_EVENT, { visible: false });
    });

    unlistenMoved = await appWindow.onMoved(async ({ payload }) => {
      // 只有用户手动拖动时才显示阴影；KWin 因“显示桌面/切换工作区”重新摆放窗口
      // 也会触发 Moved，不应让关闭的阴影背景冒出来
      if (userDraggingWindow) {
        revealDragShadow();
      }

      if (isApplyingCenterPosition) {
        isApplyingCenterPosition = false;
        if (centerPositionFallbackTimer) {
          clearTimeout(centerPositionFallbackTimer);
          centerPositionFallbackTimer = null;
        }
        const size = await appWindow.outerSize();
        await emitWindowBounds({
          x: payload.x,
          y: payload.y,
          width: size.width,
          height: size.height,
        });
        return;
      }

      const size = await appWindow.outerSize();
      const x = payload.x;

      if (userDraggingWindow) {
        // 用户拖动结束：记住这个位置，并关掉“水平居中”，否则下次打开会被拉回正中
        userDraggingWindow = false;
        if (settings.value.centerHorizontally) {
          settings.value.centerHorizontally = false;
        }
      } else if (settings.value.centerHorizontally) {
        if (centerPositionDebounceTimer) {
          clearTimeout(centerPositionDebounceTimer);
        }
        centerPositionDebounceTimer = setTimeout(async () => {
          centerPositionDebounceTimer = null;
          await forceCenterHorizontally();
        }, 300);
      }

      await emitWindowBounds({
        x,
        y: payload.y,
        width: size.width,
        height: size.height,
      });
    });

    unlistenResized = await appWindow.onResized(async ({ payload }) => {
      holdVisibleForResize();

      if (isApplyingCenterPosition) {
        isApplyingCenterPosition = false;
        if (centerPositionFallbackTimer) {
          clearTimeout(centerPositionFallbackTimer);
          centerPositionFallbackTimer = null;
        }
        const position = await appWindow.outerPosition();
        await emitWindowBounds({
          x: position.x,
          y: position.y,
          width: payload.width,
          height: payload.height,
        });
        return;
      }

      const position = await appWindow.outerPosition();
      let x = position.x;

      if (settings.value.centerHorizontally) {
        if (centerPositionDebounceTimer) {
          clearTimeout(centerPositionDebounceTimer);
        }
        centerPositionDebounceTimer = setTimeout(async () => {
          centerPositionDebounceTimer = null;
          await forceCenterHorizontally();
        }, 300);
      }

      await emitWindowBounds({
        x,
        y: position.y,
        width: payload.width,
        height: payload.height,
      });
    });

    try {
      await emitTo('main', DESKTOP_LYRICS_READY_EVENT);
      await emitTo('main', DESKTOP_LYRICS_REQUEST_STATE_EVENT);
    } catch (error) {
      console.warn('Failed to notify main window that desktop lyrics is ready:', error);
    }
  });

  onUnmounted(() => {
    stopLockPolling();
    stopPlaybackClock();
    stopAutoHideLoop();
    clearHoverDimTimer();
    clearToolbarHideTimer();
    clearResizeVisibilityTimer();
    unlistenState?.();
    unlistenPlayback?.();
    unlistenRevealSurface?.();
    unlistenCloseRequested?.();
    unlistenMoved?.();
    unlistenResized?.();
    void windowApi.stopTopmostGuard();

    if (centerPositionFallbackTimer) {
      clearTimeout(centerPositionFallbackTimer);
      centerPositionFallbackTimer = null;
    }

    if (centerPositionDebounceTimer) {
      clearTimeout(centerPositionDebounceTimer);
      centerPositionDebounceTimer = null;
    }

    if (dragShadowTimer) {
      clearTimeout(dragShadowTimer);
      dragShadowTimer = null;
    }
  });

  watch(
    () => [settings.value.isLocked, isAutoHidden.value],
    () => {
      if (settings.value.isLocked) {
        clearToolbarHideTimer();
        clearHoverDimTimer();
        isHoverDimmed.value = false;
        isToolbarVisible.value = false;
      } else {
        isToolbarVisible.value = false;
      }
      void reconcileDesktopWindowState();
    },
    { immediate: true },
  );

  watch(
    () => settings.value.autoHideWhenFullscreen,
    (enabled) => {
      if (!enabled) {
        isSystemHidden.value = false;
      }
    },
  );

  watch(
    () => settings.value.isAlwaysOnTop,
    (enabled) => {
      void applyAlwaysOnTopState(enabled);
    },
    { immediate: true },
  );

  watch(
    () => settings.value.centerHorizontally,
    (enabled) => {
      if (enabled) {
        void forceCenterHorizontally();
      }
    },
  );

  return {
    showDragShadow,
    isSystemHidden,
    isToolbarVisible,
    isCursorOverLockButton,
    widgetShellStyle,
    handlePointerEnter,
    handlePointerMove,
    handlePointerLeave,
    startWindowDrag,
  };
}
