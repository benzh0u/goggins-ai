import React, { useState, useRef, useEffect } from "react"

interface Position {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

const FloatingMouth: React.FC = () => {
  const [position, setPosition] = useState<Position>({ x: 100, y: 100 })
  const [size, setSize] = useState<Size>({ width: 200, height: 200 })
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [dragStart, setDragStart] = useState<Position>({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Load saved position and size from localStorage
  useEffect(() => {
    const savedPosition = localStorage.getItem("floatingMouthPosition")
    const savedSize = localStorage.getItem("floatingMouthSize")
    
    if (savedPosition) {
      try {
        setPosition(JSON.parse(savedPosition))
      } catch (e) {
        console.error("Error loading saved position:", e)
      }
    }
    
    if (savedSize) {
      try {
        setSize(JSON.parse(savedSize))
      } catch (e) {
        console.error("Error loading saved size:", e)
      }
    }
  }, [])

  // Save position and size to localStorage
  const savePosition = (pos: Position) => {
    localStorage.setItem("floatingMouthPosition", JSON.stringify(pos))
  }

  const saveSize = (sz: Size) => {
    localStorage.setItem("floatingMouthSize", JSON.stringify(sz))
  }

  // Handle mouse down for dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === containerRef.current || (e.target as HTMLElement).closest('.mouth-image')) {
      setIsDragging(true)
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y
      })
      e.preventDefault()
    }
  }

  // Handle mouse down for resizing
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true)
    setDragStart({
      x: e.clientX,
      y: e.clientY
    })
    e.preventDefault()
    e.stopPropagation()
  }

  // Handle mouse move
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newPosition = {
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y
        }
        setPosition(newPosition)
        savePosition(newPosition)
      } else if (isResizing) {
        const deltaX = e.clientX - dragStart.x
        const deltaY = e.clientY - dragStart.y
        const newSize = {
          width: Math.max(100, size.width + deltaX),
          height: Math.max(100, size.height + deltaY)
        }
        setSize(newSize)
        saveSize(newSize)
        setDragStart({ x: e.clientX, y: e.clientY })
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(false)
    }

    if (isDragging || isResizing) {
      window.addEventListener("mousemove", handleMouseMove)
      window.addEventListener("mouseup", handleMouseUp)
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isDragging, isResizing, dragStart, position, size])

  return (
    <div
      ref={containerRef}
      className="fixed z-50 cursor-move select-none"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.width}px`,
        height: `${size.height}px`
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Mouth Image */}
      <img
        src="/MouthClosed.png"
        alt="Floating Mouth"
        className="mouth-image w-full h-full object-contain pointer-events-none"
        draggable={false}
        onError={(e) => {
          // Fallback to renderer path if root public doesn't work
          const target = e.target as HTMLImageElement
          if (!target.src.includes('renderer')) {
            target.src = '/renderer/public/MouthClosed.png'
          }
        }}
      />
      
      {/* Resize Handle */}
      <div
        className="absolute bottom-0 right-0 w-5 h-5 bg-blue-500/70 hover:bg-blue-500 cursor-nwse-resize rounded-tl-lg border-2 border-blue-300/50"
        onMouseDown={handleResizeMouseDown}
        style={{
          cursor: "nwse-resize"
        }}
        title="Drag to resize"
      />
    </div>
  )
}

export default FloatingMouth

