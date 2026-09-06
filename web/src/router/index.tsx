import { useEffect, useState } from "react"
import { HostsPage } from "@/pages/hosts"

const routes = { "/": HostsPage, "/hosts": HostsPage }

function navigate(path: string) {
  window.history.pushState({}, "", path)
  window.dispatchEvent(new PopStateEvent("popstate"))
}

export function AppRouter() {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const handleNavigation = () => setPath(window.location.pathname)
    window.addEventListener("popstate", handleNavigation)
    return () => window.removeEventListener("popstate", handleNavigation)
  }, [])
  const Page = routes[path as keyof typeof routes]
  if (Page) return <Page />
  return (
    <main className="grid min-h-svh place-items-center text-center">
      <div>
        <h1 className="text-5xl font-semibold">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">页面不存在</p>
        <button className="mt-4 underline" onClick={() => navigate("/hosts")}>
          返回主机管理
        </button>
      </div>
    </main>
  )
}
