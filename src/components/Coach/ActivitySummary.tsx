import React from "react"
import { QwenActivitySummary } from "../../types/activity"

interface ActivitySummaryProps {
  activity: QwenActivitySummary | null
}

const ActivitySummary: React.FC<ActivitySummaryProps> = ({ activity }) => {
  if (!activity) {
    return (
      <div className="p-4 bg-gray-800/90 rounded-lg border border-gray-700/50">
        <p className="text-sm text-gray-400">No activity data yet...</p>
      </div>
    )
  }

  const taskTypeColors = {
    work: "bg-green-500/20 text-green-300 border-green-500/50",
    study: "bg-blue-500/20 text-blue-300 border-blue-500/50",
    entertainment: "bg-red-500/20 text-red-300 border-red-500/50",
    social: "bg-yellow-500/20 text-yellow-300 border-yellow-500/50",
    other: "bg-gray-500/20 text-gray-300 border-gray-500/50"
  }

  return (
    <div className="p-4 bg-gray-800/90 rounded-lg border border-gray-700/50 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Current Activity
        </h3>
        <span
          className={`px-2 py-1 rounded text-xs font-medium border ${taskTypeColors[activity.taskType]}`}
        >
          {activity.taskType}
        </span>
      </div>
      <p className="text-sm text-gray-200 font-medium">{activity.primaryActivity}</p>
      {activity.appGuess && (
        <p className="text-xs text-gray-400">App: {activity.appGuess}</p>
      )}
      {activity.details && (
        <p className="text-xs text-gray-500 mt-1">{activity.details}</p>
      )}
      <p className="text-xs text-gray-500 mt-2">
        {new Date(activity.timestamp).toLocaleTimeString()}
      </p>
    </div>
  )
}

export default ActivitySummary

