import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  File,
  FileQuestion,
  Filter,
  Folder,
  LoaderCircle,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react"

import { filesApi, uploadRemoteFile, type RemoteEntry } from "@/api/files"

type Transfer = {
  id: string
  name: string
  loaded: number
  total: number
  status: "running" | "success" | "failed" | "canceled"
  error?: string
}
type ContextMenu = { entry: RemoteEntry; x: number; y: number }

export function RemoteFileBrowser({ hostId }: { hostId: number }) {
  const [currentPath, setCurrentPath] = useState("")
  const [parent, setParent] = useState("")
  const [entries, setEntries] = useState<RemoteEntry[]>([])
  const [selected, setSelected] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [dragging, setDragging] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filter, setFilter] = useState("")
  const [pathEditing, setPathEditing] = useState(false)
  const [pathInput, setPathInput] = useState("")
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requests = useRef(new Map<string, XMLHttpRequest>())
  const pathInputRef = useRef<HTMLInputElement>(null)
  const breadcrumbsRef = useRef<HTMLDivElement>(null)

  const loadDirectory = useCallback(
    async (target?: string) => {
      setLoading(true)
      setError("")
      try {
        let path = target
        if (!path) path = (await filesApi.home(hostId)).path
        const result = await filesApi.list(hostId, path)
        setCurrentPath(result.path)
        setParent(result.parent)
        setSelected("")
        setEntries(
          result.items.sort(
            (a, b) =>
              Number(b.type === "directory") - Number(a.type === "directory") ||
              a.name.localeCompare(b.name, undefined, { numeric: true })
          )
        )
        return true
      } catch (reason) {
        setError((reason as Error).message)
        return false
      } finally {
        setLoading(false)
      }
    },
    [hostId]
  )
  useEffect(() => {
    void loadDirectory()
    return () => requests.current.forEach((xhr) => xhr.abort())
  }, [loadDirectory])
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("pointerdown", close)
    window.addEventListener("blur", close)
    window.addEventListener("keydown", escape)
    window.addEventListener("scroll", close, true)
    return () => {
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("blur", close)
      window.removeEventListener("keydown", escape)
      window.removeEventListener("scroll", close, true)
    }
  }, [contextMenu])
  useEffect(() => {
    const container = breadcrumbsRef.current
    if (container) container.scrollLeft = container.scrollWidth
  }, [currentPath, pathEditing])

  const crumbs = useMemo(() => {
    if (!currentPath || currentPath === ".")
      return [{ label: "~", path: currentPath }]
    const absolute = currentPath.startsWith("/")
    const parts = currentPath.split("/").filter(Boolean)
    return [
      { label: absolute ? "/" : "~", path: absolute ? "/" : "." },
      ...parts.map((part, index) => ({
        label: part,
        path: `${absolute ? "/" : ""}${parts.slice(0, index + 1).join("/")}`,
      })),
    ]
  }, [currentPath])

  const filteredEntries = useMemo(() => {
    const keyword = filter.trim().toLocaleLowerCase()
    if (!keyword) return entries
    return entries.filter((entry) =>
      entry.name.toLocaleLowerCase().includes(keyword)
    )
  }, [entries, filter])

  function beginPathEditing() {
    setPathInput(currentPath)
    setPathEditing(true)
    requestAnimationFrame(() => pathInputRef.current?.select())
  }

  async function submitPath() {
    const target = pathInput.trim()
    if (!target) return
    if (await loadDirectory(target)) setPathEditing(false)
  }

  async function uploadFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) await uploadOne(file, false)
  }
  async function uploadOne(file: File, overwrite: boolean) {
    const id = `${Date.now()}-${Math.random()}`
    setTransfers((items) => [
      ...items,
      { id, name: file.name, loaded: 0, total: file.size, status: "running" },
    ])
    const operation = uploadRemoteFile(
      hostId,
      currentPath,
      file,
      overwrite,
      (loaded, total) =>
        setTransfers((items) =>
          items.map((item) =>
            item.id === id ? { ...item, loaded, total } : item
          )
        )
    )
    requests.current.set(id, operation.xhr)
    try {
      await operation.promise
      setTransfers((items) =>
        items.map((item) =>
          item.id === id
            ? {
                ...item,
                loaded: file.size,
                total: file.size,
                status: "success",
              }
            : item
        )
      )
      void loadDirectory(currentPath)
    } catch (reason) {
      const failure = reason as Error & { status?: number }
      if (
        failure.status === 409 &&
        !overwrite &&
        window.confirm(`远程目录已存在“${file.name}”，是否覆盖？`)
      ) {
        setTransfers((items) => items.filter((item) => item.id !== id))
        requests.current.delete(id)
        await uploadOne(file, true)
        return
      }
      setTransfers((items) =>
        items.map((item) =>
          item.id === id
            ? {
                ...item,
                status: failure.name === "AbortError" ? "canceled" : "failed",
                error: failure.message,
              }
            : item
        )
      )
    } finally {
      requests.current.delete(id)
    }
  }
  function cancel(id: string) {
    requests.current.get(id)?.abort()
  }
  function open(entry: RemoteEntry) {
    if (entry.type === "directory") void loadDirectory(entry.path)
    else if (entry.type === "file")
      window.location.assign(filesApi.downloadUrl(hostId, entry.path))
  }
  function download(entry: RemoteEntry) {
    window.location.assign(filesApi.downloadUrl(hostId, entry.path))
    setContextMenu(null)
  }
  async function copyPath(entry: RemoteEntry) {
    try {
      await navigator.clipboard.writeText(entry.path)
    } catch {
      setError("无法复制路径，请检查浏览器剪贴板权限")
    }
    setContextMenu(null)
  }
  async function deleteFile(entry: RemoteEntry) {
    setContextMenu(null)
    if (
      !window.confirm(
        `确认删除远程文件“${entry.name}”？\n\n${entry.path}\n\n此操作无法撤销。`
      )
    )
      return
    setError("")
    try {
      await filesApi.remove(hostId, entry.path)
      if (selected === entry.path) setSelected("")
      await loadDirectory(currentPath)
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-w-0 items-center gap-1 px-1">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wider text-slate-500 uppercase">
          远程文件
        </span>
        <button
          title="过滤当前目录"
          onClick={() => {
            setFilterOpen((open) => !open)
            if (filterOpen) setFilter("")
          }}
          className={`shrink-0 rounded p-1 hover:bg-white/10 hover:text-slate-200 ${filterOpen || filter ? "bg-white/10 text-blue-300" : "text-slate-500"}`}
        >
          <Filter className="size-4" />
        </button>
        <button
          title="上传文件"
          onClick={() => inputRef.current?.click()}
          className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-200"
        >
          <Upload className="size-4" />
        </button>
        <button
          title="刷新"
          onClick={() => void loadDirectory(currentPath)}
          className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-200"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </button>
        <input
          ref={inputRef}
          hidden
          type="file"
          multiple
          onChange={(event) => {
            if (event.target.files) void uploadFiles(event.target.files)
            event.target.value = ""
          }}
        />
      </div>
      {filterOpen && (
        <div className="relative mt-2 px-1">
          <Filter className="absolute top-1/2 left-3 size-3 -translate-y-1/2 text-slate-600" />
          <input
            autoFocus
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setFilter("")
                setFilterOpen(false)
              }
            }}
            placeholder="过滤文件名..."
            className="h-7 w-full rounded border border-white/10 bg-white/[.04] pr-7 pl-7 text-[11px] text-slate-300 outline-none placeholder:text-slate-600 focus:border-blue-400/50"
          />
          {filter && (
            <button
              title="清空过滤"
              onClick={() => setFilter("")}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 text-slate-600 hover:text-slate-300"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1 border-y border-white/[.07] px-1 py-1.5">
        <button
          disabled={!parent}
          onClick={() => void loadDirectory(parent)}
          className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/10 disabled:opacity-30"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        {pathEditing ? (
          <input
            ref={pathInputRef}
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitPath()
              if (event.key === "Escape") {
                setPathEditing(false)
                setPathInput(currentPath)
              }
            }}
            onBlur={() => {
              if (!loading) setPathEditing(false)
            }}
            aria-label="远程目录路径"
            className="h-6 w-0 min-w-0 flex-1 rounded border border-blue-400/50 bg-black/20 px-2 font-mono text-[10px] text-slate-300 outline-none"
          />
        ) : (
          <div
            ref={breadcrumbsRef}
            title="点击编辑路径"
            onClick={beginPathEditing}
            className="flex h-6 w-0 min-w-0 flex-1 cursor-text items-center overflow-x-auto overflow-y-hidden rounded px-1 text-[10px] text-slate-500 hover:bg-white/[.04]"
          >
            {crumbs.map((crumb, index) => (
              <span
                key={`${crumb.path}-${index}`}
                className="flex shrink-0 items-center"
              >
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    void loadDirectory(crumb.path)
                  }}
                  className="max-w-20 cursor-pointer truncate rounded px-1 py-0.5 hover:bg-white/10 hover:text-slate-200"
                >
                  {crumb.label}
                </button>
                {index < crumbs.length - 1 && (
                  <ChevronRight className="size-3" />
                )}
              </span>
            ))}
          </div>
        )}
      </div>
      <div
        onDragEnter={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void uploadFiles(event.dataTransfer.files)
        }}
        className="relative min-h-0 flex-1 overflow-y-auto py-1"
      >
        {dragging && (
          <div className="absolute inset-1 z-10 grid place-items-center rounded-lg border border-dashed border-blue-400 bg-blue-500/15 text-xs text-blue-300">
            上传到当前目录
          </div>
        )}
        {loading && entries.length === 0 ? (
          <div className="grid h-28 place-items-center">
            <LoaderCircle className="size-4 animate-spin text-slate-600" />
          </div>
        ) : error ? (
          <div className="m-2 rounded bg-red-500/10 p-2 text-[10px] leading-4 text-red-300">
            {error}
            <button
              onClick={() => void loadDirectory(currentPath)}
              className="ml-1 underline"
            >
              重试
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="p-5 text-center text-[10px] text-slate-600">
            此目录为空
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="p-5 text-center text-[10px] text-slate-600">
            没有匹配“{filter}”的文件
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <button
              key={entry.path}
              title={`${entry.mode} · ${formatSize(entry.size)} · ${new Date(entry.modifiedAt).toLocaleString()}`}
              onClick={() => setSelected(entry.path)}
              onDoubleClick={() => open(entry)}
              onContextMenu={(event) => {
                event.preventDefault()
                setSelected(entry.path)
                setContextMenu({
                  entry,
                  x: Math.min(event.clientX, window.innerWidth - 170),
                  y: Math.min(event.clientY, window.innerHeight - 145),
                })
              }}
              className={`group flex w-full items-center gap-2.5 rounded px-2 py-2 text-left text-[13px] ${selected === entry.path ? "bg-blue-500/15 text-blue-200" : "text-slate-300 hover:bg-white/[.06]"}`}
            >
              {entry.type === "directory" ? (
                <Folder className="size-4.5 shrink-0 fill-amber-400/20 text-amber-400" />
              ) : entry.type === "file" ? (
                <File className="size-4.5 shrink-0 text-slate-400" />
              ) : (
                <FileQuestion className="size-4.5 shrink-0 text-slate-500" />
              )}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.type === "file" && (
                <span
                  onClick={(event) => {
                    event.stopPropagation()
                    download(entry)
                  }}
                  className="hidden rounded p-1 group-hover:block hover:bg-white/10"
                >
                  <Download className="size-3" />
                </span>
              )}
              <span className="text-[9px] text-slate-600">
                {entry.type === "directory" ? "" : formatSize(entry.size)}
              </span>
            </button>
          ))
        )}
      </div>
      {transfers.length > 0 && (
        <div className="max-h-32 overflow-y-auto border-t border-white/[.07] py-1">
          {transfers.slice(-4).map((transfer) => (
            <div key={transfer.id} className="px-2 py-1.5 text-[10px]">
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-slate-400">
                  {transfer.name}
                </span>
                {transfer.status === "running" ? (
                  <button onClick={() => cancel(transfer.id)}>
                    <X className="size-3 text-slate-500" />
                  </button>
                ) : (
                  <span
                    className={
                      transfer.status === "success"
                        ? "text-emerald-400"
                        : "text-red-400"
                    }
                  >
                    {transfer.status === "success"
                      ? "完成"
                      : transfer.status === "canceled"
                        ? "已取消"
                        : "失败"}
                  </span>
                )}
              </div>
              {transfer.status === "running" && (
                <div className="mt-1 h-1 overflow-hidden rounded bg-white/10">
                  <div
                    className="h-full bg-blue-400"
                    style={{
                      width: `${transfer.total ? Math.min(100, (transfer.loaded / transfer.total) * 100) : 0}%`,
                    }}
                  />
                </div>
              )}
              {transfer.error && (
                <div
                  className="mt-0.5 truncate text-red-400"
                  title={transfer.error}
                >
                  {transfer.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {contextMenu &&
        createPortal(
          <div
            onPointerDown={(event) => event.stopPropagation()}
            className="fixed z-[100] w-40 rounded-lg border border-white/10 bg-[#171c25] p-1 text-xs text-slate-300 shadow-2xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => void copyPath(contextMenu.entry)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 hover:bg-white/10"
            >
              <Copy className="size-3.5" />
              复制路径
            </button>
            {contextMenu.entry.type === "file" && (
              <>
                <button
                  onClick={() => download(contextMenu.entry)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 hover:bg-white/10"
                >
                  <Download className="size-3.5" />
                  下载
                </button>
                <div className="my-1 border-t border-white/10" />
                <button
                  onClick={() => void deleteFile(contextMenu.entry)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="size-3.5" />
                  删除
                </button>
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
