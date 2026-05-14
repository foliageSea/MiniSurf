<script setup lang="ts">
import {
  ArrowLeft,
  ArrowRight,
  Globe2,
  Loader2,
  Maximize2,
  Minus,
  MousePointer2,
  PanelBottomClose,
  Plus,
  RefreshCw,
  Square,
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

const tabs = reactive<BrowserTab[]>([])
const activeTabId = ref('')
const addressValue = ref('')
const defaultHome = ref('https://www.bilibili.com')
const isMaximized = ref(false)
const isMiniMode = ref(false)
const webviews = new Map<string, WebviewElement>()
const cleanupCallbacks: Array<() => void> = []

const activeTab = computed(() => tabs.find((tab) => tab.id === activeTabId.value) ?? tabs[0])

function createId(): string {
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`
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
      class="drag-region flex h-11 shrink-0 items-center border-b border-border bg-card/95 shadow-[0_1px_0_rgba(255,255,255,0.03)]"
    >
      <div class="flex w-44 items-center gap-2 px-3 text-sm font-semibold tracking-wide">
        <div
          class="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground"
        >
          <Globe2 class="h-4 w-4" />
        </div>
        <span>MiniSurf</span>
      </div>

      <div class="no-drag flex min-w-0 flex-1 items-end gap-1 self-end overflow-hidden px-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="group flex h-9 min-w-28 max-w-56 flex-1 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-left text-xs transition"
          :class="
            tab.id === activeTabId
              ? 'border-border bg-background text-foreground'
              : 'border-transparent bg-secondary/45 text-muted-foreground hover:bg-secondary hover:text-foreground'
          "
          @click="setActiveTab(tab.id)"
        >
          <Loader2 v-if="tab.loading" class="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          <Globe2 v-else class="h-3.5 w-3.5 shrink-0" />
          <span class="min-w-0 flex-1 truncate">{{ tab.title || '新标签页' }}</span>
          <span
            class="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-muted"
            @click.stop="closeTab(tab.id)"
          >
            <X class="h-3.5 w-3.5" />
          </span>
        </button>
        <button class="icon-button mb-1 shrink-0" title="新建标签" @click="handleNewTab()">
          <Plus class="h-4 w-4" />
        </button>
      </div>

      <div class="no-drag ml-2 flex shrink-0 items-center">
        <button class="window-button" title="最小化" @click="minimizeWindow">
          <Minus class="h-4 w-4" />
        </button>
        <button class="window-button" title="最大化/还原" @click="toggleMaximizeWindow">
          <Square v-if="isMaximized" class="h-3.5 w-3.5" />
          <Maximize2 v-else class="h-4 w-4" />
        </button>
        <button class="window-button-danger" title="最小化到托盘" @click="closeWindow">
          <X class="h-4 w-4" />
        </button>
      </div>
    </header>

    <section
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
    </section>

    <section class="relative min-h-0 flex-1 bg-[#050816]">
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
