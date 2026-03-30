import { chatComplete, generateImage, HttpError, listModels } from './ai'
import type { AppSettings } from './settings'
import { decryptApiKey } from './settings'

export type CoverMetaInput = {
  title: string
  targetReader?: '男频' | '女频'
  tags?: string[]
  protagonists?: string[]
  intro?: string
}

function uniqList(value: unknown, limit: number) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const text = String(item ?? '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length >= limit) break
  }
  return out
}

function normalizeMeta(input: CoverMetaInput) {
  return {
    title: String(input.title ?? '').trim(),
    targetReader: input.targetReader === '女频' ? '女频' : '男频',
    tags: uniqList(input.tags, 6),
    protagonists: uniqList(input.protagonists, 2),
    intro: String(input.intro ?? '').trim().slice(0, 240),
  }
}

function fallbackPrompt(meta: ReturnType<typeof normalizeMeta>) {
  const genre = meta.tags.length ? meta.tags.join('、') : meta.targetReader === '女频' ? '情感张力' : '都市悬疑'
  const people = meta.protagonists.length ? `主角为 ${meta.protagonists.join('、')}，形象必须统一且具有记忆点。` : '画面主角必须突出，面部清晰，有强烈情绪。'
  return [
    `为中文网络小说《${meta.title}》绘制一张竖版封面插画。`,
    `题材关键词：${genre}。`,
    people,
    meta.intro ? `核心剧情氛围：${meta.intro}` : '',
    '画面要求：电影感、写实数字插画、戏剧化光影、构图集中、主体突出、细节丰富、氛围强烈。',
    '封面风格参考番茄小说爆款网文封面：强情节感、强冲突感、抓眼、商业化。',
    '请只生成背景主视觉，不要任何文字、标题、水印、logo、边框。',
    '画幅为 3:4 竖版，适合作为小说封面。',
  ]
    .filter(Boolean)
    .join(' ')
}

function uniqOrdered(items: Array<string | undefined | null>) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const text = String(item ?? '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function isLikelyImageModel(modelId: string) {
  return /gpt-image|image|imagine|flux|sdxl|stable|paint|wanx|seedream|janus|vision/i.test(modelId)
}

async function pickImageModelCandidates(input: { settings: AppSettings; baseUrl: string; apiKey?: string }) {
  const configured = uniqOrdered([input.settings.coverModelId, input.settings.modelId])
  try {
    const models = await listModels({ baseUrl: input.baseUrl, apiKey: input.apiKey })
    const detected = models.map((m) => m.id).filter(isLikelyImageModel)
    return uniqOrdered([...configured, ...detected])
  } catch {
    return configured
  }
}

async function buildPrompt(input: { settings: AppSettings; meta: ReturnType<typeof normalizeMeta> }) {
  const baseUrl = String(input.settings.baseUrl ?? '').trim()
  const modelId = String(input.settings.modelId ?? '').trim()
  const apiKey = decryptApiKey(input.settings.apiKeyEncrypted)
  if (!baseUrl || !modelId) return fallbackPrompt(input.meta)

  try {
    const raw = await chatComplete({
      baseUrl,
      apiKey: apiKey || undefined,
      modelId,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content:
            '你是中文小说封面美术提示词专家。请为图像模型输出一段高质量中文提示词，只输出提示词正文，不要解释，不要 Markdown，不要编号。',
        },
        {
          role: 'user',
          content:
            `书名：${input.meta.title}\n` +
            `目标读者：${input.meta.targetReader}\n` +
            `标签：${input.meta.tags.join('、') || '无'}\n` +
            `主角：${input.meta.protagonists.join('、') || '无'}\n` +
            `简介：${input.meta.intro || '无'}\n\n` +
            '要求：生成适合中文网文爆款封面的竖版 3:4 插画提示词；突出戏剧冲突、主角特写、电影感、写实感；不得包含任何文字、水印、logo、版式说明。',
        },
      ],
    })
    const prompt = raw.trim()
    return prompt || fallbackPrompt(input.meta)
  } catch {
    return fallbackPrompt(input.meta)
  }
}

export async function generateNovelCover(input: {
  settings: AppSettings
  meta: CoverMetaInput
}): Promise<{ imageDataUrl: string; prompt: string; modelId: string }> {
  const meta = normalizeMeta(input.meta)
  if (!meta.title) throw new Error('书名不能为空')

  const imageBaseUrl = String(input.settings.imageBaseUrl ?? '').trim() || String(input.settings.baseUrl ?? '').trim()
  if (!imageBaseUrl) throw new Error('请先在设置里填写图片 Base URL，或至少填写通用 Base URL')

  const imageApiKey = decryptApiKey(input.settings.imageApiKeyEncrypted) || decryptApiKey(input.settings.apiKeyEncrypted)
  const prompt = await buildPrompt({ settings: input.settings, meta })
  const imageModelCandidates = await pickImageModelCandidates({
    settings: input.settings,
    baseUrl: imageBaseUrl,
    apiKey: imageApiKey || undefined,
  })
  if (!imageModelCandidates.length) {
    throw new Error('未找到可用的出图模型。请在设置里填写图片模型 ID，或保证接口的 /models 能返回 image / imagine 类模型。')
  }

  let lastError: unknown
  for (const imageModelId of imageModelCandidates) {
    try {
      const image = await generateImage({
        baseUrl: imageBaseUrl,
        apiKey: imageApiKey || undefined,
        modelId: imageModelId,
        prompt,
        size: '720x1280',
        quality: 'high',
      })
      return { imageDataUrl: image.dataUrl, prompt: image.revisedPrompt?.trim() || prompt, modelId: imageModelId }
    } catch (error) {
      lastError = error
      if (error instanceof HttpError && error.status === 404) {
        throw new Error(
          `当前图片接口 ${imageBaseUrl} 不支持 /images/generations。请在设置里把“图片 Base URL”切到支持图片生成的服务，或改用支持出图的 OpenAI 兼容接口。`,
        )
      }
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) continue
      break
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`封面出图失败：${message}`)
}
