import { lazy, Suspense, useEffect, useState } from "react"
import { navigate } from "@/router/navigation"

const HostsPage = lazy(() => import("@/pages/hosts"))
const WorkspacePage = lazy(() => import("@/pages/workspace"))
const routes = { "/": HostsPage, "/hosts": HostsPage }

function PendingPage() {
  return <main className="grid min-h-svh place-items-center text-sm text-muted-foreground">加载中...</main>
}

export function AppRouter() {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const handleNavigation = () => setPath(window.location.pathname)
    window.addEventListener("popstate", handleNavigation)
    return () => window.removeEventListener("popstate", handleNavigation)
  }, [])
  const Page = routes[path as keyof typeof routes]
  if (Page) return <Suspense fallback={<PendingPage />}><Page /></Suspense>
  const workspaceMatch = path.match(/^\/workspace\/(\d+)$/)
  if (workspaceMatch) return <Suspense fallback={<PendingPage />}><WorkspacePage hostId={Number(workspaceMatch[1])} /></Suspense>
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
