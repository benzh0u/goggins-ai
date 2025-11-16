import { BrowserWindow, screen, app } from "electron"
import path from "node:path"
import fs from "fs"

const isDev = process.env.NODE_ENV === "development"

export class FloatingMouthWindow {
  private mouthWindow: BrowserWindow | null = null
  private readonly configPath: string

  constructor() {
    // Path to store window position/size config
    const userDataPath = app.getPath("userData")
    this.configPath = path.join(userDataPath, "floating-mouth-config.json")
  }

  private loadConfig(): { x: number; y: number; width: number; height: number } {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, "utf-8")
        return JSON.parse(data)
      }
    } catch (error) {
      console.error("[FloatingMouthWindow] Error loading config:", error)
    }
    // Default position and size
    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workAreaSize
    return {
      x: workArea.width - 250,
      y: 100,
      width: 200,
      height: 200
    }
  }

  private saveConfig(): void {
    if (!this.mouthWindow || this.mouthWindow.isDestroyed()) return
    
    try {
      const bounds = this.mouthWindow.getBounds()
      const config = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      }
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2))
    } catch (error) {
      console.error("[FloatingMouthWindow] Error saving config:", error)
    }
  }

  public createWindow(): void {
    if (this.mouthWindow !== null && !this.mouthWindow.isDestroyed()) {
      return
    }

    const config = this.loadConfig()

    const windowSettings: Electron.BrowserWindowConstructorOptions = {
      width: config.width,
      height: config.height,
      minWidth: 100,
      minHeight: 100,
      x: config.x,
      y: config.y,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      },
      show: false,
      alwaysOnTop: true,
      frame: false,
      transparent: true,
      fullscreenable: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      focusable: true,
      resizable: true,
      movable: true,
      skipTaskbar: true,
      acceptFirstMouse: true
    }

    this.mouthWindow = new BrowserWindow(windowSettings)

    // Set platform-specific properties
    if (process.platform === "darwin") {
      this.mouthWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true
      })
      this.mouthWindow.setHiddenInMissionControl(true)
      this.mouthWindow.setAlwaysOnTop(true, "floating")
    }

    // Load the HTML file
    // In dev mode, try to load from public folder, in production from dist
    let htmlPath: string
    if (isDev) {
      // Try public folder first (for Vite dev server)
      htmlPath = path.join(process.cwd(), "public", "floating-mouth.html")
      if (!fs.existsSync(htmlPath)) {
        // Fallback to dist-electron relative path
        htmlPath = path.join(__dirname, "../public/floating-mouth.html")
      }
    } else {
      htmlPath = path.join(__dirname, "../dist/floating-mouth.html")
    }
    
    console.log(`[FloatingMouthWindow] Loading HTML from: ${htmlPath}`)
    this.mouthWindow.loadFile(htmlPath).catch((err) => {
      console.error("[FloatingMouthWindow] Error loading HTML:", err)
      // Try alternative path
      const altPath = path.join(__dirname, "../public/floating-mouth.html")
      console.log(`[FloatingMouthWindow] Trying alternative path: ${altPath}`)
      this.mouthWindow?.loadFile(altPath).catch((err2) => {
        console.error("[FloatingMouthWindow] Alternative path also failed:", err2)
      })
    })

    // Show window after loading
    this.mouthWindow.once("ready-to-show", () => {
      if (this.mouthWindow) {
        this.mouthWindow.show()
        this.mouthWindow.setAlwaysOnTop(true)
      }
    })

    // Save position/size on move/resize
    this.mouthWindow.on("move", () => {
      this.saveConfig()
    })

    this.mouthWindow.on("resize", () => {
      this.saveConfig()
    })

    this.mouthWindow.on("closed", () => {
      this.mouthWindow = null
    })
  }

  public getWindow(): BrowserWindow | null {
    return this.mouthWindow
  }

  public isVisible(): boolean {
    return this.mouthWindow !== null && !this.mouthWindow.isDestroyed() && this.mouthWindow.isVisible()
  }

  public show(): void {
    if (this.mouthWindow && !this.mouthWindow.isDestroyed()) {
      this.mouthWindow.show()
    }
  }

  public hide(): void {
    if (this.mouthWindow && !this.mouthWindow.isDestroyed()) {
      this.mouthWindow.hide()
    }
  }

  public toggle(): void {
    if (this.isVisible()) {
      this.hide()
    } else {
      this.show()
    }
  }

  public destroy(): void {
    if (this.mouthWindow && !this.mouthWindow.isDestroyed()) {
      this.mouthWindow.destroy()
      this.mouthWindow = null
    }
  }

  public setMouthOpen(isOpen: boolean): void {
    if (!this.mouthWindow || this.mouthWindow.isDestroyed()) {
      return
    }

    // Use paths relative to public/ directory
    // Since HTML is in public/ and images are in renderer/public/, we need to go up and into renderer/public
    const imagePath = isOpen 
      ? "../renderer/public/MouthOpen.png" 
      : "../renderer/public/MouthClosed.png"
    
    // Update the image source using executeJavaScript
    this.mouthWindow.webContents.executeJavaScript(`
      (function() {
        const mouthImage = document.getElementById('mouthImage');
        if (mouthImage) {
          mouthImage.src = '${imagePath}';
        }
      })();
    `).catch((error) => {
      console.error("[FloatingMouthWindow] Error updating mouth image:", error)
    })
  }
}

