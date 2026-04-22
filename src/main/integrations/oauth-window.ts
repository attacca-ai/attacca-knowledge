import { BrowserWindow } from 'electron'

interface OAuthWindowOptions {
  authUrl: string
  redirectUri: string
  windowTitle?: string
}

/**
 * Opens an Electron BrowserWindow for OAuth2 authorization.
 * Captures the redirect and extracts the authorization code.
 * Returns the code for token exchange.
 */
export function openOAuthWindow(options: OAuthWindowOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 600,
      height: 700,
      show: true,
      title: options.windowTitle ?? 'Connect Account',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    let resolved = false

    const handleRedirect = (url: string): void => {
      if (resolved) return
      if (!url.startsWith(options.redirectUri)) return

      resolved = true
      try {
        const parsed = new URL(url)
        const code = parsed.searchParams.get('code')
        const error = parsed.searchParams.get('error')

        win.close()

        if (error) {
          reject(new Error(`OAuth error: ${error}`))
        } else if (code) {
          resolve(code)
        } else {
          reject(new Error('No authorization code in redirect'))
        }
      } catch (err) {
        win.close()
        const msg = err instanceof Error ? err.message : String(err)
        reject(new Error(`Failed to parse redirect URL: ${msg}`))
      }
    }

    win.webContents.on('will-navigate', (_event, url) => handleRedirect(url))
    win.webContents.on('will-redirect', (_event, url) => handleRedirect(url))

    win.on('closed', () => {
      if (!resolved) {
        reject(new Error('OAuth window closed by user'))
      }
    })

    win.loadURL(options.authUrl)
  })
}
