import { ipcMain, app, shell, dialog } from 'electron'
import { IPC } from './channels'
import { getGatewayState, startGateway, stopGateway, restartGateway } from '../gateway/lifecycle'
import { checkGatewayHealth } from '../gateway/health'

export function registerIpcHandlers(): void {
  // Gateway
  ipcMain.handle(IPC.GATEWAY_START, async () => {
    await startGateway()
    return { success: true }
  })

  ipcMain.handle(IPC.GATEWAY_STOP, async () => {
    await stopGateway()
    return { success: true }
  })

  ipcMain.handle(IPC.GATEWAY_RESTART, async () => {
    await restartGateway()
    return { success: true }
  })

  ipcMain.handle(IPC.GATEWAY_STATUS, () => {
    return getGatewayState()
  })

  ipcMain.handle(IPC.GATEWAY_HEALTH, async () => {
    return checkGatewayHealth()
  })

  // App
  ipcMain.handle(IPC.APP_GET_VERSION, () => {
    return app.getVersion()
  })

  ipcMain.handle(IPC.APP_OPEN_EXTERNAL, async (_event, url: string) => {
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC.APP_QUIT, () => {
    app.quit()
  })

  // File system
  ipcMain.handle(IPC.FS_SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })
}
