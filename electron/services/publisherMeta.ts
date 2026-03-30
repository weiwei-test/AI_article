import { chatComplete } from './ai'
import type { AppSettings } from './settings'
import { decryptApiKey } from './settings'

export type BookTargetReader = '男频' | '女频'

export type BookMeta = {
  title: string
  targetReader: BookTargetReader
  tags: string[]
  protagonists: string[]
  intro: string
}

function cleanJsonText(text: string) {
  const raw = String(text ?? '').trim()
  if (!raw) return ''
  // Strip markdown fences if the model wraps JSON.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return (fenced?.[1] ?? raw).trim()
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = cleanJsonText(text)
  if (!cleaned) return null

  try {
    const parsed = JSON.parse(cleaned) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // continue
  }

  // Fallback: grab the first {...} block.
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (m?.[0]) {
    try {
      const parsed = JSON.parse(m[0]) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // continue
    }
  }

  return null
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((x) => String(x ?? '').trim()).filter(Boolean)
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return []
    // Split common delimiters.
    return s
      .split(/[，,、;；\n]/g)
      .map((t) => t.trim())
      .filter(Boolean)
  }
  return []
}

function pickTargetReader(value: unknown): BookTargetReader {
  const s = String(value ?? '').trim()
  if (s.includes('女')) return '女频'
  return '男频'
}

function clampTags(tags: string[]) {
  const uniq: string[] = []
  const seen = new Set<string>()
  for (const t of tags) {
    const v = String(t ?? '').trim()
    if (!v) continue
    if (v.length > 12) continue
    if (seen.has(v)) continue
    seen.add(v)
    uniq.push(v)
    if (uniq.length >= 8) break
  }
  return uniq
}

function clampProtagonists(names: string[]) {
  const uniq: string[] = []
  const seen = new Set<string>()
  for (const n of names) {
    const v = String(n ?? '').trim()
    if (!v) continue
    if (v.length > 12) continue
    if (seen.has(v)) continue
    seen.add(v)
    uniq.push(v)
    if (uniq.length >= 3) break
  }
  return uniq
}

export async function generateBookMeta(input: { settings: AppSettings; title: string }): Promise<BookMeta> {
  const title = String(input.title ?? '').trim()
  if (!title) throw new Error('书名不能为空')

  const settings = input.settings
  const modelId = String(settings.modelId ?? '').trim()
  if (!modelId) throw new Error('请先在“设置”里填写模型 ID（用于生成标签/简介）')

  const baseUrl = String(settings.baseUrl ?? '').trim()
  if (!baseUrl) throw new Error('请先在“设置”里填写 Base URL')

  const apiKey = decryptApiKey(settings.apiKeyEncrypted)

  const system = [
    '你是番茄小说“创建新书”页面的写作助手。',
    '用户只给你书名，你需要生成：目标读者、标签、主角名、作品简介。',
    '只输出 JSON，不要输出多余文字，不要 Markdown。',
    '约束：',
    '- targetReader 只能是 "男频" 或 "女频"。',
    '- tags：3-6 个，短词，偏番茄常见标签（例如 悬疑/推理/都市/甜宠/热血/复仇/校园/玄幻/古言/现言/重生/穿越/职场/探案/灵异 等），不要太长。',
    '- protagonists：1-2 个中文名字（不要“男主/女主”这种占位符）。',
    '- intro：80-160 字左右，第一句抓人，不要空泛堆词，不要复述书名，避免剧透结局。',
  ].join('\n')

  const user = `书名：${title}\n\n请按 schema 输出 JSON：\n{\n  "targetReader": "男频|女频",\n  "tags": ["..."],\n  "protagonists": ["..."],\n  "intro": "..."\n}\n`

  const raw = await chatComplete({
    baseUrl,
    apiKey: apiKey || undefined,
    modelId,
    temperature: 0.7,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })

  const obj = tryParseJsonObject(raw)
  if (!obj) throw new Error('模型返回无法解析为 JSON（可尝试换模型或降低温度）')

  const targetReader = pickTargetReader(obj.targetReader)
  const tags = clampTags(toStringArray(obj.tags))
  const protagonists = clampProtagonists(toStringArray(obj.protagonists))
  const intro = String(obj.intro ?? '').trim()

  if (!tags.length) throw new Error('模型未返回 tags')
  if (!protagonists.length) throw new Error('模型未返回 protagonists')
  if (!intro) throw new Error('模型未返回 intro')

  return {
    title,
    targetReader,
    tags,
    protagonists,
    intro,
  }
}
