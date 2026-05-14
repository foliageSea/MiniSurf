import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  showWindow: (): Promise<void> => ipcRenderer.invoke('window:show'),
  toggleMiniMode: (): Promise<void> => ipcRenderer.invoke('window:toggle-mini-mode'),
  getDefaultHome: (): Promise<string> => ipcRenderer.invoke('app:get-default-home'),
  onWindowMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void =>
      callback(maximized)
    ipcRenderer.on('window:maximized-changed', listener)
    return () => ipcRenderer.removeListener('window:maximized-changed', listener)
  },
  onMiniModeChange: (callback: (enabled: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean): void =>
      callback(enabled)
    ipcRenderer.on('window:mini-mode-changed', listener)
    return () => ipcRenderer.removeListener('window:mini-mode-changed', listener)
  },
  onToggleActiveVideo: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('media:toggle-active-video', listener)
    return () => ipcRenderer.removeListener('media:toggle-active-video', listener)
  },
  onOpenUrlInNewTab: (callback: (url: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string): void => callback(url)
    ipcRenderer.on('tabs:open-url', listener)
    return () => ipcRenderer.removeListener('tabs:open-url', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
