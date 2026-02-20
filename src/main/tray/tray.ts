import { Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { showMainWindow } from '../window/main-window'

let tray: Tray | null = null

export function createTray(onQuit: () => void): Tray {
  const iconPath = join(__dirname, '../../resources/icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })

  tray = new Tray(icon)
  tray.setToolTip('Attacca — AI Productivity Assistant')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Attacca',
      click: () => showMainWindow()
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => onQuit()
    }
  ])

  tray.setContextMenu(contextMenu)

  // Click to toggle window
  tray.on('click', () => {
    showMainWindow()
  })

  return tray
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
