import React from "react"

interface StayHardToggleProps {
  enabled: boolean
  onToggle: (enabled: boolean) => void
  disabled?: boolean
}

const StayHardToggle: React.FC<StayHardToggleProps> = ({
  enabled,
  onToggle,
  disabled = false
}) => {
  return (
    <button
      onClick={() => !disabled && onToggle(!enabled)}
      disabled={disabled}
      className={`
        relative w-full py-6 px-8 rounded-lg font-bold text-2xl
        transition-all duration-300 transform
        ${enabled
          ? "bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/50"
          : "bg-gray-700 hover:bg-gray-600 text-gray-200 shadow-lg"
        }
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:scale-105"}
        border-2 ${enabled ? "border-red-500" : "border-gray-600"}
      `}
    >
      <div className="flex items-center justify-center gap-3">
        <span className="text-3xl">{enabled ? "🔥" : "❄️"}</span>
        <span>{enabled ? "STAY HARD ON" : "STAY HARD OFF"}</span>
      </div>
      {enabled && (
        <div className="absolute inset-0 rounded-lg bg-red-500/20 animate-pulse" />
      )}
    </button>
  )
}

export default StayHardToggle

