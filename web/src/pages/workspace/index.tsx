import { useCallback, useEffect, useRef, useState } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import {
  ArrowLeft,
  Bot,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Plug,
  RefreshCw,
  Send,
  Server,
  Settings,
  ShieldCheck,
  TerminalSquare,
  Unplug,
  X,
} from "lucide-react"

import { hostsApi, type Host } from "@/api/hosts"
import {
  assistantApi,
  type Approval,
  type AssistantMessage,
  type Conversation,
  type ConversationSummary,
  type ToolCall,
} from "@/api/assistant"
import { API_BASE } from "@/api/client"
import { Button } from "@/components/ui/button"
import { AISettingsDialog } from "@/components/ai-settings-dialog"
import { Markdown } from "@/components/markdown"
import { RemoteFileBrowser } from "@/components/remote-file-browser"
import { navigate } from "@/router/navigation"

type ConnectionStatus = "idle" | "connecting" | "connected" | "error"

export function WorkspacePage({ hostId }: { hostId: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const autoConnectAttemptedRef = useRef(false)
  const [host, setHost] = useState<Host | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>("idle")
  const [error, setError] = useState("")
  const [agentOpen, setAgentOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  const connect = useCallback(() => {
    if (!host || status === "connecting" || status === "connected") return
    setStatus("connecting")
    setError("")
    const terminal = terminalRef.current
    terminal?.clear()
    terminal?.writeln("\x1b[90m正在建立安全连接...\x1b[0m")
    const url = new URL(
      `${API_BASE}/hosts/${host.id}/terminal`,
      window.location.origin
    )
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
  }, [host, status])

  useEffect(() => {
    if (!host || autoConnectAttemptedRef.current) return
    autoConnectAttemptedRef.current = true
    connect()
  }, [connect, host])
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
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-400 hover:bg-white/10 hover:text-white"
            onClick={() => setSettingsOpen(true)}
            aria-label="AI 设置"
          >
            <Settings />
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
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-white/10 bg-[#0f131a] p-3">
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <RemoteFileBrowser hostId={hostId} />
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
        {agentOpen && <AgentPanel hostId={hostId} />}
      </div>
      {settingsOpen && (
        <AISettingsDialog onClose={() => setSettingsOpen(false)} />
      )}
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
function AgentPanel({ hostId }: { hostId: number }) {
  const [items, setItems] = useState<ConversationSummary[]>([])
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [question, setQuestion] = useState("")
  const [working, setWorking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const messageEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    assistantApi
      .listForHost(hostId)
      .then(async (list) => {
        setItems(list)
        if (list[0]) setConversation(await assistantApi.get(list[0].id))
        else sync(await assistantApi.createForHost(hostId))
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false))
  }, [hostId])
  function sync(next: Conversation) {
    setConversation(next)
    const summary = {
      id: next.id,
      title: next.title,
      scopeType: next.scopeType,
      hostId: next.hostId,
      status: next.status,
      createdAt: next.createdAt,
      updatedAt: next.updatedAt,
    }
    setItems((current) =>
      current.some((item) => item.id === next.id)
        ? current.map((item) => (item.id === next.id ? summary : item))
        : [summary, ...current]
    )
  }
  async function createConversation() {
    if (working) return
    try {
      sync(await assistantApi.createForHost(hostId))
    } catch (reason) {
      setError((reason as Error).message)
    }
  }
  async function openConversation(id: number) {
    if (working) return
    try {
      setConversation(await assistantApi.get(id))
    } catch (reason) {
      setError((reason as Error).message)
    }
  }
  async function submit() {
    if (
      !conversation ||
      !question.trim() ||
      working ||
      conversation.status === "waiting_approval"
    )
      return
    const value = question.trim(),
      previous = conversation
    setQuestion("")
    setWorking(true)
    setError("")
    setConversation({
      ...conversation,
      messages: [...conversation.messages, { role: "user", content: value }],
    })
    try {
      sync(await assistantApi.send(conversation.id, value))
    } catch (reason) {
      setConversation(previous)
      setQuestion(value)
      setError((reason as Error).message)
    } finally {
      setWorking(false)
    }
  }
  async function decide(approval: Approval, approved: boolean) {
    if (working) return
    setWorking(true)
    setError("")
    try {
      sync(
        approved
          ? await assistantApi.approve(approval.id)
          : await assistantApi.reject(approval.id)
      )
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setWorking(false)
    }
  }
  const pending =
    conversation?.approvals.filter(
      (approval) => approval.status === "pending"
    ) ?? []
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [conversation?.messages.length, pending.length, working])
  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-white/10 bg-[#11151d]">
      <div className="flex h-10 items-center gap-2 border-b border-white/[0.07] px-3 text-xs font-medium">
        <Bot className="size-3.5 text-violet-400" />
        <select
          value={conversation?.id ?? ""}
          onChange={(event) =>
            void openConversation(Number(event.target.value))
          }
          disabled={working}
          className="min-w-0 flex-1 bg-transparent text-slate-300 outline-none"
        >
          {items.map((item) => (
            <option key={item.id} value={item.id} className="bg-[#11151d]">
              {item.title}
            </option>
          ))}
        </select>
        <button
          title="新建对话"
          onClick={() => void createConversation()}
          className="rounded p-1 text-slate-400 hover:bg-white/10"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="grid h-full place-items-center">
            <RefreshCw className="size-4 animate-spin text-slate-600" />
          </div>
        ) : !conversation || conversation.messages.length === 0 ? (
          <div className="grid h-full place-items-center px-8 text-center">
            <div>
              <div className="mx-auto grid size-11 place-items-center rounded-xl bg-violet-500/10">
                <ShieldCheck className="size-5 text-violet-400" />
              </div>
              <h3 className="mt-4 text-sm font-medium">让 Agent 协助排障</h3>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Agent
                只能操作当前主机，可根据命令结果多轮分析。敏感操作需要逐条确认。
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {conversation.messages.map((message, index) => (
              <WorkspaceMessage key={index} message={message} />
            ))}
          </div>
        )}
        {pending.map((approval) => (
          <div
            key={approval.id}
            className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs"
          >
            <div className="font-medium text-amber-300">需要确认敏感操作</div>
            <div className="mt-1 text-slate-400">{approval.riskReason}</div>
            <pre className="mt-2 max-h-32 overflow-auto rounded bg-black/30 p-2 whitespace-pre-wrap text-blue-200">
              $ {approval.command}
            </pre>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                className="bg-amber-500 text-black hover:bg-amber-400"
                onClick={() => void decide(approval, true)}
                disabled={working}
              >
                确认执行
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-white/10 bg-transparent text-slate-300"
                onClick={() => void decide(approval, false)}
                disabled={working}
              >
                拒绝
              </Button>
            </div>
          </div>
        ))}
        {working && (
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw className="size-3 animate-spin" />
            Agent 正在分析并操作当前主机…
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-lg bg-red-500/10 p-3 text-xs text-red-300">
            {error}
          </div>
        )}
        <div ref={messageEndRef} />
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
            disabled={
              working ||
              !conversation ||
              conversation.status === "waiting_approval"
            }
            className="h-24 w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] p-3 pr-10 text-xs text-slate-300 outline-none placeholder:text-slate-600 disabled:opacity-60"
            placeholder={
              conversation?.status === "waiting_approval"
                ? "请先处理待确认命令"
                : "描述当前主机的运维任务，Enter 发送..."
            }
          />
          <button
            onClick={() => void submit()}
            disabled={
              working ||
              !question.trim() ||
              conversation?.status === "waiting_approval"
            }
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

function WorkspaceMessage({ message }: { message: AssistantMessage }) {
  if (message.role === "tool")
    return <WorkspaceToolResult content={message.content ?? ""} />
  return (
    <div
      className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[92%] rounded-xl px-3 py-2 text-xs ${message.role === "user" ? "bg-violet-500 whitespace-pre-wrap text-white" : "border border-white/[0.08] bg-black/20 text-slate-300"}`}
      >
        {message.role === "assistant" && message.content ? (
          <Markdown className="[&_code]:bg-white/10 [&_pre]:bg-black/30">
            {message.content}
          </Markdown>
        ) : (
          message.content
        )}
        {message.tool_calls?.map((call) => (
          <WorkspaceToolCall key={call.id} call={call} />
        ))}
      </div>
    </div>
  )
}
function WorkspaceToolCall({ call }: { call: ToolCall }) {
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(call.function.arguments)
  } catch {
    /* show raw arguments */
  }
  return (
    <div className="mt-2 rounded-lg bg-black/30 p-2">
      <div className="text-[10px] text-slate-500">
        调用工具 · {call.function.name}
      </div>
      <pre className="mt-1 overflow-x-auto font-mono text-[11px] whitespace-pre-wrap text-blue-200">
        $ {String(args.command ?? call.function.arguments)}
      </pre>
    </div>
  )
}
function WorkspaceToolResult({ content }: { content: string }) {
  let result: Record<string, unknown> = {}
  try {
    result = JSON.parse(content)
  } catch {
    return null
  }
  if (result.status === "approval_required" || result.status === "deferred")
    return null
  return (
    <div className="rounded-lg border border-white/[0.08] bg-black/20 p-3">
      <div className="text-[10px] text-slate-500">
        执行结果 · {String(result.status ?? "unknown")}
        {result.exit_code !== undefined
          ? ` · exit ${String(result.exit_code)}`
          : ""}
      </div>
      <pre className="mt-2 max-h-56 overflow-auto font-mono text-[10px] whitespace-pre-wrap text-slate-400">
        {result.stdout
          ? String(result.stdout)
          : JSON.stringify(result, null, 2)}
      </pre>
    </div>
  )
}

export default WorkspacePage
