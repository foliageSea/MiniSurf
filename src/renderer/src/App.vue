<script setup lang="ts">
import {
  ArrowLeft,
  ArrowRight,
  Globe2,
  Loader2,
  MousePointer2,
  PanelBottomClose,
  Plus,
  RefreshCw,
  X
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

type BrowserTab = {
  id: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

type PersistedState = {
  activeTabId: string
  tabs: Pick<BrowserTab, 'id' | 'url' | 'title'>[]
}

type WebviewElement = HTMLElement & {
  src: string
  getURL: () => string
  getTitle: () => string
  canGoBack: () => boolean
  canGoForward: () => boolean
  goBack: () => void
  goForward: () => void
  reload: () => void
  executeJavaScript: <T = unknown>(code: string) => Promise<T>
}

const STORAGE_KEY = 'minisurf.tabs'
const THEME_COLOR_KEY = 'minisurf.themeColor'
const DEFAULT_THEME_COLOR = '#38bdf8'

const tabs = reactive<BrowserTab[]>([])
const activeTabId = ref('')
const addressValue = ref('')
const defaultHome = ref('https://www.bilibili.com')
const themeColor = ref(DEFAULT_THEME_COLOR)
const isMaximized = ref(false)
const isMiniMode = ref(false)
const webviews = new Map<string, WebviewElement>()
const cleanupCallbacks: Array<() => void> = []

const activeTab = computed(() => tabs.find((tab) => tab.id === activeTabId.value) ?? tabs[0])

function createId(): string {
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function hexToHsl(value: string): string | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value)
  if (!match) return null

  const red = parseInt(match[1], 16) / 255
  const green = parseInt(match[2], 16) / 255
  const blue = parseInt(match[3], 16) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  let hue = 0
  let saturation = 0

  if (max !== min) {
    const delta = max - min
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    switch (max) {
      case red:
        hue = (green - blue) / delta + (green < blue ? 6 : 0)
        break
      case green:
        hue = (blue - red) / delta + 2
        break
      default:
        hue = (red - green) / delta + 4
    }
    hue /= 6
  }

  return `${Math.round(hue * 360)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`
}

function applyThemeColor(value: string): void {
  const hsl = hexToHsl(value)
  if (!hsl) return

  themeColor.value = value.startsWith('#') ? value : `#${value}`
  document.documentElement.style.setProperty('--primary', hsl)
  document.documentElement.style.setProperty('--ring', hsl)
  document.documentElement.style.setProperty('--accent', hsl)
  localStorage.setItem(THEME_COLOR_KEY, themeColor.value)
}

function loadThemeColor(): void {
  applyThemeColor(localStorage.getItem(THEME_COLOR_KEY) || DEFAULT_THEME_COLOR)
}

function handleThemeColorInput(event: Event): void {
  applyThemeColor((event.target as HTMLInputElement).value)
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return defaultHome.value

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  if (trimmed.includes('.') && !trimmed.includes(' ')) return `https://${trimmed}`
  return `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`
}

function saveTabs(): void {
  const payload: PersistedState = {
    activeTabId: activeTabId.value,
    tabs: tabs.map(({ id, url, title }) => ({ id, url, title }))
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

function loadPersistedTabs(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return false

  try {
    const parsed = JSON.parse(raw) as PersistedState
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return false

    tabs.splice(
      0,
      tabs.length,
      ...parsed.tabs.map((tab) => ({
        id: tab.id || createId(),
        url: tab.url || defaultHome.value,
        title: tab.title || '新标签页',
        loading: false,
        canGoBack: false,
        canGoForward: false
      }))
    )
    activeTabId.value = tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : tabs[0].id
    return true
  } catch {
    return false
  }
}

function openTab(url = defaultHome.value, activate = true): BrowserTab {
  const tab: BrowserTab = {
    id: createId(),
    url,
    title: '新标签页',
    loading: false,
    canGoBack: false,
    canGoForward: false
  }

  tabs.push(tab)
  if (activate) activeTabId.value = tab.id
  saveTabs()
  return tab
}

function closeTab(id: string): void {
  if (tabs.length === 1) {
    const tab = tabs[0]
    tab.url = defaultHome.value
    tab.title = '新标签页'
    tab.loading = false
    tab.canGoBack = false
    tab.canGoForward = false
    const webview = webviews.get(tab.id)
    if (webview) webview.src = defaultHome.value
    saveTabs()
    return
  }

  const index = tabs.findIndex((tab) => tab.id === id)
  if (index === -1) return

  tabs.splice(index, 1)
  webviews.delete(id)

  if (activeTabId.value === id) {
    activeTabId.value = tabs[Math.max(0, index - 1)]?.id ?? tabs[0].id
  }
  saveTabs()
}

function setActiveTab(id: string): void {
  activeTabId.value = id
  saveTabs()
}

function getActiveWebview(): WebviewElement | undefined {
  return activeTabId.value ? webviews.get(activeTabId.value) : undefined
}

function updateNavigationState(tab: BrowserTab, webview: WebviewElement): void {
  tab.canGoBack = webview.canGoBack()
  tab.canGoForward = webview.canGoForward()
  const url = webview.getURL()
  if (url) tab.url = url
  const title = webview.getTitle()
  if (title) tab.title = title
  saveTabs()
}

function applyWebviewScrollbarTheme(webview: WebviewElement): void {
  void webview
    .executeJavaScript(`
      (() => {
        const styleId = 'minisurf-scrollbar-theme';
        const existing = document.getElementById(styleId);
        if (existing) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = \`
          :root {
            scrollbar-color: transparent transparent;
            scrollbar-width: thin;
          }

          :root.minisurf-scrolling,
          :root.minisurf-scrollbar-hover {
            scrollbar-color: rgba(148, 163, 184, 0.55) rgba(15, 23, 42, 0.18);
          }

          ::-webkit-scrollbar {
            width: 10px;
            height: 10px;
          }

          ::-webkit-scrollbar-track {
            background: transparent;
            transition: background 180ms ease;
          }

          :root.minisurf-scrolling ::-webkit-scrollbar-track,
          :root.minisurf-scrollbar-hover ::-webkit-scrollbar-track {
            background: rgba(15, 23, 42, 0.16);
          }

          ::-webkit-scrollbar-thumb {
            min-height: 44px;
            border: 2px solid transparent;
            border-radius: 999px;
            background: transparent;
            background-clip: padding-box, border-box;
            transition: background 180ms ease;
          }

          :root.minisurf-scrolling ::-webkit-scrollbar-thumb,
          :root.minisurf-scrollbar-hover ::-webkit-scrollbar-thumb {
            background: linear-gradient(180deg, rgba(56, 189, 248, 0.72), rgba(139, 92, 246, 0.72)) border-box;
            background-clip: padding-box, border-box;
          }

          ::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(180deg, rgba(125, 211, 252, 0.92), rgba(167, 139, 250, 0.92)) border-box;
            background-clip: padding-box, border-box;
          }

          ::-webkit-scrollbar-corner {
            background: transparent;
          }
        \`;
        document.documentElement.appendChild(style);

        let scrollTimer;
        const root = document.documentElement;
        const showScrollbar = () => {
          root.classList.add('minisurf-scrolling');
          window.clearTimeout(scrollTimer);
          scrollTimer = window.setTimeout(() => {
            root.classList.remove('minisurf-scrolling');
          }, 900);
        };

        window.addEventListener('scroll', showScrollbar, { passive: true, capture: true });
        document.addEventListener('mouseover', (event) => {
          if (event.target === root || event.target === document.body) {
            root.classList.add('minisurf-scrollbar-hover');
          }
        });
        document.addEventListener('mouseout', (event) => {
          if (event.target === root || event.target === document.body) {
            root.classList.remove('minisurf-scrollbar-hover');
          }
        });
      })();
    `)
    .catch(() => {})
}

function bindWebview(el: Element | null, tab: BrowserTab): void {
  if (!el || webviews.has(tab.id)) return

  const webview = el as WebviewElement
  webviews.set(tab.id, webview)

  webview.addEventListener('did-start-loading', () => {
    tab.loading = true
  })
  webview.addEventListener('did-stop-loading', () => {
    tab.loading = false
    updateNavigationState(tab, webview)
    applyWebviewScrollbarTheme(webview)
  })
  webview.addEventListener('did-navigate', () => updateNavigationState(tab, webview))
  webview.addEventListener('did-navigate-in-page', () => updateNavigationState(tab, webview))
  webview.addEventListener('page-title-updated', (event) => {
    const title = (event as Event & { title?: string }).title
    if (title) tab.title = title
    saveTabs()
  })
}

function submitAddress(): void {
  const tab = activeTab.value
  if (!tab) return

  const url = normalizeUrl(addressValue.value)
  tab.url = url
  tab.loading = true
  const webview = webviews.get(tab.id)
  if (webview) webview.src = url
  saveTabs()
}

function goBack(): void {
  const webview = getActiveWebview()
  if (webview?.canGoBack()) webview.goBack()
}

function goForward(): void {
  const webview = getActiveWebview()
  if (webview?.canGoForward()) webview.goForward()
}

function reload(): void {
  getActiveWebview()?.reload()
}

function minimizeWindow(): void {
  window.api.minimizeWindow()
}

function toggleMaximizeWindow(): void {
  window.api.toggleMaximizeWindow()
}

function closeWindow(): void {
  window.api.closeWindow()
}

function toggleMiniMode(): void {
  window.api.toggleMiniMode()
}

function toggleActiveVideo(): void {
  getActiveWebview()?.executeJavaScript(`
    (() => {
      const video = document.querySelector('video');
      if (!video) return false;
      if (video.paused) video.play();
      else video.pause();
      return true;
    })();
  `)
}

function fullscreenActiveVideo(): void {
  getActiveWebview()?.executeJavaScript(`
    (() => {
      const selectors = [
        '[aria-label*="网页全屏"]',
        '[title*="网页全屏"]',
        '[data-title*="网页全屏"]',
        '.bpx-player-ctrl-web',
        '.bilibili-player-video-web-fullscreen',
        '.squirtle-video-webfullscreen'
      ];
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const control = selectors
        .flatMap((selector) => [...document.querySelectorAll(selector)])
        .find(isVisible);

      if (control) {
        control.click();
        return true;
      }

      const target = document.querySelector('.bpx-player-container, .bilibili-player, video') || document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'w',
        code: 'KeyW',
        bubbles: true,
        cancelable: true
      }));
      target.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'w',
        code: 'KeyW',
        bubbles: true,
        cancelable: true
      }));
      return true;
    })();
  `)
}

function handleNewTab(url?: string): void {
  openTab(url ? normalizeUrl(url) : defaultHome.value)
}

watch(
  () => activeTab.value?.url,
  (url) => {
    addressValue.value = url ?? ''
  },
  { immediate: true }
)

watch(activeTabId, () => {
  addressValue.value = activeTab.value?.url ?? ''
})

onMounted(async () => {
  loadThemeColor()
  defaultHome.value = await window.api.getDefaultHome()
  if (!loadPersistedTabs()) openTab(defaultHome.value)
  await nextTick()

  cleanupCallbacks.push(
    window.api.onWindowMaximizedChange((value) => {
      isMaximized.value = value
    }),
    window.api.onMiniModeChange((value) => {
      isMiniMode.value = value
    }),
    window.api.onToggleActiveVideo(toggleActiveVideo),
    window.api.onFullscreenActiveVideo(fullscreenActiveVideo),
    window.api.onOpenUrlInNewTab((url) => handleNewTab(url))
  )
})

onUnmounted(() => {
  cleanupCallbacks.forEach((cleanup) => cleanup())
})
</script>

<template>
  <main class="flex h-full w-full flex-col bg-background text-foreground">
    <header
      v-if="!isMiniMode"
      class="drag-region titlebar-glass relative flex h-11 shrink-0 items-center justify-center border-b border-border/70 shadow-[0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl"
    >
      <div class="pointer-events-none text-sm font-semibold tracking-wide">
        <span>MiniSurf</span>
      </div>

      <div class="no-drag absolute left-0 flex shrink-0 items-center gap-2 px-3">
        <button class="window-traffic-button window-traffic-close" title="最小化到托盘" @click="closeWindow" />
        <button class="window-traffic-button window-traffic-minimize" title="最小化" @click="minimizeWindow" />
        <button
          class="window-traffic-button window-traffic-maximize"
          :title="isMaximized ? '还原' : '最大化'"
          @click="toggleMaximizeWindow"
        />
      </div>
    </header>

    <section
      v-if="!isMiniMode"
      class="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3"
    >
      <button class="icon-button" :disabled="!activeTab?.canGoBack" title="后退" @click="goBack">
        <ArrowLeft class="h-4 w-4" />
      </button>
      <button
        class="icon-button"
        :disabled="!activeTab?.canGoForward"
        title="前进"
        @click="goForward"
      >
        <ArrowRight class="h-4 w-4" />
      </button>
      <button class="icon-button" title="刷新" @click="reload">
        <RefreshCw class="h-4 w-4" :class="activeTab?.loading ? 'animate-spin text-primary' : ''" />
      </button>

      <form class="flex min-w-0 flex-1" @submit.prevent="submitAddress">
        <input
          v-model="addressValue"
          class="browser-input"
          spellcheck="false"
          placeholder="输入网址或搜索内容"
        />
      </form>

      <button
        class="hidden items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-secondary hover:text-foreground sm:inline-flex"
        title="Alt+2 切换迷你模式"
        @click="toggleMiniMode"
      >
        <MousePointer2 v-if="isMiniMode" class="h-4 w-4 text-primary" />
        <PanelBottomClose v-else class="h-4 w-4" />
        {{ isMiniMode ? '穿透中' : '迷你' }}
      </button>

      <label
        class="no-drag flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-background/80 transition hover:bg-secondary"
        title="修改窗口主题色"
      >
        <span class="h-4 w-4 rounded-full border border-white/30" :style="{ backgroundColor: themeColor }" />
        <input class="sr-only" type="color" :value="themeColor" @input="handleThemeColorInput" />
      </label>
    </section>

    <section class="relative min-h-0 flex-1 overflow-hidden bg-[#050816]">
      <aside
        v-if="!isMiniMode"
        class="no-drag group absolute inset-y-0 left-0 z-30 flex w-64 -translate-x-[calc(100%-0.75rem)] transition-transform duration-200 ease-out hover:translate-x-0"
      >
        <div class="flex w-full flex-col border-r border-border bg-card/95 shadow-2xl backdrop-blur">
          <div class="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
            <span class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              标签页
            </span>
            <button class="icon-button" title="新建标签" @click="handleNewTab()">
              <Plus class="h-4 w-4" />
            </button>
          </div>

          <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2 pr-3">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="group/tab flex min-h-10 w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition"
              :class="
                tab.id === activeTabId
                  ? 'border-border bg-background text-foreground shadow-sm'
                  : 'border-transparent bg-secondary/35 text-muted-foreground hover:bg-secondary hover:text-foreground'
              "
              @click="setActiveTab(tab.id)"
            >
              <Loader2 v-if="tab.loading" class="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
              <Globe2 v-else class="h-3.5 w-3.5 shrink-0" />
              <span class="min-w-0 flex-1 truncate">{{ tab.title || '新标签页' }}</span>
              <span
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-60 hover:bg-muted hover:opacity-100"
                @click.stop="closeTab(tab.id)"
              >
                <X class="h-3.5 w-3.5" />
              </span>
            </button>
          </div>
        </div>
        <div class="w-3 bg-primary/35 transition group-hover:bg-transparent" />
      </aside>

      <webview
        v-for="tab in tabs"
        :key="tab.id"
        :ref="(el) => bindWebview(el as Element | null, tab)"
        class="absolute inset-0"
        :class="tab.id === activeTabId ? 'z-10 flex' : 'z-0 hidden'"
        :src="tab.url"
        allowpopups
      />
    </section>
  </main>
</template>
