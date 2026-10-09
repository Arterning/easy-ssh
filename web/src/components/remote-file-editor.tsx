import { useEffect, useRef, useState } from "react"
import { LoaderCircle, Save } from "lucide-react"

import { ApiError } from "@/api/client"
import { filesApi, type RemoteEntry } from "@/api/files"

export function RemoteFileEditor({
  hostId,
  entry,
  active,
  onDirtyChange,
}: {
  hostId: number
  entry: RemoteEntry
  active: boolean
  onDirtyChange?: (path: string, dirty: boolean) => void
}) {
  const [content, setContent] = useState("")
  const [savedContent, setSavedContent] = useState("")
  const [modifiedAt, setModifiedAt] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [conflicted, setConflicted] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dirty = content !== savedContent

  useEffect(() => {
    onDirtyChange?.(entry.path, dirty)
  }, [dirty, entry.path, onDirtyChange])

  useEffect(() => {
    if (active && !loading) requestAnimationFrame(() => textareaRef.current?.focus())
  }, [active, loading])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    setConflicted(false)
    filesApi
      .readContent(hostId, entry.path)
      .then((file) => {
        if (!active) return
        setContent(file.content)
        setSavedContent(file.content)
        setModifiedAt(file.modifiedAt)
      })
      .catch((reason: Error) => active && setError(reason.message))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [entry.path, hostId])

  async function save(force = false) {
    if (saving || loading || (!dirty && !force)) return
    setSaving(true)
    setError("")
    setConflicted(false)
    try {
      const file = await filesApi.saveContent(hostId, entry.path, content, modifiedAt, force)
      setSavedContent(file.content)
      setModifiedAt(file.modifiedAt)
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) setConflicted(true)
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function reload() {
    setLoading(true)
    setError("")
    setConflicted(false)
    try {
      const file = await filesApi.readContent(hostId, entry.path)
      setContent(file.content)
      setSavedContent(file.content)
      setModifiedAt(file.modifiedAt)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`absolute inset-x-0 top-9 bottom-0 z-10 flex-col bg-[#0b0e14] ${active ? "flex" : "hidden"}`}>
      <div className="flex h-9 shrink-0 items-center border-b border-white/[0.07] bg-[#0e1219] px-3 text-xs">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-500" title={entry.path}>{entry.path}</span>
        <button onClick={() => void save()} disabled={!dirty || saving || loading} title="保存 (Ctrl+S)" className="rounded p-1 text-slate-400 hover:bg-white/10 disabled:opacity-30">
          {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        </button>
      </div>
      {error && (
        <div className="flex items-center gap-3 border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <span className="min-w-0 flex-1">{error}</span>
          {conflicted && (
            <>
              <button onClick={() => void reload()} disabled={saving} className="rounded bg-white/10 px-2 py-1 hover:bg-white/15">重新加载</button>
              <button onClick={() => void save(true)} disabled={saving} className="rounded bg-red-500/20 px-2 py-1 hover:bg-red-500/30">强制覆盖</button>
            </>
          )}
        </div>
      )}
      {loading ? (
        <div className="grid flex-1 place-items-center"><LoaderCircle className="size-5 animate-spin text-slate-600" /></div>
      ) : (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
              event.preventDefault()
              void save()
            }
          }}
          disabled={saving || !!error && !conflicted && !modifiedAt}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-[#0b0e14] p-4 font-mono text-[13px] leading-6 text-slate-300 outline-none selection:bg-blue-500/30 disabled:opacity-60"
          aria-label={`编辑 ${entry.name}`}
        />
      )}
    </div>
  )
}
