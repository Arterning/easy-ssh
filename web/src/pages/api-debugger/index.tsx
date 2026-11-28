import { useMemo, useState } from "react"
import { Activity, Bot, Braces, Clock3, Database, FilePlus2, Folder, History, Network, Play, Save, Server, Settings, Trash2, Upload, X } from "lucide-react"
import { sendDebugRequest, type DebugHeader, type DebugResponse } from "@/api/debugger"
import { Button } from "@/components/ui/button"
import { storage } from "@/lib/storage"
import { navigate } from "@/router/navigation"

type DebugItem = { id: string; name: string; method: string; url: string; headers: DebugHeader[]; body: string; createdAt: number }
type Row = { key: string; value: string; enabled: boolean }
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
const blankRows = (): Row[] => [{ key: "", value: "", enabled: true }]
const loadList = (key: string): DebugItem[] => { try { return JSON.parse(storage.getItem(key) || "[]") as DebugItem[] } catch { return [] } }
const redacted = (headers: DebugHeader[]) => headers.map((header) => /^(authorization|proxy-authorization|cookie|set-cookie)$/i.test(header.key) ? { ...header, value: "" } : header)

export function ApiDebuggerPage() {
  const [method, setMethod] = useState("GET")
  const [url, setUrl] = useState("")
  const [headers, setHeaders] = useState<Row[]>(blankRows())
  const [params, setParams] = useState<Row[]>(blankRows())
  const [body, setBody] = useState("")
  const [auth, setAuth] = useState("none")
  const [authValue, setAuthValue] = useState("")
  const [authPassword, setAuthPassword] = useState("")
  const [activeTab, setActiveTab] = useState("Params")
  const [responseTab, setResponseTab] = useState("Body")
  const [response, setResponse] = useState<DebugResponse | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [saved, setSaved] = useState<DebugItem[]>(() => loadList("debugger.saved"))
  const [history, setHistory] = useState<DebugItem[]>(() => loadList("debugger.history"))
  const [curlOpen, setCurlOpen] = useState(false)
  const [curl, setCurl] = useState("")
  const [curlError, setCurlError] = useState("")

  const activeParams = useMemo(() => params.filter((item) => item.enabled && item.key), [params])
  function updateRows(setter: (rows: Row[]) => void, rows: Row[], index: number, field: keyof Row, value: string | boolean) {
    setter(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row))
  }
  function setRequest(item: DebugItem) {
    setMethod(item.method); setUrl(item.url); setHeaders(item.headers.map((header) => ({ ...header }))); setBody(item.body); setResponse(null); setError("")
    setParams(parseParams(item.url))
  }
  function saveRequest() {
    if (!url.trim()) return
    let pathname = url
    try { pathname = new URL(url).pathname || "/" } catch { /* Keep the entered URL visible in the saved item name. */ }
    const entry: DebugItem = { id: crypto.randomUUID(), name: `${method} ${pathname}`, method, url, headers: redacted(headers), body, createdAt: Date.now() }
    const next = [entry, ...saved]
    setSaved(next); storage.setItem("debugger.saved", JSON.stringify(next)); setNotice("请求已保存；认证和 Cookie 值不会保存。")
  }
  function saveHistory(entry: DebugItem) {
    const next = [entry, ...history.filter((item) => item.method !== entry.method || item.url !== entry.url)].slice(0, 50)
    setHistory(next); storage.setItem("debugger.history", JSON.stringify(next))
  }
  async function send() {
    setError(""); setNotice(""); setResponse(null)
    let target: URL
    try { target = new URL(url) } catch { setError("请输入完整 URL，例如 https://api.example.com/users"); return }
    if (!/^https?:$/.test(target.protocol)) { setError("目前只支持 HTTP 和 HTTPS 地址。"); return }
    target.search = ""
    for (const item of activeParams) target.searchParams.append(item.key, item.value)
    const requestHeaders: Record<string, string> = {}
    headers.filter((item) => item.enabled && item.key.trim()).forEach((item) => { requestHeaders[item.key.trim()] = item.value })
    if (auth === "bearer" && authValue) requestHeaders.Authorization = `Bearer ${authValue}`
    if (auth === "basic" && authValue) requestHeaders.Authorization = `Basic ${btoa(`${authValue}:${authPassword}`)}`
    setSending(true)
    try {
      const result = await sendDebugRequest({ method, url: target.toString(), headers: requestHeaders, body: ["GET", "HEAD"].includes(method) ? "" : body, timeoutSec: 30 })
      setResponse(result)
      saveHistory({ id: crypto.randomUUID(), name: `${method} ${target.pathname}`, method, url: target.toString(), headers: redacted(headers), body, createdAt: Date.now() })
    } catch (reason) { setError((reason as Error).message) } finally { setSending(false) }
  }
  function importCurl() {
    setCurlError("")
    try {
      const parsed = parseCurl(curl)
      setMethod(parsed.method); setUrl(parsed.url); setHeaders(parsed.headers.length ? parsed.headers : blankRows()); setBody(parsed.body); setParams(parseParams(parsed.url)); setResponse(null); setActiveTab("Headers"); setCurlOpen(false); setCurl("")
      if (parsed.warnings.length) setNotice(`已导入请求。未处理的选项：${parsed.warnings.join(", ")}`)
      else setNotice("cURL 已解析并填入请求；检查后再发送。")
    } catch (reason) { setCurlError((reason as Error).message) }
  }
  function removeItem(list: "saved" | "history", id: string) {
    if (list === "saved") { const next = saved.filter((item) => item.id !== id); setSaved(next); storage.setItem("debugger.saved", JSON.stringify(next)) }
    else { const next = history.filter((item) => item.id !== id); setHistory(next); storage.setItem("debugger.history", JSON.stringify(next)) }
  }

  return <div className="flex min-h-svh bg-muted/25 text-foreground">
    <aside className="fixed inset-y-0 left-0 z-20 flex w-[228px] flex-col border-r bg-sidebar px-3 py-4">
      <div className="flex h-10 items-center gap-2.5 px-2"><div className="grid size-8 place-items-center rounded-lg bg-foreground text-background"><Network className="size-4" /></div><div><div className="text-sm font-semibold">EasySSH</div><div className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">Ops workspace</div></div></div>
      <nav className="mt-7 space-y-1 text-sm"><NavItem icon={<Server />} label="主机" path="/hosts" /><NavItem icon={<Activity />} label="服务" path="/services" /><NavItem icon={<Database />} label="数据库" path="/databases" /><NavItem icon={<Network />} label="接口调试" active /><NavItem icon={<Bot />} label="智能助手" path="/assistant" /><NavItem icon={<Settings />} label="设置" path="/settings" /></nav>
      <div className="mt-7 min-h-0 flex-1 overflow-y-auto border-t pt-4"><div className="mb-2 flex items-center gap-2 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"><Folder className="size-3.5" />已保存</div>{saved.map((item) => <RequestItem key={item.id} item={item} onClick={() => setRequest(item)} onRemove={() => removeItem("saved", item.id)} />)}{saved.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">保存常用请求后会显示在这里。</p>}<div className="mb-2 mt-5 flex items-center gap-2 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"><History className="size-3.5" />最近请求</div>{history.slice(0, 20).map((item) => <RequestItem key={item.id} item={item} onClick={() => setRequest(item)} onRemove={() => removeItem("history", item.id)} />)}</div>
    </aside>
    <main className="ml-[228px] flex min-h-svh min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background/80 px-7"><div><div className="text-sm font-semibold">接口调试</div><p className="mt-0.5 text-xs text-muted-foreground">发送 HTTP 请求、导入浏览器复制的 cURL，并检查响应。</p></div><Button variant="outline" onClick={() => { setMethod("GET"); setUrl(""); setHeaders(blankRows()); setParams(blankRows()); setBody(""); setResponse(null); setError("") }}><FilePlus2 />新建请求</Button></header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
        {(error || notice) && <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${error ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}><span>{error || notice}</span><button onClick={() => { setError(""); setNotice("") }}><X className="size-4" /></button></div>}
        <section className="rounded-xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-center gap-2 p-3"><select className="h-10 w-28 rounded-lg border bg-background px-2 text-sm font-semibold" value={method} onChange={(event) => setMethod(event.target.value)}>{methods.map((item) => <option key={item}>{item}</option>)}</select><input className="h-10 min-w-48 flex-1 rounded-lg border bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/20" placeholder="https://api.example.com/v1/users" value={url} onChange={(event) => { setUrl(event.target.value); setParams(parseParams(event.target.value)) }} onKeyDown={(event) => event.key === "Enter" && void send()} /><Button variant="outline" onClick={() => setCurlOpen(true)}><Upload />导入 cURL</Button><Button onClick={() => void send()} disabled={sending || !url.trim()}>{sending ? <Activity className="animate-pulse" /> : <Play />}发送</Button></div>
          <div className="flex gap-1 border-t px-3 pt-2">{["Params", "Headers", "Body", "Auth"].map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-t-md px-3 py-2 text-sm ${activeTab === tab ? "border border-b-background bg-background font-medium" : "text-muted-foreground hover:bg-muted"}`}>{tab}{tab === "Params" ? ` (${activeParams.length})` : tab === "Headers" ? ` (${headers.filter((item) => item.enabled && item.key).length})` : ""}</button>)}</div>
          <div className="min-h-44 border-t p-3">
            {activeTab === "Params" && <KeyValueEditor rows={params} setRows={setParams} onChange={updateRows} />}
            {activeTab === "Headers" && <KeyValueEditor rows={headers} setRows={setHeaders} onChange={updateRows} />}
            {activeTab === "Body" && <div className="space-y-2"><div className="text-xs text-muted-foreground">Raw body · GET 和 HEAD 请求会忽略请求体</div><textarea className="min-h-36 w-full resize-y rounded-lg border bg-background p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/20" placeholder={'{\n  "name": "EasySSH"\n}'} value={body} onChange={(event) => setBody(event.target.value)} /></div>}
            {activeTab === "Auth" && <div className="grid max-w-2xl gap-3 sm:grid-cols-[180px_1fr_1fr]"><label className="text-xs text-muted-foreground">认证类型<select className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-sm text-foreground" value={auth} onChange={(event) => setAuth(event.target.value)}><option value="none">No Auth</option><option value="bearer">Bearer Token</option><option value="basic">Basic Auth</option></select></label>{auth !== "none" && <label className="text-xs text-muted-foreground">{auth === "basic" ? "用户名" : "Token"}<input className="mt-1 h-9 w-full rounded-lg border bg-background px-3 text-sm text-foreground" type={auth === "bearer" ? "password" : "text"} value={authValue} onChange={(event) => setAuthValue(event.target.value)} /></label>}{auth === "basic" && <label className="text-xs text-muted-foreground">密码<input className="mt-1 h-9 w-full rounded-lg border bg-background px-3 text-sm text-foreground" type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /></label>}</div>}
          </div>
          <div className="flex justify-end border-t px-3 py-2"><Button variant="ghost" size="sm" onClick={saveRequest} disabled={!url.trim()}><Save />保存请求</Button></div>
        </section>
        <section className="flex min-h-64 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-sm"><div className="flex flex-wrap items-center gap-3 border-b px-4 py-3"><div className="text-sm font-semibold">响应</div>{response && <><span className={`rounded px-2 py-1 text-xs font-semibold ${response.status < 400 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-700 dark:text-red-300"}`}>{response.status} {response.statusText}</span><span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3.5" />{response.durationMs} ms</span><span className="text-xs text-muted-foreground">{formatSize(response.size)}{response.truncated ? " · 已截断至 8 MiB" : ""}</span></>}</div>{response ? <><div className="flex gap-1 border-b px-3 pt-2">{["Body", "Headers"].map((tab) => <button key={tab} onClick={() => setResponseTab(tab)} className={`rounded-t-md px-3 py-2 text-xs ${responseTab === tab ? "border border-b-background bg-background font-medium" : "text-muted-foreground hover:bg-muted"}`}>{tab}</button>)}</div><div className="min-h-0 flex-1 overflow-auto p-4">{responseTab === "Body" ? <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">{formatBody(response.body, response.headers["Content-Type"] || response.headers["content-type"] || "")}</pre> : <div className="space-y-1 font-mono text-xs">{Object.entries(response.headers).map(([key, value]) => <div key={key} className="grid gap-2 sm:grid-cols-[220px_1fr]"><span className="font-semibold">{key}</span><span className="break-all text-muted-foreground">{value}</span></div>)}</div>}</div></> : <div className="grid min-h-56 flex-1 place-items-center text-center text-sm text-muted-foreground"><div><Braces className="mx-auto mb-2 size-7 opacity-50" /><p>发送请求后，响应会显示在这里。</p></div></div>}</section>
      </div>
    </main>
    {curlOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onMouseDown={(event) => event.target === event.currentTarget && setCurlOpen(false)}><section className="w-full max-w-2xl rounded-xl border bg-background shadow-2xl"><div className="flex items-start justify-between border-b px-5 py-4"><div><h2 className="font-semibold">导入 cURL</h2><p className="mt-1 text-xs text-muted-foreground">粘贴浏览器开发者工具复制的命令。解析后会回填表单，不会自动发送。</p></div><Button variant="ghost" size="icon-sm" onClick={() => setCurlOpen(false)}><X /></Button></div><div className="space-y-3 p-5"><textarea autoFocus className="min-h-44 w-full rounded-lg border bg-background p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/20" placeholder="curl 'https://api.example.com/users' -H 'accept: application/json'" value={curl} onChange={(event) => setCurl(event.target.value)} />{curlError && <p className="text-sm text-destructive">{curlError}</p>}<p className="text-xs text-muted-foreground">支持 URL、方法、Headers、Basic Auth 和常见请求体参数。未知选项会提示但不会阻止导入。</p></div><div className="flex justify-end gap-2 border-t px-5 py-3"><Button variant="ghost" onClick={() => setCurlOpen(false)}>取消</Button><Button onClick={importCurl} disabled={!curl.trim()}><Upload />解析并填入</Button></div></section></div>}
  </div>
}

function NavItem({ icon, label, path, active = false }: { icon: React.ReactNode; label: string; path?: string; active?: boolean }) {
  return <button onClick={() => path && navigate(path)} className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 transition ${active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}><span className="[&_svg]:size-4">{icon}</span>{label}</button>
}

function RequestItem({ item, onClick, onRemove }: { item: DebugItem; onClick: () => void; onRemove: () => void }) {
  return <div className="group flex items-center gap-1 rounded-md hover:bg-sidebar-accent"><button onClick={onClick} className="min-w-0 flex-1 px-2 py-2 text-left"><span className={`mr-2 text-[9px] font-bold ${item.method === "GET" ? "text-emerald-600" : item.method === "POST" ? "text-amber-600" : "text-blue-600"}`}>{item.method}</span><span className="block truncate text-xs">{item.name}</span></button><button onClick={onRemove} aria-label="删除请求" className="mr-1 hidden rounded p-1 text-muted-foreground hover:bg-muted group-hover:block"><Trash2 className="size-3" /></button></div>
}

function KeyValueEditor({ rows, setRows, onChange }: { rows: Row[]; setRows: (rows: Row[]) => void; onChange: (setter: (rows: Row[]) => void, rows: Row[], index: number, field: keyof Row, value: string | boolean) => void }) {
  return <div className="space-y-2"><div className="grid grid-cols-[32px_1fr_1.4fr_32px] gap-2 px-2 text-[10px] font-medium text-muted-foreground uppercase"><span></span><span>Key</span><span>Value</span><span></span></div>{rows.map((row, index) => <div key={index} className="grid grid-cols-[32px_1fr_1.4fr_32px] gap-2"><input type="checkbox" checked={row.enabled} onChange={(event) => onChange(setRows, rows, index, "enabled", event.target.checked)} /><input className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs" placeholder="Key" value={row.key} onChange={(event) => onChange(setRows, rows, index, "key", event.target.value)} /><input className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs" placeholder="Value" value={row.value} onChange={(event) => onChange(setRows, rows, index, "value", event.target.value)} /><button onClick={() => setRows(rows.length === 1 ? blankRows() : rows.filter((_, rowIndex) => rowIndex !== index))} aria-label="移除行" className="grid place-items-center rounded text-muted-foreground hover:bg-muted"><X className="size-4" /></button></div>)}<Button variant="ghost" size="sm" onClick={() => setRows([...rows, { key: "", value: "", enabled: true }])}>+ 添加一行</Button></div>
}

function parseParams(rawUrl: string): Row[] {
  try { const url = new URL(rawUrl); const entries = [...url.searchParams.entries()]; return entries.length ? [...entries.map(([key, value]) => ({ key, value, enabled: true })), { key: "", value: "", enabled: true }] : blankRows() } catch { return blankRows() }
}

function shellTokens(input: string): string[] {
  const tokens: string[] = []
  const chars = [...input.trim()]
  let token = "", quote = "", escaping = false, started = false, ansiQuote = false
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index]
    if (escaping) {
      token += ansiQuote ? ({ n: "\n", r: "\r", t: "\t" }[char] ?? char) : char
      escaping = false; started = true; continue
    }
    if (!quote && char === "$" && chars[index + 1] === "'") {
      quote = "'"; ansiQuote = true; started = true; index++; continue
    }
    if (ansiQuote && char === "\\") { escaping = true; started = true; continue }
    if (char === "\\" && quote !== "'") { escaping = true; started = true; continue }
    if (quote) {
      if (char === quote) { quote = ""; ansiQuote = false }
      else token += char
      started = true; continue
    }
    if (char === "'" || char === '"') { quote = char; started = true; continue }
    if (/\s/.test(char)) { if (started) { tokens.push(token); token = ""; started = false }; continue }
    token += char; started = true
  }
  if (escaping) token += "\\"
  if (quote) throw new Error("命令中有未闭合的引号。")
  if (started) tokens.push(token)
  return tokens
}

function parseCurl(input: string) {
  const tokens = shellTokens(input.replace(/\\\r?\n/g, " "))
  if (!tokens.length || !["curl", "curl.exe"].includes(tokens[0].toLowerCase())) throw new Error("请粘贴以 curl 开头的命令。")
  let method = "GET", methodExplicit = false, url = "", body = "", forceGet = false
  const headers: Row[] = [], warnings: string[] = []
  const takesValue = new Set(["-X", "--request", "-H", "--header", "-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "-u", "--user", "--url", "-b", "--cookie"])
  for (let i = 1; i < tokens.length; i++) {
    const arg = tokens[i]
    if (arg === "--") { url = url || tokens[i + 1] || ""; break }
    if (takesValue.has(arg)) {
      const value = tokens[++i]
      if (value === undefined) throw new Error(`${arg} 后缺少参数。`)
      if (arg === "-X" || arg === "--request") { method = value.toUpperCase(); methodExplicit = true }
      else if (arg === "--url") url = value
      else if (["-d", "--data", "--data-raw", "--data-binary", "--data-urlencode"].includes(arg)) { body = body ? `${body}&${value}` : value; if (!methodExplicit) method = "POST" }
      else if (arg === "-H" || arg === "--header") { const split = value.indexOf(":"); if (split > 0) headers.push({ key: value.slice(0, split).trim(), value: value.slice(split + 1).trim(), enabled: true }); else warnings.push(arg) }
      else if (arg === "-u" || arg === "--user") { const split = value.indexOf(":"); headers.push({ key: "Authorization", value: `Basic ${btoa(split < 0 ? `${value}:` : `${value.slice(0, split)}:${value.slice(split + 1)}`)}`, enabled: true }) }
      else if (arg === "-b" || arg === "--cookie") headers.push({ key: "Cookie", value, enabled: true })
      continue
    }
    if (arg === "-G" || arg === "--get") { forceGet = true; continue }
    if (arg === "-I" || arg === "--head") { method = "HEAD"; continue }
    if (["-L", "--location", "-s", "--silent", "-S", "--show-error", "-k", "--insecure", "--compressed", "-i", "--include", "-v", "--verbose"].includes(arg)) { if (arg === "-L" || arg === "--location") warnings.push("redirects"); continue }
    if (arg.startsWith("-")) { warnings.push(arg); if (/^-{1,2}(output|max-time|connect-timeout|user-agent|referer)$/.test(arg) && tokens[i + 1]) i++; continue }
    if (!url) url = arg
  }
  if (!url) throw new Error("没有找到请求 URL。")
  if (body && method === "GET" && !forceGet) method = "POST"
  if (forceGet && body) { const target = new URL(url); new URLSearchParams(body).forEach((value, key) => target.searchParams.append(key, value)); url = target.toString(); body = ""; method = "GET" }
  return { method, url, body, headers: [...headers, { key: "", value: "", enabled: true }], warnings: [...new Set(warnings)] }
}

function formatBody(body: string, contentType: string) { if (/json/i.test(contentType)) { try { return JSON.stringify(JSON.parse(body), null, 2) } catch { return body } }; return body }
function formatSize(size: number) { return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB` }

export default ApiDebuggerPage
