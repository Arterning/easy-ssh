import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  Bot,
  CheckCircle2,
  CirclePause,
  Clock3,
  Database,
  ExternalLink,
  Gauge,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react"

import { hostsApi, type Host } from "@/api/hosts"
import {
  servicesApi,
  type Service,
  type ServiceCheck,
  type ServiceInput,
  type ServiceStatus,
} from "@/api/services"
import { Button } from "@/components/ui/button"
import { navigate } from "@/router/navigation"

const emptyService: ServiceInput = {
  name: "",
  url: "",
  method: "GET",
  intervalSec: 60,
  timeoutSec: 10,
  expectedStatus: "200-299",
  keyword: "",
  followRedirects: true,
  maxLatencyMs: 2000,
  enabled: true,
  group: "",
  hostId: null,
}
const inputClass =
  "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"

export function ServicesPage() {
  const [services, setServices] = useState<Service[]>([])
  const [hosts, setHosts] = useState<Host[]>([])
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<"all" | ServiceStatus>("all")
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState("")
  const [editor, setEditor] = useState<Service | null | "new">(null)
  const [draft, setDraft] = useState<ServiceInput>(emptyService)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState<number | null>(null)
  const [details, setDetails] = useState<number | null>(null)
  const [checks, setChecks] = useState<ServiceCheck[]>([])
  useEffect(() => {
    servicesApi
      .list()
      .then(setServices)
      .catch((reason: Error) => setError(reason.message))
    hostsApi
      .list()
      .then(setHosts)
      .catch(() => undefined)
    const events = new EventSource(servicesApi.eventsUrl)
    events.onopen = () => setConnected(true)
    events.onerror = () => setConnected(false)
    events.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data)
        if (update.type === "service")
          setServices((items) =>
            items.some((item) => item.id === update.service.id)
              ? items.map((item) =>
                  item.id === update.service.id ? update.service : item
                )
              : [update.service, ...items]
          )
        if (update.type === "deleted")
          setServices((items) => items.filter((item) => item.id !== update.id))
      } catch {
        /* ignore malformed event */
      }
    }
    return () => events.close()
  }, [])
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return services
      .filter(
        (service) =>
          (filter === "all" || service.status === filter) &&
          (!needle ||
            [service.name, service.url, service.group]
              .join(" ")
              .toLowerCase()
              .includes(needle))
      )
      .sort(
        (a, b) =>
          statusWeight(a.status) - statusWeight(b.status) ||
          a.name.localeCompare(b.name)
      )
  }, [filter, query, services])
  function openEditor(service?: Service) {
    if (service) {
      setEditor(service)
      setDraft({
        name: service.name,
        url: service.url,
        method: service.method,
        intervalSec: service.intervalSec,
        timeoutSec: service.timeoutSec,
        expectedStatus: service.expectedStatus,
        keyword: service.keyword,
        followRedirects: service.followRedirects,
        maxLatencyMs: service.maxLatencyMs,
        enabled: service.enabled,
        group: service.group,
        hostId: service.hostId,
      })
    } else {
      setEditor("new")
      setDraft(emptyService)
    }
    setError("")
  }
  async function save() {
    if (!draft.name.trim() || !draft.url.trim() || saving) return
    setSaving(true)
    setError("")
    try {
      const saved =
        editor === "new"
          ? await servicesApi.create(draft)
          : await servicesApi.update((editor as Service).id, draft)
      setServices((items) =>
        items.some((item) => item.id === saved.id)
          ? items.map((item) => (item.id === saved.id ? saved : item))
          : [saved, ...items]
      )
      setEditor(null)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }
  async function checkNow(id: number) {
    setChecking(id)
    setError("")
    try {
      const updated = await servicesApi.check(id)
      setServices((items) =>
        items.map((item) => (item.id === id ? updated : item))
      )
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setChecking(null)
    }
  }
  async function remove(service: Service) {
    if (!window.confirm(`确认删除服务“${service.name}”及其检查历史？`)) return
    try {
      await servicesApi.remove(service.id)
      setServices((items) => items.filter((item) => item.id !== service.id))
    } catch (reason) {
      setError((reason as Error).message)
    }
  }
  async function showDetails(id: number) {
    if (details === id) {
      setDetails(null)
      return
    }
    setDetails(id)
    try {
      setChecks(await servicesApi.checks(id))
    } catch (reason) {
      setError((reason as Error).message)
    }
  }
  const counts = (status: ServiceStatus) =>
    services.filter((service) => service.status === status).length
  return (
    <div className="flex min-h-svh bg-muted/25 text-foreground">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-[228px] flex-col border-r bg-sidebar px-3 py-4">
        <Brand />
        <nav className="mt-7 space-y-1 text-sm">
          <Nav
            icon={<Server />}
            label="主机"
            onClick={() => navigate("/hosts")}
          />
          <Nav active icon={<Activity />} label="服务" />
          <Nav
            icon={<Database />}
            label="数据库"
            onClick={() => navigate("/databases")}
          />
          <Nav
            icon={<Bot />}
            label="智能助手"
            onClick={() => navigate("/assistant")}
          />
        </nav>
        <div className="mt-auto px-3 py-3 text-[11px] text-muted-foreground">
          <span
            className={`mr-2 inline-block size-2 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-500"}`}
          />
          {connected ? "实时状态已连接" : "实时状态重连中"}
        </div>
      </aside>
      <main className="ml-[228px] min-h-svh flex-1">
        <header className="flex h-16 items-center border-b bg-background/80 px-8">
          <div className="text-sm text-muted-foreground">
            工作空间 <span className="mx-2">/</span>
            <span className="font-medium text-foreground">服务</span>
          </div>
          <Button className="ml-auto" onClick={() => openEditor()}>
            <Plus />
            添加服务
          </Button>
        </header>
        <div className="mx-auto max-w-[1440px] px-8 py-7">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold">服务监控</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              轻量检查 HTTP/HTTPS 服务的可用性与响应速度。
            </p>
          </div>
          <div className="mb-5 grid grid-cols-4 gap-3">
            <Stat label="正常" value={counts("up")} color="text-emerald-600" />
            <Stat label="异常" value={counts("down")} color="text-red-600" />
            <Stat
              label="响应缓慢"
              value={counts("degraded")}
              color="text-amber-600"
            />
            <Stat
              label="暂停/未检测"
              value={counts("paused") + counts("unknown")}
              color="text-muted-foreground"
            />
          </div>
          {error && (
            <div className="mb-4 flex items-center justify-between rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <span>{error}</span>
              <button onClick={() => setError("")}>
                <X className="size-4" />
              </button>
            </div>
          )}
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="flex items-center gap-2 border-b p-3">
              <div className="relative max-w-md min-w-72 flex-1">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className={`${inputClass} pl-9`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索名称、URL 或分组..."
                />
              </div>
              <select
                className="h-9 rounded-lg border bg-background px-3 text-sm"
                value={filter}
                onChange={(e) => setFilter(e.target.value as typeof filter)}
              >
                <option value="all">全部状态</option>
                <option value="up">正常</option>
                <option value="degraded">响应缓慢</option>
                <option value="down">异常</option>
                <option value="unknown">未检测</option>
                <option value="paused">已暂停</option>
              </select>
            </div>
            {shown.length === 0 ? (
              <div className="grid min-h-72 place-items-center text-center">
                <div>
                  <Activity className="mx-auto size-9 text-muted-foreground/40" />
                  <div className="mt-3 font-medium">没有服务</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    添加一个 HTTP 或 HTTPS 地址开始监控。
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y">
                {shown.map((service) => (
                  <div key={service.id}>
                    <div className="flex items-center gap-4 px-5 py-4">
                      <StatusIcon status={service.status} />
                      <button
                        onClick={() => void showDetails(service.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{service.name}</span>
                          {service.group && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {service.group}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          {service.method} {service.url}
                        </div>
                        {service.consecutiveFailures > 0 &&
                          service.status !== "down" && (
                            <div className="mt-1 text-xs text-amber-600">
                              最近检测失败 {service.consecutiveFailures}/3 次
                            </div>
                          )}
                        {service.lastError && service.status === "down" && (
                          <div className="mt-1 truncate text-xs text-red-600">
                            {service.lastError}
                          </div>
                        )}
                      </button>
                      <div className="w-24 text-right text-xs">
                        <div>{service.lastHttpStatus || "—"}</div>
                        <div className="mt-1 text-muted-foreground">
                          {service.lastLatencyMs
                            ? `${service.lastLatencyMs} ms`
                            : "—"}
                        </div>
                      </div>
                      <div className="w-32 text-right text-xs text-muted-foreground">
                        {service.lastCheckedAt
                          ? relativeTime(service.lastCheckedAt)
                          : "尚未检查"}
                        <div className="mt-1">
                          每 {formatInterval(service.intervalSec)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {service.hostId && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title="打开关联主机"
                            onClick={() =>
                              window.open(
                                `/workspace/${service.hostId}`,
                                "_blank",
                                "noopener,noreferrer"
                              )
                            }
                          >
                            <Server />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="立即检查"
                          disabled={!service.enabled || checking === service.id}
                          onClick={() => void checkNow(service.id)}
                        >
                          {checking === service.id ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <RefreshCw />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="编辑"
                          onClick={() => openEditor(service)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="删除"
                          onClick={() => void remove(service)}
                        >
                          <Trash2 />
                        </Button>
                        <a
                          href={service.url}
                          target="_blank"
                          rel="noreferrer"
                          className="grid size-8 place-items-center rounded-md hover:bg-muted"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      </div>
                    </div>
                    {details === service.id && <History checks={checks} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      {editor && (
        <ServiceEditor
          draft={draft}
          setDraft={setDraft}
          hosts={hosts}
          editing={editor !== "new"}
          saving={saving}
          error={error}
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}
    </div>
  )
}

function Brand() {
  return (
    <div className="flex h-10 items-center gap-2.5 px-2">
      <div className="grid size-8 place-items-center rounded-lg bg-foreground text-background">
        <Activity className="size-4" />
      </div>
      <div>
        <div className="text-sm font-semibold">EasySSH</div>
        <div className="text-[10px] tracking-[.18em] text-muted-foreground uppercase">
          Ops workspace
        </div>
      </div>
    </div>
  )
}
function Nav({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 ${active ? "bg-sidebar-accent font-medium" : "text-muted-foreground hover:bg-sidebar-accent"}`}
    >
      <span className="[&_svg]:size-4">{icon}</span>
      {label}
    </button>
  )
}
function Stat({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  )
}
function StatusIcon({ status }: { status: ServiceStatus }) {
  const config = {
    up: ["bg-emerald-500/10", "text-emerald-600", <CheckCircle2 />],
    degraded: ["bg-amber-500/10", "text-amber-600", <Gauge />],
    down: ["bg-red-500/10", "text-red-600", <TriangleAlert />],
    paused: ["bg-slate-500/10", "text-slate-500", <CirclePause />],
    checking: [
      "bg-blue-500/10",
      "text-blue-500",
      <LoaderCircle className="animate-spin" />,
    ],
    unknown: ["bg-slate-500/10", "text-slate-400", <Clock3 />],
  }[status]
  return (
    <div
      className={`grid size-9 shrink-0 place-items-center rounded-full ${config[0]} ${config[1]} [&_svg]:size-4`}
    >
      {config[2]}
    </div>
  )
}
function History({ checks }: { checks: ServiceCheck[] }) {
  return (
    <div className="border-t bg-muted/20 px-16 py-3">
      <div className="mb-2 text-xs font-medium">最近检查</div>
      <div className="flex gap-1">
        {checks
          .slice(0, 30)
          .reverse()
          .map((check) => (
            <span
              key={check.ID}
              title={`${new Date(check.CheckedAt).toLocaleString()} · ${check.HTTPStatus || check.Error}`}
              className={`h-6 flex-1 rounded-sm ${check.Status === "up" ? "bg-emerald-500" : check.Status === "degraded" ? "bg-amber-500" : "bg-red-500"}`}
            />
          ))}
      </div>
      {checks.length === 0 && (
        <div className="text-xs text-muted-foreground">暂无检查记录</div>
      )}
    </div>
  )
}
function ServiceEditor({
  draft,
  setDraft,
  hosts,
  editing,
  saving,
  error,
  onClose,
  onSave,
}: {
  draft: ServiceInput
  setDraft: React.Dispatch<React.SetStateAction<ServiceInput>>
  hosts: Host[]
  editing: boolean
  saving: boolean
  error: string
  onClose: () => void
  onSave: () => void
}) {
  const update = <K extends keyof ServiceInput>(
    key: K,
    value: ServiceInput[K]
  ) => setDraft((current) => ({ ...current, [key]: value }))
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-background shadow-2xl">
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <h2 className="font-semibold">
              {editing ? "编辑服务" : "添加服务"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              定时检查 HTTP/HTTPS 地址及其响应。
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="grid gap-4 p-6 sm:grid-cols-2">
          <Field label="服务名称 *">
            <input
              className={inputClass}
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="用户中心 API"
            />
          </Field>
          <Field label="分组">
            <input
              className={inputClass}
              value={draft.group}
              onChange={(e) => update("group", e.target.value)}
              placeholder="生产环境"
            />
          </Field>
          <Field label="URL *" wide>
            <input
              className={inputClass}
              value={draft.url}
              onChange={(e) => update("url", e.target.value)}
              placeholder="https://api.example.com/health"
            />
          </Field>
          <Field label="请求方法">
            <select
              className={inputClass}
              value={draft.method}
              onChange={(e) =>
                update("method", e.target.value as "GET" | "HEAD")
              }
            >
              <option>GET</option>
              <option>HEAD</option>
            </select>
          </Field>
          <Field label="预期状态码">
            <input
              className={inputClass}
              value={draft.expectedStatus}
              onChange={(e) => update("expectedStatus", e.target.value)}
              placeholder="200-299 或 200,204"
            />
          </Field>
          <Field label="检查间隔（秒）">
            <input
              type="number"
              min={10}
              max={86400}
              className={inputClass}
              value={draft.intervalSec}
              onChange={(e) => update("intervalSec", Number(e.target.value))}
            />
          </Field>
          <Field label="超时（秒）">
            <input
              type="number"
              min={1}
              max={60}
              className={inputClass}
              value={draft.timeoutSec}
              onChange={(e) => update("timeoutSec", Number(e.target.value))}
            />
          </Field>
          <Field label="响应缓慢阈值（毫秒）">
            <input
              type="number"
              min={0}
              className={inputClass}
              value={draft.maxLatencyMs}
              onChange={(e) => update("maxLatencyMs", Number(e.target.value))}
            />
          </Field>
          <Field label="响应关键字（可选）">
            <input
              disabled={draft.method === "HEAD"}
              className={inputClass}
              value={draft.keyword}
              onChange={(e) => update("keyword", e.target.value)}
              placeholder="ok"
            />
          </Field>
          <Field label="关联主机（可选）" wide>
            <select
              className={inputClass}
              value={draft.hostId ?? ""}
              onChange={(e) =>
                update("hostId", e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">不关联</option>
              {hosts.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.name} · {host.address}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.followRedirects}
              onChange={(e) => update("followRedirects", e.target.checked)}
            />
            跟随 HTTP 重定向
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => update("enabled", e.target.checked)}
            />
            启用定时检查
          </label>
          {error && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive sm:col-span-2">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={onSave}
            disabled={saving || !draft.name.trim() || !draft.url.trim()}
          >
            {saving && <LoaderCircle className="animate-spin" />}保存服务
          </Button>
        </div>
      </div>
    </div>
  )
}
function Field({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={wide ? "sm:col-span-2" : ""}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}
function statusWeight(status: ServiceStatus) {
  return { down: 0, degraded: 1, unknown: 2, up: 3, checking: 4, paused: 5 }[
    status
  ]
}
function relativeTime(value: string) {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000)
  )
  if (seconds < 60) return `${seconds} 秒前`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  return `${Math.floor(seconds / 3600)} 小时前`
}
function formatInterval(value: number) {
  if (value < 60) return `${value} 秒`
  if (value % 60 === 0) return `${value / 60} 分钟`
  return `${value} 秒`
}

export default ServicesPage
