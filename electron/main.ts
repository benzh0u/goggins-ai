import { app, BrowserWindow, Tray, Menu, nativeImage, systemPreferences } from "electron"
import { initializeIpcHandlers } from "./ipcHandlers"
import { WindowHelper } from "./WindowHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { ShortcutsHelper } from "./shortcuts"
import { ProductivityMonitor } from "./ProductivityMonitor"
import { LLMHelper } from "./LLMHelper"
import { config } from "./config"

import { FloatingMouthWindow } from "./FloatingMouthWindow"

export class AppState {
  private static instance: AppState | null = null

  private windowHelper: WindowHelper
  private screenshotHelper: ScreenshotHelper
  public shortcutsHelper: ShortcutsHelper
  private productivityMonitor: ProductivityMonitor | null = null
  private tray: Tray | null = null
  private floatingMouthWindow: FloatingMouthWindow

  private ttsHelper: LLMHelper | null = null

  constructor() {
    // Initialize WindowHelper with this
    this.windowHelper = new WindowHelper(this)

    // Initialize ScreenshotHelper
    this.screenshotHelper = new ScreenshotHelper("queue")

    // Initialize ShortcutsHelper
    this.shortcutsHelper = new ShortcutsHelper(this)

    // Initialize FloatingMouthWindow
    this.floatingMouthWindow = new FloatingMouthWindow()

    console.log("[AppState] Initializing LLM & TTS Helper...")
    console.log(`[AppState]   enableTTS: ${config.enableTTS}`)
    console.log(`[AppState]   ttsApiKey: ${config.ttsApiKey ? 'SET (' + config.ttsApiKey.substring(0, 10) + '...)' : 'MISSING'}`)
    console.log(`[AppState]   ttsVoiceId: ${config.ttsVoiceId ? 'SET (' + config.ttsVoiceId + ')' : 'MISSING'}`)
    console.log(`[AppState]   openaiApiKey: ${config.openaiApiKey ? 'SET (' + config.openaiApiKey.substring(0, 10) + '...)' : 'MISSING'}`)
    console.log(`[AppState]   openaiModel: ${config.openaiModel}`)
    
    if (config.enableTTS && config.ttsApiKey && config.ttsVoiceId) {
      console.log("[AppState] ✓ Creating LLM Helper with OpenAI + ElevenLabs...")
      this.ttsHelper = new LLMHelper(
        process.env.GEMINI_API_KEY,               // Gemini (fallback)
        false,                                     // useOllama = false (we prefer OpenAI)
        config.llamaModel,
        config.ollamaUrl,
        { apiKey: config.ttsApiKey, voiceId: config.ttsVoiceId },  // ElevenLabs TTS
        config.openaiApiKey ? {                   // OpenAI for text generation
          apiKey: config.openaiApiKey,
          model: config.openaiModel
        } : undefined
      )
      console.log("[AppState] ✓ LLM Helper created: OpenAI (text) + ElevenLabs (voice)")
    } else {
      console.warn("[AppState] ⚠️  TTS Helper NOT created - missing prerequisites:")
      if (!config.enableTTS) console.warn("[AppState]     - ENABLE_TTS is not set to 'true' in .env")
      if (!config.ttsApiKey) console.warn("[AppState]     - ELEVENLABS_API_KEY is missing in .env")
      if (!config.ttsVoiceId) console.warn("[AppState]     - ELEVENLABS_VOICE_ID is missing in .env")
      console.warn("[AppState]     Voice listening will NOT be available without TTS Helper")
    }
  }

  public getTTSHelper(): LLMHelper | null {
    return this.ttsHelper
  }

