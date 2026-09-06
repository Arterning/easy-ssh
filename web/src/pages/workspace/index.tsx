import { useEffect, useRef, useState } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import {
  ArrowLeft,
  Bot,
  Circle,
  PanelRightClose,
  PanelRightOpen,
  Plug,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  TerminalSquare,
  Unplug,
  X,
} from "lucide-react"

import { hostsApi, type Host } from "@/api/hosts"
import { agentApi, type AgentTask } from "@/api/agent"
import { Button } from "@/components/ui/button"
import { navigate } from "@/router/navigation"

type ConnectionStatus = "idle" | "connecting" | "connected" | "error"
const apiBase =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080/api/v1"

export function WorkspacePage({ hostId }: { hostId: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const [host, setHost] = useState<Host | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>("idle")
  const [error, setError] = useState("")
  const [agentOpen, setAgentOpen] = useState(true)

  useEffect(() => {
    hostsApi
      .list()
      .then((items) => {
        const item = items.find((entry) => entry.id === hostId)
        if (item) setHost(item)
        else setError("主机不存在")
      })
      .catch((reason: Error) => setError(reason.message))
  }, [hostId])
  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      lineHeight: 1.25,
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
      scrollback: 8000,
      theme: {
        background: "#0b0e14",
        foreground: "#d8dee9",
        cursor: "#8aadf4",
        selectionBackground: "#334155",
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(containerRef.current)
    terminalRef.current = terminal
    const observer = new ResizeObserver(() => {
      fit.fit()
      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          })
        )
    })
    observer.observe(containerRef.current)
    requestAnimationFrame(() => fit.fit())
    const input = terminal.onData((data) => {
      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "input", data }))
    })
    return () => {
      input.dispose()
      observer.disconnect()
      socketRef.current?.close()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [])

  function connect() {
    if (!host || status === "connecting" || status === "connected") return
    setStatus("connecting")
    setError("")
    const terminal = terminalRef.current
    terminal?.clear()
    terminal?.writeln("\x1b[90m正在建立安全连接...\x1b[0m")
    const url = new URL(`${apiBase}/hosts/${host.id}/terminal`)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    const socket = new WebSocket(url)
    socket.binaryType = "arraybuffer"
    socketRef.current = socket
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data)
          if (message.type === "connected") {
            setStatus("connected")
            terminal?.clear()
            terminal?.focus()
          } else if (message.type === "error") {
            setStatus("error")
            setError(message.message)
            terminal?.writeln(`\r\n\x1b[31m连接失败：${message.message}\x1b[0m`)
          }
        } catch {
          terminal?.write(event.data)
        }
      } else terminal?.write(new Uint8Array(event.data))
    }
    socket.onerror = () => {
      setStatus("error")
      setError("WebSocket 连接失败")
    }
    socket.onclose = () => {
      setStatus((current) => (current === "error" ? "error" : "idle"))
      socketRef.current = null
      terminal?.writeln("\r\n\x1b[90m连接已关闭\x1b[0m")
    }
  }
  function disconnect() {
    socketRef.current?.close()
    socketRef.current = null
    setStatus("idle")
  }

  return (
    <div className="flex h-svh min-w-[1024px] flex-col bg-[#0b0e14] text-slate-200">
      <header className="flex h-14 shrink-0 items-center border-b border-white/10 bg-[#11151d] px-3">
        <Button
          variant="ghost"
          className="text-slate-300 hover:bg-white/10 hover:text-white"
          onClick={() => navigate("/hosts")}
        >
          <ArrowLeft />
          主机
        </Button>
        <div className="mx-3 h-5 w-px bg-white/10" />
        <div className="flex items-center gap-2">
          <Server className="size-4 text-slate-400" />
          <span className="text-sm font-medium">
            {host?.name ?? "加载中..."}
          </span>
          {host && (
            <span className="font-mono text-xs text-slate-500">
              {host.username}@{host.address}:{host.port}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusPill status={status} />
          {status === "connected" ? (
            <Button
              variant="outline"
              className="border-white/10 bg-transparent text-slate-300 hover:bg-white/10"
              onClick={disconnect}
            >
              <Unplug />
              断开
            </Button>
          ) : (
            <Button
              className="bg-blue-500 text-white hover:bg-blue-400"
              onClick={connect}
              disabled={!host || status === "connecting"}
            >
              {status === "connecting" ? (
                <RefreshCw className="animate-spin" />
              ) : (
                <Plug />
              )}
              {status === "connecting" ? "连接中" : "连接"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-400 hover:bg-white/10 hover:text-white"
            onClick={() => setAgentOpen(!agentOpen)}
          >
            {agentOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </div>
      </header>
      {error && (
        <div className="flex items-center justify-between border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          <span>{error}</span>
          <button onClick={() => setError("")}>
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="w-52 shrink-0 border-r border-white/10 bg-[#0f131a] p-3">
          <div className="mb-2 px-2 text-[10px] font-semibold tracking-widest text-slate-600 uppercase">
            终端会话
          </div>
          <button className="flex w-full items-center gap-2 rounded-md bg-white/[0.06] px-2.5 py-2 text-left text-xs">
            <TerminalSquare className="size-3.5 text-blue-400" />
            <span className="flex-1">terminal-1</span>
            <Circle
              className={`size-2 fill-current ${status === "connected" ? "text-emerald-400" : "text-slate-600"}`}
            />
          </button>
          <div className="mt-6 mb-2 px-2 text-[10px] font-semibold tracking-widest text-slate-600 uppercase">
            主机信息
          </div>
          <div className="space-y-2 rounded-lg border border-white/[0.06] p-3 text-[11px] text-slate-500">
            <Info label="地址" value={host?.address ?? "-"} />
            <Info label="用户" value={host?.username ?? "-"} />
            <Info
              label="认证"
              value={host?.authType === "key" ? "SSH 密钥" : "密码"}
            />
          </div>
        </aside>
        <main className="relative min-w-0 flex-1">
          <div className="flex h-9 items-center border-b border-white/[0.07] bg-[#0e1219] px-3 text-xs text-slate-500">
            <TerminalSquare className="mr-2 size-3.5" />
            terminal-1<span className="ml-auto">xterm-256color</span>
          </div>
          <div
            ref={containerRef}
            className="absolute inset-x-0 top-9 bottom-0 p-3"
          />
        </main>
        {agentOpen && (
          <AgentPanel hostId={hostId} connected={status === "connected"} />
        )}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: ConnectionStatus }) {
  const config = {
    idle: ["text-slate-400", "bg-slate-400", "未连接"],
    connecting: ["text-amber-300", "bg-amber-400", "连接中"],
    connected: ["text-emerald-300", "bg-emerald-400", "已连接"],
    error: ["text-red-300", "bg-red-400", "连接失败"],
  }[status]
  return (
    <span
      className={`mr-1 inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1 text-xs ${config[0]}`}
    >
      <span className={`size-1.5 rounded-full ${config[1]}`} />
      {config[2]}
    </span>
  )
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-slate-600">{label}</div>
      <div className="mt-0.5 truncate font-mono text-slate-400">{value}</div>
    </div>
  )
}
function AgentPanel({
  hostId,
  connected,
}: {
  hostId: number
  connected: boolean
}) {
  const [question, setQuestion] = useState("")
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  async function submit() {
    if (!question.trim() || working) return
    setWorking(true)
    setError("")
    const value = question
    setQuestion("")
    try {
      const task = await agentApi.createTask(hostId, value)
      setTasks((items) => [...items, task])
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setWorking(false)
    }
  }
  async function approve(taskId: number) {
    setWorking(true)
    try {
      const task = await agentApi.approve(taskId)
      setTasks((items) =>
        items.map((item) => (item.id === task.id ? task : item))
      )
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setWorking(false)
    }
  }
  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-white/10 bg-[#11151d]">
      <div className="flex h-9 items-center gap-2 border-b border-white/[0.07] px-3 text-xs font-medium">
        <Bot className="size-3.5 text-violet-400" />
        运维 Agent
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tasks.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div>
              <div className="mx-auto grid size-11 place-items-center rounded-xl bg-violet-500/10">
                <ShieldCheck className="size-5 text-violet-400" />
              </div>
              <h3 className="mt-4 text-sm font-medium">让 Agent 协助运维</h3>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                只读操作自动执行，变更操作需要你的确认。
              </p>
              {!connected && (
                <p className="mt-3 text-xs text-amber-400/80">请先连接主机</p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {tasks.map((task) => (
              <div key={task.id}>
                <div className="rounded-lg bg-white/[0.05] p-3 text-xs text-slate-300">
                  {task.question}
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-400">
                  {task.summary}
                </p>
                <div className="mt-2 space-y-2">
                  {task.commands.map((command, index) => (
                    <div
                      key={`${task.id}-${index}`}
                      className="rounded-lg border border-white/[0.08] bg-black/20 p-3"
                    >
                      <div className="flex items-center gap-2 text-[11px]">
                        <span
                          className={`rounded px-1.5 py-0.5 ${command.risk === "readonly" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}
                        >
                          {command.risk === "readonly" ? "只读" : "变更"}
                        </span>
                        <span className="text-slate-500">
                          {command.description}
                        </span>
                      </div>
                      <pre className="mt-2 overflow-x-auto font-mono text-[11px] whitespace-pre-wrap text-blue-200">
                        $ {command.command}
                      </pre>
                      {command.output && (
                        <pre className="mt-2 max-h-40 overflow-auto border-t border-white/[0.06] pt-2 font-mono text-[10px] whitespace-pre-wrap text-slate-400">
                          {command.output}
                        </pre>
                      )}
                      {command.status === "pending_approval" && (
                        <Button
                          size="sm"
                          className="mt-3 bg-amber-500 text-black hover:bg-amber-400"
                          onClick={() => void approve(task.id)}
                          disabled={working}
                        >
                          确认执行
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-lg bg-red-500/10 p-3 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>
      <div className="border-t border-white/[0.07] p-3">
        <div className="relative">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            disabled={!connected || working}
            className="h-24 w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] p-3 pr-10 text-xs text-slate-300 outline-none placeholder:text-slate-600 disabled:opacity-60"
            placeholder={
              connected ? "描述你的运维任务，Enter 发送..." : "请先连接主机"
            }
          />
          <button
            onClick={() => void submit()}
            disabled={!connected || working || !question.trim()}
            className="absolute right-2.5 bottom-2.5 grid size-7 place-items-center rounded-md bg-violet-500 text-white disabled:opacity-40"
          >
            {working ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </button>
        </div>
      </div>
    </aside>
  )
}

export default WorkspacePage
