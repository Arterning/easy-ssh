type WailsWindow = Window & {
  wails?: {
    Call?: {
      ByName: (name: string, ...args: unknown[]) => Promise<unknown>
    }
  }
}

export function openWorkspace(path: string, desktopMethod: string, id: number) {
  const wails = (window as WailsWindow).wails
  if (wails?.Call?.ByName) {
    void wails.Call.ByName(desktopMethod, id)
    return
  }
  window.open(path, "_blank", "noopener,noreferrer")
}
