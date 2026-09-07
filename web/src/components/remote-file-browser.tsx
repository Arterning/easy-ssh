import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  File,
  FileQuestion,
  Folder,
  LoaderCircle,
  RefreshCw,
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

export function RemoteFileBrowser({ hostId }: { hostId: number }) {
  const [currentPath, setCurrentPath] = useState("")
  const [parent, setParent] = useState("")
  const [entries, setEntries] = useState<RemoteEntry[]>([])
  const [selected, setSelected] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [dragging, setDragging] = useState(false)
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const requests = useRef(new Map<string, XMLHttpRequest>())

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
      } catch (reason) {
        setError((reason as Error).message)
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col border-t border-white/10 pt-3">
      <div className="flex items-center gap-1 px-1">
        <span className="flex-1 text-[10px] font-semibold tracking-widest text-slate-600 uppercase">
          远程文件
        </span>
        <button
          title="上传文件"
          onClick={() => inputRef.current?.click()}
          className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-200"
        >
          <Upload className="size-3.5" />
        </button>
        <button
          title="刷新"
          onClick={() => void loadDirectory(currentPath)}
          className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-200"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
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
      <div className="mt-2 flex items-center gap-1 border-y border-white/[.07] px-1 py-1.5">
        <button
          disabled={!parent}
          onClick={() => void loadDirectory(parent)}
          className="rounded p-1 text-slate-500 hover:bg-white/10 disabled:opacity-30"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto text-[10px] text-slate-500">
          {crumbs.map((crumb, index) => (
            <span
              key={`${crumb.path}-${index}`}
              className="flex shrink-0 items-center"
            >
              <button
                onClick={() => void loadDirectory(crumb.path)}
                className="max-w-20 truncate rounded px-1 py-0.5 hover:bg-white/10 hover:text-slate-200"
              >
                {crumb.label}
              </button>
              {index < crumbs.length - 1 && <ChevronRight className="size-3" />}
            </span>
          ))}
        </div>
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
        ) : (
          entries.map((entry) => (
            <button
              key={entry.path}
              title={`${entry.mode} · ${formatSize(entry.size)} · ${new Date(entry.modifiedAt).toLocaleString()}`}
              onClick={() => setSelected(entry.path)}
              onDoubleClick={() => open(entry)}
              className={`group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] ${selected === entry.path ? "bg-blue-500/15 text-blue-200" : "text-slate-400 hover:bg-white/[.06]"}`}
            >
              {entry.type === "directory" ? (
                <Folder className="size-3.5 shrink-0 fill-amber-400/20 text-amber-400" />
              ) : entry.type === "file" ? (
                <File className="size-3.5 shrink-0 text-slate-500" />
              ) : (
                <FileQuestion className="size-3.5 shrink-0 text-slate-600" />
              )}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.type === "file" && (
                <span
                  onClick={(event) => {
                    event.stopPropagation()
                    window.location.assign(
                      filesApi.downloadUrl(hostId, entry.path)
                    )
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
    </div>
  )
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