  public static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState()
    }
    return AppState.instance
  }

  // Getters and Setters
  public getMainWindow(): BrowserWindow | null {
    return this.windowHelper.getMainWindow()
  }

  public isVisible(): boolean {
    return this.windowHelper.isVisible()
  }

  public getScreenshotHelper(): ScreenshotHelper {
    return this.screenshotHelper
  }

  public getProductivityMonitor(): ProductivityMonitor | null {
    return this.productivityMonitor
  }

  public initializeProductivityMonitor(): void {
    if (!this.productivityMonitor) {
      this.productivityMonitor = new ProductivityMonitor(
        this.getMainWindow(),
        this.ttsHelper
      )
      // Update window reference when window is created
      const mainWindow = this.getMainWindow()
      if (mainWindow && this.productivityMonitor) {
        this.productivityMonitor.setMainWindow(mainWindow)
      }
    }
  }

  public setStayHardEnabled(enabled: boolean): void {
    if (!this.productivityMonitor) {
      this.initializeProductivityMonitor()
    }
    
    if (this.productivityMonitor) {
      if (enabled) {
        this.productivityMonitor.start()
      } else {
        this.productivityMonitor.stop()
      }
    }
  }

  // Window management methods
  public createWindow(): void {
    this.windowHelper.createWindow()
  }

  public hideMainWindow(): void {
    this.windowHelper.hideMainWindow()
  }

  public showMainWindow(): void {
    this.windowHelper.showMainWindow()
  }

  public toggleMainWindow(): void {
    this.windowHelper.toggleMainWindow()
  }

  public setWindowDimensions(width: number, height: number): void {
    this.windowHelper.setWindowDimensions(width, height)
  }


  // New methods to move the window
  public moveWindowLeft(): void {
    this.windowHelper.moveWindowLeft()
  }

  public moveWindowRight(): void {
    this.windowHelper.moveWindowRight()
  }
  public moveWindowDown(): void {
    this.windowHelper.moveWindowDown()
  }
  public moveWindowUp(): void {
    this.windowHelper.moveWindowUp()
  }

  public centerAndShowWindow(): void {
    this.windowHelper.centerAndShowWindow()
  }

  public getFloatingMouthWindow(): FloatingMouthWindow {
    return this.floatingMouthWindow
  }

  public createTray(): void {
    // Create a simple tray icon
    const image = nativeImage.createEmpty()
    
    // Try to use a system template image for better integration
    let trayImage = image
    try {
      // Create a minimal icon - just use an empty image and set the title
      trayImage = nativeImage.createFromBuffer(Buffer.alloc(0))
    } catch (error) {
      console.log("Using empty tray image")
      trayImage = nativeImage.createEmpty()
    }
    
    this.tray = new Tray(trayImage)
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show StayHard',
        click: () => {
          this.centerAndShowWindow()
        }
      },
      {
        label: 'Toggle Window',
        click: () => {
          this.toggleMainWindow()
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        accelerator: 'Command+Q',
        click: () => {
          app.quit()
        }
      }
    ])
    
    this.tray.setToolTip('StayHard - Goggins-style productivity monitor')
    this.tray.setContextMenu(contextMenu)
    
    // Set a title for macOS (will appear in menu bar)
    if (process.platform === 'darwin') {
      this.tray.setTitle('SH')
    }
    
    // Double-click to show window
    this.tray.on('double-click', () => {
      this.centerAndShowWindow()
    })
  }
}

// Request microphone permission on macOS
async function requestMicrophonePermission(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    // On non-macOS, permissions are handled differently
    return true
  }

  try {
    const status = systemPreferences.getMediaAccessStatus('microphone')
    console.log(`[App] Current microphone permission status: ${status}`)
    
    if (status === 'granted') {
      console.log("[App] ✓ Microphone permission already granted")
      return true
    }
    
    if (status === 'denied') {
      console.error("[App] ✗ Microphone permission denied")
      console.error("[App]   Please enable in System Settings > Privacy & Security > Microphone")
      return false
    }
    
    // Request permission
    console.log("[App] Requesting microphone permission...")
    const result = await systemPreferences.askForMediaAccess('microphone')
    
    if (result) {
      console.log("[App] ✓ Microphone permission granted")
    } else {
      console.error("[App] ✗ Microphone permission denied by user")
      console.error("[App]   Please enable in System Settings > Privacy & Security > Microphone")
    }
    
    return result
  } catch (error) {
    console.error("[App] Error requesting microphone permission:", error)
    return false
  }
}

// Application initialization
async function initializeApp() {
  const appState = AppState.getInstance()

  // Request microphone permission before initializing (if voice listening is enabled)
  if (config.voiceListeningEnabled) {
    const hasPermission = await requestMicrophonePermission()
    if (!hasPermission) {
      console.warn("[App] ⚠️  Microphone permission not granted - voice listening will not work")
    }
  }

  // Initialize IPC handlers before window creation
  initializeIpcHandlers(appState)

  app.whenReady().then(() => {
    console.log("App is ready")
    appState.createWindow()
    appState.createTray()
    // Create floating mouth window
    appState.getFloatingMouthWindow().createWindow()
    // Initialize ProductivityMonitor after window is created
    appState.initializeProductivityMonitor()
    // Register global shortcuts using ShortcutsHelper
    appState.shortcutsHelper.registerGlobalShortcuts()
  })

  app.on("activate", () => {
    console.log("App activated")
    if (appState.getMainWindow() === null) {
      appState.createWindow()
    }
  })

  // Quit when all windows are closed, except on macOS
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  app.dock?.hide() // Hide dock icon (optional)
  app.commandLine.appendSwitch("disable-background-timer-throttling")
}

// Start the application
initializeApp().catch(console.error)
