"use client"

import { useState } from "react"
import { Tag } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { Input } from "@/components/ui/input"

export function SettingsTagsCard() {
  const { state, addTag, deleteTag, refreshData } = useApp()
  const [newTagName, setNewTagName] = useState("")
  const [tagActionInProgress, setTagActionInProgress] = useState(false)

  async function handleAddTag() {
    const name = newTagName.trim()
    if (!name) return
    setTagActionInProgress(true)
    try {
      await addTag(name)
      setNewTagName("")
      await refreshData()
    } finally {
      setTagActionInProgress(false)
    }
  }

  async function handleDeleteTag(id: string) {
    setTagActionInProgress(true)
    try {
      await deleteTag(id)
      await refreshData()
    } finally {
      setTagActionInProgress(false)
    }
  }

  return (
    <div className="rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-6 min-w-0 w-full max-w-full">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-[#F7931A]/10">
          <Tag className="h-5 w-5 text-[#F7931A]" aria-hidden />
        </div>
        <h4 className="text-lg font-semibold text-foreground">Tags</h4>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Create tags to organize transactions and receipts.
      </p>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {state.tags.length > 0 ? (
            state.tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-2 rounded-full border border-[#333] bg-[#1A1A1A] px-3 py-1.5 text-sm text-foreground"
              >
                <span className="truncate max-w-[12rem]">{tag.name}</span>
                <button
                  type="button"
                  onClick={() => void handleDeleteTag(tag.id)}
                  disabled={tagActionInProgress}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-[#2A2A2A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label={`Delete tag ${tag.name}`}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </span>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No tags yet.</p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void handleAddTag()
              }
            }}
            placeholder="New tag"
            className="bg-[#1A1A1A] border-[#333] text-foreground h-10"
            aria-label="New tag name"
          />
          <button
            type="button"
            onClick={() => void handleAddTag()}
            disabled={tagActionInProgress || !newTagName.trim()}
            className="inline-flex items-center justify-center rounded-xl px-4 h-10 text-sm font-medium bg-[#F7931A] text-[#0D0D0D] hover:bg-[#e68818] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Tag
          </button>
        </div>
      </div>
    </div>
  )
}
