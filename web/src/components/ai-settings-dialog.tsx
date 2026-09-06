import { useEffect, useState } from "react"
import { Check, Eye, EyeOff, LoaderCircle, X } from "lucide-react"
import { settingsApi } from "@/api/settings"
import { Button } from "@/components/ui/button"

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"

export function AISettingsDialog({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState("OpenAI")
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1")
  const [model, setModel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [hasKey, setHasKey] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    settingsApi
      .getAI()
      .then((settings) => {
        setProvider(settings.provider || "OpenAI")
        setBaseUrl(settings.baseUrl || "https://api.openai.com/v1")
        setModel(settings.model || "")
        setHasKey(settings.hasApiKey)
      })
      .catch((reason: Error) => setError(reason.message))
  }, [])
  async function save() {
    setSaving(true)
    setError("")
    try {
      const result = await settingsApi.saveAI({
        provider,
        baseUrl,
        model,
        apiKey: apiKey || undefined,
      })
      setHasKey(result.hasApiKey)
      setApiKey("")
      setSaved(true)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-xl border bg-background text-foreground shadow-2xl">
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <h2 className="font-semibold">AI 模型设置</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              配置 OpenAI-compatible 模型服务。
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="space-y-4 p-6">
          <Field label="供应商">
            <input
              className={inputClass}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="OpenAI、DeepSeek、Ollama"
            />
          </Field>
          <Field label="Base URL">
            <input
              className={inputClass}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </Field>
          <Field label="API Key">
            <div className="relative">
              <input
                className={`${inputClass} pr-10`}
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? "已保存，留空保持不变" : "输入 API Key"}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
              >
                {showKey ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </Field>
          <Field label="模型名称">
            <input
              className={inputClass}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-5-mini"
            />
          </Field>
          {error && (
            <div className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t px-6 py-4">
          <span className="text-xs text-muted-foreground">
            密钥将由服务端加密保存
          </span>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="flex items-center gap-1 text-xs text-emerald-600">
                <Check className="size-3.5" />
                已保存
              </span>
            )}
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={() => void save()}
              disabled={saving || !baseUrl.trim() || !model.trim()}
            >
              {saving && <LoaderCircle className="animate-spin" />}保存
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}
