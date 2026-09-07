import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  Bot,
  Check,
  Clock,
  LoaderCircle,
  MessageSquare,
  Plus,
  Send,
  Server,
  ShieldAlert,
  TerminalSquare,
  X,
} from "lucide-react"

import {
  assistantApi,
  type Approval,
  type Conversation,
  type ConversationSummary,
  type ToolCall,
} from "@/api/assistant"
import { Button } from "@/components/ui/button"
import { Markdown } from "@/components/markdown"
import { navigate } from "@/router/navigation"

export function AssistantPage() {
  const [items, setItems] = useState<ConversationSummary[]>([])
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [input, setInput] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    void load()
  }, [])
  async function load() {
    try {
      const list = await assistantApi.list()
      setItems(list)
      if (list[0]) setConversation(await assistantApi.get(list[0].id))
      else await createConversation()
    } catch (reason) {
      setError((reason as Error).message)
    }
  }
  async function createConversation() {
    try {
      const created = await assistantApi.create()
      setConversation(created)
      setItems((current) => [
        {
          id: created.id,
          title: created.title,
          status: created.status,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        },
        ...current,
      ])
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
  function sync(next: Conversation) {
    setConversation(next)
    setItems((current) =>
      current.map((item) =>
        item.id === next.id
          ? {
              id: next.id,
              title: next.title,
              status: next.status,
              createdAt: next.createdAt,
              updatedAt: next.updatedAt,
            }
          : item
      )
    )
  }
  async function send() {
    if (
      !conversation ||
      !input.trim() ||
      working ||
      conversation.status === "waiting_approval"
    )
      return
    const message = input.trim()
    const previous = conversation
    setInput("")
    setWorking(true)
    setError("")
    setConversation({
      ...conversation,
      messages: [...conversation.messages, { role: "user", content: message }],
    })
    try {
      sync(await assistantApi.send(conversation.id, message))
    } catch (reason) {
      setConversation(previous)
      setInput(message)
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
  const pending = useMemo(
    () =>
      conversation?.approvals.filter(
        (approval) => approval.status === "pending"
      ) ?? [],
    [conversation]
  )

  return (
    <div className="flex h-svh min-w-[1024px] bg-muted/25 text-foreground">
      <aside className="flex w-[228px] shrink-0 flex-col border-r bg-sidebar px-3 py-4">
        <div className="flex h-10 items-center gap-2.5 px-2">
          <div className="grid size-8 place-items-center rounded-lg bg-foreground text-background">
            <TerminalSquare className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">EasySSH</div>
            <div className="text-[10px] tracking-[.18em] text-muted-foreground uppercase">
              Ops workspace
            </div>
          </div>
        </div>
        <nav className="mt-7 space-y-1 text-sm">
          <button
            onClick={() => navigate("/hosts")}
            className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-muted-foreground hover:bg-sidebar-accent"
          >
            <Server className="size-4" />
            主机
          </button>
          <button
            onClick={() => navigate("/services")}
            className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-muted-foreground hover:bg-sidebar-accent"
          >
            <Activity className="size-4" />
            服务
          </button>
          <button className="flex h-9 w-full items-center gap-3 rounded-lg bg-sidebar-accent px-3 font-medium">
            <Bot className="size-4" />
            智能助手
          </button>
        </nav>
        <div className="mt-7 flex items-center justify-between px-2">
          <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            对话
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void createConversation()}
          >
            <Plus />
          </Button>
        </div>
        <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => void openConversation(item.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${conversation?.id === item.id ? "bg-sidebar-accent font-medium" : "text-muted-foreground hover:bg-sidebar-accent"}`}
            >
              <MessageSquare className="size-3.5 shrink-0" />
              <span className="truncate">{item.title}</span>
              {item.status === "waiting_approval" && (
                <span className="ml-auto size-2 rounded-full bg-amber-500" />
              )}
            </button>
          ))}
        </div>
        <div className="border-t px-2 pt-4 text-[11px] leading-5 text-muted-foreground">
          SSH 凭据仅由后端解密和使用，不会发送给智能助手。
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center border-b bg-background/80 px-7">
          <div>
            <div className="text-sm font-semibold">智能助手</div>
            <div className="text-xs text-muted-foreground">
              查询并操作所有已保存主机
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-emerald-600">
            <Check className="size-4" />
            凭据隔离
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7">
          <div className="mx-auto max-w-3xl space-y-5">
            {!conversation || conversation.messages.length === 0 ? (
              <Empty />
            ) : (
              conversation.messages.map((message, index) => {
                if (message.role === "tool")
                  return (
                    <ToolResult key={index} content={message.content ?? ""} />
                  )
                return (
                  <div
                    key={index}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-foreground whitespace-pre-wrap text-background" : "border bg-card"}`}
                    >
                      {message.role === "assistant" && message.content ? (
                        <Markdown>{message.content}</Markdown>
                      ) : (
                        message.content
                      )}
                      {message.tool_calls?.map((call) => (
                        <ToolRequest key={call.id} call={call} />
                      ))}
                    </div>
                  </div>
                )
              })
            )}
            {pending.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                working={working}
                onDecide={decide}
              />
            ))}
            {working && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                助手正在处理任务…
              </div>
            )}
            {error && (
              <div className="flex items-center justify-between rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <span>{error}</span>
                <button onClick={() => setError("")}>
                  <X className="size-4" />
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="shrink-0 border-t bg-background p-4">
          <div className="mx-auto max-w-3xl">
            <div className="relative">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
                disabled={
                  working ||
                  !conversation ||
                  conversation.status === "waiting_approval"
                }
                placeholder={
                  conversation?.status === "waiting_approval"
                    ? "请先确认或拒绝待执行命令"
                    : "描述任务，例如：检查所有生产环境主机的磁盘使用率"
                }
                className="h-24 w-full resize-none rounded-xl border bg-background p-4 pr-12 text-sm outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-60"
              />
              <button
                onClick={() => void send()}
                disabled={
                  working ||
                  !input.trim() ||
                  conversation?.status === "waiting_approval"
                }
                className="absolute right-3 bottom-3 grid size-8 place-items-center rounded-lg bg-foreground text-background disabled:opacity-30"
              >
                <Send className="size-4" />
              </button>
            </div>
            <div className="mt-2 text-center text-[11px] text-muted-foreground">
              只读命令自动执行；变更和 sudo 命令逐条确认。请核对命令和目标主机。
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function Empty() {
  return (
    <div className="grid min-h-[55vh] place-items-center text-center">
      <div>
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-violet-500/10">
          <Bot className="size-7 text-violet-600" />
        </div>
        <h1 className="mt-5 text-xl font-semibold">我可以协助管理你的主机</h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          可以让我列出或查询主机、检查系统状态、分析日志，以及在你确认后执行敏感变更。
        </p>
      </div>
    </div>
  )
}
function ToolRequest({ call }: { call: ToolCall }) {
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(call.function.arguments)
  } catch {
    /* display raw call below */
  }
  return (
    <div className="mt-3 rounded-lg bg-muted p-3 font-mono text-xs">
      <div className="mb-1 font-sans text-muted-foreground">
        调用工具 · {call.function.name}
      </div>
      {call.function.name === "ssh_exec"
        ? `主机 #${args.host_id}  $ ${args.command}`
        : call.function.arguments}
    </div>
  )
}
function ToolResult({ content }: { content: string }) {
  let result: Record<string, unknown> = {}
  try {
    result = JSON.parse(content)
  } catch {
    return null
  }
  if (result.status === "approval_required" || result.status === "deferred")
    return null
  return (
    <div className="rounded-xl border bg-card p-3 text-xs">
      <div className="mb-2 flex items-center gap-2 font-medium">
        <TerminalSquare className="size-3.5" />
        工具结果 {result.host_name ? `· ${String(result.host_name)}` : ""}
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-muted-foreground">
        {result.stdout
          ? String(result.stdout)
          : JSON.stringify(result, null, 2)}
      </pre>
    </div>
  )
}
function ApprovalCard({
  approval,
  working,
  onDecide,
}: {
  approval: Approval
  working: boolean
  onDecide: (approval: Approval, approved: boolean) => void
}) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[.06] p-4">
      <div className="flex items-center gap-2 font-medium text-amber-700">
        <ShieldAlert className="size-4" />
        需要确认敏感操作
      </div>
      <div className="mt-3 grid gap-2 text-xs">
        <div>
          <span className="text-muted-foreground">目标主机：</span>#
          {approval.hostId}
        </div>
        <div>
          <span className="text-muted-foreground">风险：</span>
          {approval.riskReason}
        </div>
        <pre className="overflow-x-auto rounded-lg bg-background p-3 text-sm">
          $ {approval.command}
        </pre>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Clock className="size-3" />
          确认将在 15 分钟后失效
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          size="sm"
          onClick={() => onDecide(approval, true)}
          disabled={working}
        >
          确认执行
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDecide(approval, false)}
          disabled={working}
        >
          拒绝
        </Button>
      </div>
    </div>
  )
}

export default AssistantPage
