import { ToastProvider } from "./components/ui/toast"
import Dashboard from "./_pages/Dashboard"
import { ToastViewport } from "@radix-ui/react-toast"
import { useEffect, useRef } from "react"
import { AudioManagerProvider } from "./contexts/AudioManagerContext"

const App: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)

  // Effect for height monitoring
  useEffect(() => {
    if (!containerRef.current) return

    const updateHeight = () => {
      if (!containerRef.current) return
      const height = containerRef.current.scrollHeight
      const width = containerRef.current.scrollWidth
      window.electronAPI?.updateContentDimensions({ width, height })
    }

    const resizeObserver = new ResizeObserver(() => {
      updateHeight()
    })

    // Initial height update
    updateHeight()

    // Observe for changes
    resizeObserver.observe(containerRef.current)

    // Also update height when content changes
    const mutationObserver = new MutationObserver(() => {
      updateHeight()
    })

    mutationObserver.observe(containerRef.current, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    })

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [])

  return (
    <div ref={containerRef} className="min-h-0">
      <AudioManagerProvider>
        <ToastProvider>
          <Dashboard />
          <ToastViewport />
        </ToastProvider>
      </AudioManagerProvider>
    </div>
  )
}

export default App
