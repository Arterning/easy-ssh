import { API_BASE, request } from "@/api/client"

export type RemoteEntry = {
  name: string
  path: string
  type: "file" | "directory" | "symlink" | "other"
  size: number
  mode: string
  modifiedAt: string
}
export type RemoteDirectory = {
  path: string
  parent: string
  items: RemoteEntry[]
}

export const filesApi = {
  home: (hostId: number) =>
    request<{ path: string }>(`/hosts/${hostId}/files/home`),
  list: (hostId: number, path: string) =>
    request<RemoteDirectory>(
      `/hosts/${hostId}/files?path=${encodeURIComponent(path)}`
    ),
  downloadUrl: (hostId: number, path: string) =>
    `${API_BASE}/hosts/${hostId}/files/download?path=${encodeURIComponent(path)}`,
  remove: (hostId: number, path: string) =>
    request<void>(`/hosts/${hostId}/files?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),
}

export function uploadRemoteFile(
  hostId: number,
  path: string,
  file: File,
  overwrite: boolean,
  onProgress: (loaded: number, total: number) => void
) {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open(
      "POST",
      `${API_BASE}/hosts/${hostId}/files/upload?path=${encodeURIComponent(path)}&overwrite=${overwrite}`
    )
    xhr.upload.onprogress = (event) =>
      onProgress(event.loaded, event.lengthComputable ? event.total : file.size)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else {
        let message = "上传失败"
        try {
          message = JSON.parse(xhr.responseText).message || message
        } catch {
          /* use fallback */
        }
        const error = new Error(message) as Error & { status?: number }
        error.status = xhr.status
        reject(error)
      }
    }
    xhr.onerror = () => reject(new Error("上传连接中断"))
    xhr.onabort = () => reject(new DOMException("上传已取消", "AbortError"))
    const body = new FormData()
    body.append("file", file, file.name)
    xhr.send(body)
  })
  return { xhr, promise }
}
