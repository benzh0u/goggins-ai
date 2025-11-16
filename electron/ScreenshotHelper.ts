// ScreenshotHelper.ts - Simplified for StayHard

import path from "node:path"
import fs from "node:fs"
import { app, desktopCapturer, screen } from "electron"
import { v4 as uuidv4 } from "uuid"
import { config } from "./config"

export class ScreenshotHelper {
  private readonly screenshotDir: string

  constructor(view: "queue" | "solutions" = "queue") {
    // Initialize directory
    this.screenshotDir = path.join(app.getPath("userData"), "screenshots")

    // Create directory if it doesn't exist
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true })
    }
  }

  public async takeScreenshot(
    hideMainWindow: () => void,
    showMainWindow: () => void
  ): Promise<string> {
    try {
      // Ensure directory exists before taking screenshot
      if (!fs.existsSync(this.screenshotDir)) {
        fs.mkdirSync(this.screenshotDir, { recursive: true })
      }

      const screenshotPath = path.join(this.screenshotDir, `${uuidv4()}.png`)
      console.log(`[ScreenshotHelper] Taking screenshot to: ${screenshotPath}`)

      // Use Electron's native desktopCapturer API which handles permissions better
      const primaryDisplay = screen.getPrimaryDisplay()
      const { width, height } = primaryDisplay.size

      try {
        // Get available sources
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width, height }
        })

        if (sources.length === 0) {
          throw new Error('No screen sources available. Check macOS Screen Recording permissions in System Settings > Privacy & Security > Screen Recording.')
        }

        // Use the primary display source
        const primarySource = sources.find(source => 
          source.display_id === primaryDisplay.id.toString()
        ) || sources[0]

        if (!primarySource || !primarySource.thumbnail) {
          throw new Error('Failed to get screen source or thumbnail is null')
        }

        console.log(`[ScreenshotHelper] Capturing from source: ${primarySource.name} (${primarySource.id})`)

        const img = primarySource.thumbnail
        
        // Check if image is valid before converting
        if (img.isEmpty()) {
          throw new Error('Failed to capture screenshot: thumbnail image is empty')
        }
        
        // Scale down if needed to reduce processing time
        let finalImage = img
        const maxWidth = config.maxScreenshotWidth
        const maxHeight = config.maxScreenshotHeight
        const originalSize = img.getSize()
        
        if (originalSize.width > maxWidth || originalSize.height > maxHeight) {
          const scale = Math.min(
            maxWidth / originalSize.width,
            maxHeight / originalSize.height
          )
          const newWidth = Math.round(originalSize.width * scale)
          const newHeight = Math.round(originalSize.height * scale)
          
          console.log(`[ScreenshotHelper] Scaling screenshot from ${originalSize.width}x${originalSize.height} to ${newWidth}x${newHeight}`)
          finalImage = img.resize({ width: newWidth, height: newHeight, quality: 'good' })
        }
        
        // Convert to PNG buffer
        const pngBuffer = finalImage.toPNG()
        
        if (!pngBuffer || pngBuffer.length === 0) {
          throw new Error('Failed to capture screenshot: empty image buffer')
        }

        // Write to file
        await fs.promises.writeFile(screenshotPath, pngBuffer)
        
        // Verify file was written
        const stats = await fs.promises.stat(screenshotPath)
        if (stats.size === 0) {
          throw new Error('Screenshot file was created but is empty')
        }

        console.log(`[ScreenshotHelper] Screenshot saved successfully: ${screenshotPath} (${stats.size} bytes)`)
        return screenshotPath

      } catch (captureError) {
        console.error(`[ScreenshotHelper] Capture error:`, captureError)
        
        // Fallback to screenshot-desktop library if Electron API fails
        console.log(`[ScreenshotHelper] Falling back to screenshot-desktop library...`)
        try {
          const screenshot = (await import("screenshot-desktop")).default
          await screenshot({ filename: screenshotPath })
          
          // Wait for file to exist
          let attempts = 0
          const maxAttempts = 50
          while (attempts < maxAttempts) {
            try {
              const stats = await fs.promises.stat(screenshotPath)
              if (stats.size > 0) {
                console.log(`[ScreenshotHelper] Fallback screenshot saved: ${screenshotPath} (${stats.size} bytes)`)
                return screenshotPath
              }
            } catch {}
            await new Promise(resolve => setTimeout(resolve, 100))
            attempts++
          }
          throw new Error('Fallback screenshot library also failed to create file')
        } catch (fallbackError) {
          throw new Error(`Both Electron API and fallback failed. Original: ${captureError instanceof Error ? captureError.message : String(captureError)}, Fallback: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}. Check macOS Screen Recording permissions.`)
        }
      }
    } catch (error) {
      console.error("[ScreenshotHelper] Error taking screenshot:", error)
      throw new Error(`Failed to take screenshot: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
