import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
  WebContents,
  webContents
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

const DEFAULT_HOME = 'https://www.bilibili.com'
const MINI_WIDTH = 480
const MINI_HEIGHT = 300

type MiniModePosition = 'left' | 'right'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let isMiniMode = false
let miniModePosition: MiniModePosition = 'left'
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

function isNewTabShortcut(input: Electron.Input): boolean {
  return (
    input.type === 'keyDown' &&
    input.control &&
    !input.alt &&
    !input.meta &&
    !input.shift &&
    input.key.toLowerCase() === 't'
  )
}

function isFocusAddressShortcut(input: Electron.Input): boolean {
  return (
    input.type === 'keyDown' &&
    input.control &&
    !input.alt &&
    !input.meta &&
    !input.shift &&
    input.key.toLowerCase() === 'l'
  )
}

function isReloadShortcut(input: Electron.Input): boolean {
  return (
    input.type === 'keyDown' &&
    !input.control &&
    !input.alt &&
    !input.meta &&
    !input.shift &&
    input.key === 'F5'
  )
}

function isCloseWindowShortcut(input: Electron.Input): boolean {
  return (
    input.type === 'keyDown' &&
    input.control &&
    !input.alt &&
    !input.meta &&
    !input.shift &&
    input.key.toLowerCase() === 'h'
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

function getMiniModeBounds(): Electron.Rectangle | null {
  if (!mainWindow || mainWindow.isDestroyed()) return null

  const display = screen.getDisplayMatching(mainWindow.getBounds())
  const { x, y, width, height } = display.workArea

  return {
    x: miniModePosition === 'right' ? x + width - MINI_WIDTH : x,
    y: y + height - MINI_HEIGHT,
    width: MINI_WIDTH,
    height: MINI_HEIGHT
  }
}

function setMiniModePosition(position: unknown): void {
  miniModePosition = position === 'right' ? 'right' : 'left'

  if (!isMiniMode || !mainWindow || mainWindow.isDestroyed()) return

  const bounds = getMiniModeBounds()
  if (bounds) mainWindow.setBounds(bounds)
}

function toggleMiniMode(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  if (!isMiniMode) {
    previousWindowState = {
      bounds: mainWindow.getBounds(),
      maximized: mainWindow.isMaximized()
    }

    if (previousWindowState.maximized) mainWindow.unmaximize()

    mainWindow.setResizable(false)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    const bounds = getMiniModeBounds()
    if (bounds) mainWindow.setBounds(bounds)
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

function setMiniModeControlsInteractive(interactive: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed() || !isMiniMode) return

  if (interactive) mainWindow.setIgnoreMouseEvents(false)
  else mainWindow.setIgnoreMouseEvents(true, { forward: true })
}

function updateMaximizedState(): void {
  sendToRenderer('window:maximized-changed', mainWindow?.isMaximized() ?? false)
}

function attachWebContentsHandlers(webContents: WebContents): void {
  webContents.on('before-input-event', (event, input) => {
    if (isCloseWindowShortcut(input)) {
      event.preventDefault()
      mainWindow?.close()
      return
    }

    if (isNewTabShortcut(input)) {
      event.preventDefault()
      sendToRenderer('tabs:new')
      return
    }

    if (isFocusAddressShortcut(input)) {
      event.preventDefault()
      sendToRenderer('address:focus')
      return
    }

    if (isReloadShortcut(input)) {
      event.preventDefault()
      sendToRenderer('tabs:reload-active')
      return
    }

    if (!isCloseTabShortcut(input)) return

    event.preventDefault()
    sendToRenderer('tabs:close-active')
  })

  webContents.on('context-menu', (_event, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = []

    if (params.linkURL) {
      menuItems.push(
        {
          label: '在新标签页中打开链接',
          click: () => sendToRenderer('tabs:open-url', params.linkURL)
        },
        {
          label: '复制链接地址',
          click: () => clipboard.writeText(params.linkURL)
        },
        { type: 'separator' }
      )
    }

    if (params.hasImageContents && params.srcURL) {
      menuItems.push(
        {
          label: '在新标签页中打开图片',
          click: () => sendToRenderer('tabs:open-url', params.srcURL)
        },
        {
          label: '复制图片地址',
          click: () => clipboard.writeText(params.srcURL)
        },
        { type: 'separator' }
      )
    }

    if (params.selectionText) {
      menuItems.push({ label: '复制', role: 'copy' }, { type: 'separator' })
    }

    if (params.isEditable) {
      menuItems.push(
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
        { type: 'separator' }
      )
    }

    menuItems.push(
      { label: '后退', click: () => webContents.goBack(), enabled: webContents.canGoBack() },
      { label: '前进', click: () => webContents.goForward(), enabled: webContents.canGoForward() },
      { label: '刷新', click: () => webContents.reload() },
      { type: 'separator' },
      {
        label: '在浏览器中打开',
        click: () => {
          const url = params.pageURL
          if (url) shell.openExternal(url)
        }
      }
    )

    // 去除首尾和连续的分隔符
    const cleaned: Electron.MenuItemConstructorOptions[] = []
    for (const item of menuItems) {
      if (item.type === 'separator') {
        if (cleaned.length > 0 && cleaned[cleaned.length - 1].type !== 'separator') {
          cleaned.push(item)
        }
      } else {
        cleaned.push(item)
      }
    }
    while (cleaned.length > 0 && cleaned[cleaned.length - 1].type === 'separator') {
      cleaned.pop()
    }

    if (cleaned.length > 0) {
      Menu.buildFromTemplate(cleaned).popup()
    }
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
  ipcMain.handle('window:set-mini-controls-interactive', (_event, interactive: boolean) => {
    setMiniModeControlsInteractive(interactive)
  })
  ipcMain.handle('window:set-mini-position', (_event, position: unknown) => {
    setMiniModePosition(position)
  })
  ipcMain.handle('window:show', () => {
    if (isMiniMode) toggleMiniMode()
    mainWindow?.show()
    mainWindow?.focus()
  })
  ipcMain.handle('window:toggle-mini-mode', () => toggleMiniMode())
  ipcMain.handle('app:get-default-home', () => DEFAULT_HOME)
  ipcMain.handle('webview:capture-to-clipboard', async (_event, webContentsId: unknown) => {
    if (typeof webContentsId !== 'number') return false

    const target = webContents.fromId(webContentsId)
    if (!target || target.isDestroyed()) return false

    const image = await target.capturePage()
    if (image.isEmpty()) return false

    clipboard.writeImage(image)
    return true
  })

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

  globalShortcut.register('Alt+J', () => {
    sendToRenderer('media:seek-active-video', -2)
  })

  globalShortcut.register('Alt+K', () => {
    sendToRenderer('media:seek-active-video', 2)
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
