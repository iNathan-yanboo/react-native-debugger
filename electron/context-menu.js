import { ipcMain } from 'electron'
import contextMenu from 'electron-context-menu'
import Store from 'electron-store'
import {
  toggleDevTools, n, item, separator,
} from './menu/common'

const invokeDevMethod = (win, name) => win.webContents.executeJavaScript(
  `window.invokeDevMethod && window.invokeDevMethod('${name}')`,
)

export const registerContextMenu = (win) => {
  const store = new Store()
  const defaultContextMenuItems = [
    item('Toggle Developer Tools', n, () => toggleDevTools(win, 'chrome')),
    item('Toggle React DevTools', n, () => toggleDevTools(win, 'react')),
    item('Toggle Redux DevTools', n, () => toggleDevTools(win, 'redux')),
  ]
  let networkInspectEnabled = !!win.debuggerConfig.networkInspect
  let availableMethods = []
  const toggleNetworkInspect = () => {
    if (!availableMethods.includes('networkInspect')) return
    networkInspectEnabled = !networkInspectEnabled
    store.set('networkInspect', networkInspectEnabled)
    invokeDevMethod(win, 'networkInspect')
  }
  contextMenu({
    window: win,
    showInspectElement: process.env.NODE_ENV === 'development',
    prepend: () => [
      availableMethods.includes('reload')
          && item('Reload JS', n, () => invokeDevMethod(win, 'reload')),
      availableMethods.includes('toggleElementInspector')
          && item('Toggle Element Inspector', n, () => invokeDevMethod(win, 'toggleElementInspector')),
      availableMethods.includes('show')
          && item('Show Developer Menu', n, () => invokeDevMethod(win, 'show')),
      item(
        networkInspectEnabled
          ? 'Disable Network Inspect'
          : 'Enable Network Inspect',
        n,
        toggleNetworkInspect,
      ),
      availableMethods.includes('showAsyncStorage')
          && item('Log AsyncStorage content', n, () => invokeDevMethod(win, 'showAsyncStorage')),
      availableMethods.includes('clearAsyncStorage')
          && item('Clear AsyncStorage', n, () => invokeDevMethod(win, 'clearAsyncStorage')),
      separator,
    ]
      .filter((menuItem) => !!menuItem)
      .concat(defaultContextMenuItems),
  })

  const listener = (event, data) => {
    availableMethods = data.availableMethods || availableMethods
    networkInspectEnabled = typeof data.networkInspectEnabled === 'boolean'
      ? data.networkInspectEnabled
      : networkInspectEnabled
  }

  const networkInspectListener = (event, enabled) => {
    if (event.sender !== win.webContents || typeof enabled !== 'boolean') return
    store.set('networkInspect', enabled)
  }

  ipcMain.on(`context-menu-available-methods-update-${win.id}`, listener)
  ipcMain.on('network-inspect-set-enabled', networkInspectListener)
  return () => {
    ipcMain.off(`context-menu-available-methods-update-${win.id}`, listener)
    ipcMain.off('network-inspect-set-enabled', networkInspectListener)
  }
}
