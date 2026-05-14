import { ElectronAPI } from '@electron-toolkit/preload'

export interface MiniSurfAPI {
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<boolean>
  closeWindow: () => Promise<void>
  showWindow: () => Promise<void>
  toggleMiniMode: () => Promise<void>
  getDefaultHome: () => Promise<string>
  onWindowMaximizedChange: (callback: (maximized: boolean) => void) => () => void
  onMiniModeChange: (callback: (enabled: boolean) => void) => () => void
  onToggleActiveVideo: (callback: () => void) => () => void
  onOpenUrlInNewTab: (callback: (url: string) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: MiniSurfAPI
  }
}
