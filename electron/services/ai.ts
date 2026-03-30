export type ModelInfo = {
  id: string
  owned_by?: string
}

type OpenAIModelsResponse = {
  data?: Array<{ id: string; owned_by?: string }>
}

type OpenAIChatCompletionsResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

type OpenAIImagesResponse = {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>
}

export class HttpError extends Error {
  status: number
  statusText: string
  bodyText?: string

  constructor(input: { status: number; statusText: string; bodyText?: string }) {
    super(`HTTP ${input.status} ${input.statusText}${input.bodyText ? `: ${input.bodyText}` : ''}`)
    this.name = 'HttpError'
    this.status = input.status
    this.statusText = input.statusText
    this.bodyText = input.bodyText
  }
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '')
  return trimmed
}

function withV1(baseUrl: string) {
  const url = normalizeBaseUrl(baseUrl)
  if (url.endsWith('/v1')) return url
  return `${url}/v1`
}

async function fetchJson<T>(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.headers ?? {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new HttpError({ status: res.status, statusText: res.statusText, bodyText: text || undefined })
  }

  return (await res.json()) as T
}

async function fetchBuffer(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<{ contentType: string; buffer: Buffer }> {
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: opts.headers,
    signal: opts.signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new HttpError({ status: res.status, statusText: res.statusText, bodyText: text || undefined })
  }

  const contentType = res.headers.get('content-type') || 'image/png'
  const buffer = Buffer.from(await res.arrayBuffer())
  return { contentType, buffer }
}

export async function listModels(input: { baseUrl: string; apiKey?: string }): Promise<ModelInfo[]> {
  const base = withV1(input.baseUrl)
  const headers: Record<string, string> = {}
  if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`

  const data = await fetchJson<OpenAIModelsResponse>(`${base}/models`, { headers })
  const models = (data.data ?? []).map((m) => ({ id: m.id, owned_by: m.owned_by }))
  models.sort((a, b) => a.id.localeCompare(b.id))
  return models
}

export async function chatComplete(input: {
  baseUrl: string
  apiKey?: string
  modelId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature?: number
  signal?: AbortSignal
}): Promise<string> {
  const base = withV1(input.baseUrl)
  const headers: Record<string, string> = {}
  if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`

  const data = await fetchJson<OpenAIChatCompletionsResponse>(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: {
      model: input.modelId,
      messages: input.messages,
      temperature: input.temperature ?? 0.8,
      stream: false,
    },
    signal: input.signal,
  })

  const content = data.choices?.[0]?.message?.content ?? ''
  return content
}

export async function generateImage(input: {
  baseUrl: string
  apiKey?: string
  modelId: string
  prompt: string
  size?: string
  quality?: string
  signal?: AbortSignal
}): Promise<{ dataUrl: string; revisedPrompt?: string }> {
  const base = withV1(input.baseUrl)
  const headers: Record<string, string> = {}
  if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`

  const attempts = [
    {
      model: input.modelId,
      prompt: input.prompt,
      size: input.size ?? '1024x1536',
      quality: input.quality ?? 'high',
      n: 1,
      response_format: 'b64_json',
    },
    {
      model: input.modelId,
      prompt: input.prompt,
      size: input.size ?? '1024x1536',
      n: 1,
      response_format: 'b64_json',
    },
    {
      model: input.modelId,
      prompt: input.prompt,
      size: input.size ?? '1024x1536',
      n: 1,
    },
  ]

  let lastError: unknown
  for (const body of attempts) {
    try {
      const data = await fetchJson<OpenAIImagesResponse>(`${base}/images/generations`, {
        method: 'POST',
        headers,
        body,
        signal: input.signal,
      })

      const item = data.data?.[0]
      if (!item) throw new Error('图片接口未返回 data[0]')

      if (item.b64_json) {
        return { dataUrl: `data:image/png;base64,${item.b64_json}`, revisedPrompt: item.revised_prompt }
      }

      if (item.url) {
        if (item.url.startsWith('data:image/')) {
          return { dataUrl: item.url, revisedPrompt: item.revised_prompt }
        }
        const file = await fetchBuffer(item.url, { signal: input.signal })
        return {
          dataUrl: `data:${file.contentType};base64,${file.buffer.toString('base64')}`,
          revisedPrompt: item.revised_prompt,
        }
      }

      throw new Error('图片接口未返回 b64_json 或 url')
    } catch (error) {
      lastError = error
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) continue
      throw error
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
