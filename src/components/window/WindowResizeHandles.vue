<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window';

type ResizeDir = 'East' | 'North' | 'NorthEast' | 'NorthWest' | 'South' | 'SouthEast' | 'SouthWest' | 'West';

// 无边框窗口（decorated: false）在 Wayland/X11 下不会自动获得缩放手柄，
// 需要自己铺一层透明的边缘热区，悬停时显示缩放光标，按下后交给合成器拖拽。
const appWindow = getCurrentWindow();

const startResize = (event: PointerEvent, direction: ResizeDir) => {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  void appWindow.startResizeDragging(direction);
};
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-[70]">
    <!-- 四条边 -->
    <div
      class="pointer-events-auto absolute left-[10px] right-[10px] top-0 h-1.5 cursor-ns-resize"
      @pointerdown="startResize($event, 'North' as ResizeDir)"
    />
    <div
      class="pointer-events-auto absolute bottom-0 left-[10px] right-[10px] h-1.5 cursor-ns-resize"
      @pointerdown="startResize($event, 'South' as ResizeDir)"
    />
    <div
      class="pointer-events-auto absolute bottom-[10px] left-0 top-[10px] w-1.5 cursor-ew-resize"
      @pointerdown="startResize($event, 'West' as ResizeDir)"
    />
    <div
      class="pointer-events-auto absolute bottom-[10px] right-0 top-[10px] w-1.5 cursor-ew-resize"
      @pointerdown="startResize($event, 'East' as ResizeDir)"
    />

    <!-- 四个角 -->
    <div
      class="pointer-events-auto absolute left-0 top-0 h-[10px] w-[10px] cursor-nwse-resize"
      @pointerdown="startResize($event, 'NorthWest' as ResizeDir)"
    />
    <div
      class="pointer-events-auto absolute right-0 top-0 h-[10px] w-[10px] cursor-nesw-resize"
      @pointerdown="startResize($event, 'NorthEast' as ResizeDir)"
    />
    <div
      class="pointer-events-auto absolute bottom-0 left-0 h-[10px] w-[10px] cursor-nesw-resize"
      @pointerdown="startResize($event, 'SouthWest' as ResizeDir)"
    />
    <div
      class="pointer-events-auto absolute bottom-0 right-0 h-[10px] w-[10px] cursor-nwse-resize"
      @pointerdown="startResize($event, 'SouthEast' as ResizeDir)"
    />
  </div>
</template>
