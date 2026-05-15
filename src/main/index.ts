import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
  WebContents
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

const DEFAULT_HOME = 'https://www.bilibili.com'
const MINI_WIDTH = 480
const MINI_HEIGHT = 300

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let isMiniMode = false
let previousWindowState: {
  bounds: Electron.Rectangle
  maximized: boolean
} | null = null

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, ...args)
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function isCloseTabShortcut(input: Electron.Input): boolean {
  return (
    input.type === 'keyDown' &&
    input.control &&
    !input.alt &&
    !input.meta &&
    !input.shift &&
    input.key.toLowerCase() === 'w'
  )
}

function createTray(): void {
  if (tray) return

  const trayIcon = nativeImage.createFromPath(icon)
  tray = new Tray(trayIcon)
  tray.setToolTip('MiniSurf')

  const showWindow = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (isMiniMode) toggleMiniMode()
    mainWindow.show()
    mainWindow.focus()
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示窗口', click: showWindow },
      {
        label: '恢复普通模式',
        click: () => {
          if (isMiniMode) toggleMiniMode()
          showWindow()
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', showWindow)
}

function toggleMiniMode(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  if (!isMiniMode) {
    previousWindowState = {
      bounds: mainWindow.getBounds(),
      maximized: mainWindow.isMaximized()
    }

    if (previousWindowState.maximized) mainWindow.unmaximize()

    const display = screen.getDisplayMatching(mainWindow.getBounds())
    const { x, y, height } = display.workArea

    mainWindow.setResizable(false)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.setBounds({
      x,
      y: y + height - MINI_HEIGHT,
      width: MINI_WIDTH,
      height: MINI_HEIGHT
    })
    mainWindow.setIgnoreMouseEvents(true, { forward: true })
    mainWindow.show()
    isMiniMode = true
  } else {
    mainWindow.setIgnoreMouseEvents(false)
    mainWindow.setAlwaysOnTop(false)
    mainWindow.setResizable(true)

    if (previousWindowState) {
      mainWindow.setBounds(previousWindowState.bounds)
      if (previousWindowState.maximized) mainWindow.maximize()
    }

    mainWindow.show()
    mainWindow.focus()
    isMiniMode = false
  }

  sendToRenderer('window:mini-mode-changed', isMiniMode)
}

function updateMaximizedState(): void {
  sendToRenderer('window:maximized-changed', mainWindow?.isMaximized() ?? false)
}

function attachWebContentsHandlers(webContents: WebContents): void {
  webContents.on('before-input-event', (event, input) => {
    if (!isCloseTabShortcut(input)) return

    event.preventDefault()
    sendToRenderer('tabs:close-active')
  })

  webContents.setWindowOpenHandler((details) => {
    if (isWebUrl(details.url)) {
      sendToRenderer('tabs:open-url', details.url)
    } else {
      shell.openExternal(details.url)
    }

    return { action: 'deny' }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 780,
    minHeight: 460,
    show: false,
    frame: false,
    title: 'MiniSurf',
    autoHideMenuBar: true,
    backgroundColor: '#080b12',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('maximize', updateMaximizedState)
  mainWindow.on('unmaximize', updateMaximizedState)
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow?.hide()
  })

  attachWebContentsHandlers(mainWindow.webContents)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.minisurf.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('web-contents-created', (_, contents) => {
    attachWebContentsHandlers(contents)
  })

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:show', () => {
    if (isMiniMode) toggleMiniMode()
    mainWindow?.show()
    mainWindow?.focus()
  })
  ipcMain.handle('window:toggle-mini-mode', () => toggleMiniMode())
  ipcMain.handle('app:get-default-home', () => DEFAULT_HOME)

  createTray()
  createWindow()

  globalShortcut.register('Alt+1', () => {
    sendToRenderer('media:toggle-active-video')
  })

  globalShortcut.register('Alt+2', () => {
    toggleMiniMode()
  })

  globalShortcut.register('Alt+3', () => {
    sendToRenderer('media:fullscreen-active-video')
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  if (isQuitting) app.quit()
})
