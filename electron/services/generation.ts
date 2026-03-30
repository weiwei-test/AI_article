import fs from 'node:fs/promises'
import path from 'node:path'
import { chatComplete, HttpError } from './ai'
import type { AppSettings } from './settings'
import { decryptApiKey } from './settings'
import { createProjectDir, readChaptersMarkdown, updateProjectMeta } from './projects'

export type GenerationJobId = string

export type Outline = {
  synopsis: string
  chapters: Array<{ index: number; title: string; summary: string }>
}

export type GeneratedChapter = {
  index: number
  title: string
  content: string
  summary?: string
}

export type GenerationBookMeta = {
  targetReader?: '男频' | '女频'
  tags?: string[]
  protagonists?: string[]
  intro?: string
}

export type GenerationCompletionMode = 'completed' | 'ongoing'

export type GenerationResult = {
  jobId: GenerationJobId
  projectDir: string
  outline?: Outline
  chapters: GeneratedChapter[]
}

export type GenerationEvent =
  | { type: 'progress'; jobId: string; phase: string; message: string; chapterIndex?: number; chapterCount?: number }
  | { type: 'complete'; jobId: string; result: GenerationResult }
  | { type: 'error'; jobId: string; error: string }

type Emit = (ev: GenerationEvent) => void

type JobState = {
  abort: AbortController
  cancelled: boolean
}

const jobs = new Map<GenerationJobId, JobState>()

const UI_CHAPTER_LIMIT = 50
const OUTLINE_CHUNK_THRESHOLD = 30
const OUTLINE_BATCH_SIZE = 20
const CONTINUATION_SUMMARY_BATCH_SIZE = 4
const MAX_CHAT_RETRIES = 6

function normalizeMetaItems(value: unknown, opts: { limit: number; maxLength: number }) {
  if (!Array.isArray(value)) return []
  const items: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const text = String(item ?? '').trim()
    if (!text || text.length > opts.maxLength || seen.has(text)) continue
    seen.add(text)
    items.push(text)
    if (items.length >= opts.limit) break
  }
  return items
}

function normalizeBookMeta(meta?: GenerationBookMeta) {
  return {
    targetReader: meta?.targetReader === '女频' ? '女频' : '男频',
    tags: normalizeMetaItems(meta?.tags, { limit: 8, maxLength: 16 }),
    protagonists: normalizeMetaItems(meta?.protagonists, { limit: 3, maxLength: 12 }),
    intro: String(meta?.intro ?? '').trim().slice(0, 300),
  }
}

function normalizeCompletionMode(mode?: GenerationCompletionMode): GenerationCompletionMode {
  return mode === 'ongoing' ? 'ongoing' : 'completed'
}

function completionModeLabel(mode: GenerationCompletionMode) {
  return mode === 'ongoing' ? '连载中' : '已完结'
}

function buildStoryContext(title: string, meta: ReturnType<typeof normalizeBookMeta>, completionMode: GenerationCompletionMode) {
  const lines = [`小说名：《${title}》`, `目标读者：${meta.targetReader}`, `生成模式：${completionModeLabel(completionMode)}`]
  if (meta.tags.length) lines.push(`标签：${meta.tags.join('、')}`)
  if (meta.protagonists.length) lines.push(`主角名：${meta.protagonists.join('、')}`)
  if (meta.intro) lines.push(`作品简介：${meta.intro}`)
  return `${lines.join('\n')}\n`
}

function buildMetaRules(meta: ReturnType<typeof normalizeBookMeta>) {
  const rules = ['必须与上面的新书资料保持一致，不要擅自更换题材、主角名或人物关系。']
  if (meta.tags.length) rules.push(`剧情与风格要明显贴合这些标签：${meta.tags.join('、')}。`)
  if (meta.protagonists.length) {
    rules.push(`已给定主角名：${meta.protagonists.join('、')}。正文里必须自然出现至少一个主角名，不能只用“他/她/男主/女主”代替。`)
  }
  if (meta.intro) rules.push('前几章要承接作品简介里的核心设定、矛盾与卖点。')
  return rules.map((rule) => `- ${rule}`).join('\n')
}

function renderBookMetaMarkdown(meta: ReturnType<typeof normalizeBookMeta>) {
  const lines: string[] = []
  lines.push(`> 目标读者：${meta.targetReader}`)
  if (meta.tags.length) lines.push(`> 标签：${meta.tags.join(' / ')}`)
  if (meta.protagonists.length) lines.push(`> 主角：${meta.protagonists.join(' / ')}`)
  if (meta.intro) lines.push(`> 简介：${meta.intro}`)
  return lines.length ? `${lines.join('\n')}\n\n` : ''
}

function renderCompletionModeMarkdown(completionMode: GenerationCompletionMode) {
  return `> 生成模式：${completionModeLabel(completionMode)}\n\n`
}

function buildCompletionRules(completionMode: GenerationCompletionMode, chapterCount: number) {
  if (completionMode === 'completed') {
    return [
      `这次规划的 ${chapterCount} 章就是完整正文，总体要朝“完结”推进。`,
      '后 20% 章节要明显收束主线矛盾，逐步回收关键伏笔。',
      '最后一章必须给出明确结局、人物阶段性归宿与情绪落点，不要写成“故事才刚开始”的感觉。',
    ]
  }
  return [
    `这次规划的 ${chapterCount} 章只是一段连载内容，不是全书完结。`,
    '本批章节要形成一个阶段性小高潮或阶段性结果，但保留核心主线与更大悬念。',
    '最后一章必须让读者强烈期待后续，禁止把主线彻底收死或写成大结局。',
  ]
}

function buildChapterStageRule(input: {
  completionMode: GenerationCompletionMode
  chapterIndex: number
  chapterCount: number
}) {
  const { completionMode, chapterIndex, chapterCount } = input
  const isFinal = chapterIndex === chapterCount
  const isPenultimate = chapterIndex === chapterCount - 1

  if (completionMode === 'completed') {
    if (isFinal) {
      return '这是最终章：必须完成主线收束、交代关键人物结果、情绪落地，不要强行留下续作钩子。'
    }
    if (isPenultimate) {
      return '这是倒数第二章：要集中引爆核心冲突，为最终章收束做准备。'
    }
    return '这是完结向正文中的中间章节：既要推进主线，也要为后续收束提前铺垫。'
  }

  if (isFinal) {
    return '这是当前连载批次的最后一章：要形成强钩子或新危机，只做阶段性收尾，不能写成大结局。'
  }
  if (isPenultimate) {
    return '这是本批连载的倒数第二章：要明显抬高风险，为最后一章的阶段性爆点服务。'
  }
  return '这是连载中的章节：结尾要保留追读动力，持续扩大人物目标与主线悬念。'
}

function hasProtagonistMention(content: string, protagonists: string[]) {
  if (!protagonists.length) return true
  return protagonists.some((name) => content.includes(name))
}

function extractJsonBlock(text: string): string | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()

  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first >= 0 && last > first) return text.slice(first, last + 1).trim()
  return null
}

function tryParseJson<T>(text: string): T | null {
  const json = extractJsonBlock(text)
  if (!json) return null
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

function toMdChapter(ch: GeneratedChapter) {
  return `## 第${ch.index}章 ${ch.title}\n\n${ch.content.trim()}\n`
}

function isAbortLikeError(err: unknown) {
  if (!err) return false
  if (err instanceof DOMException && err.name === 'AbortError') return true
  if (err instanceof Error && err.name === 'AbortError') return true
  if (err instanceof Error && err.message === 'cancelled') return true
  return false
}

function isRetryableError(err: unknown) {
  if (!err) return false
  if (err instanceof HttpError) {
    if (err.status === 429) return true
    if (err.status === 408) return true
    if (err.status >= 500) return true
    return false
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    if (msg.includes('fetch failed')) return true
    if (msg.includes('networkerror')) return true
    if (msg.includes('econnreset')) return true
    if (msg.includes('etimedout')) return true
    return false
  }
  return false
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return
  if (!signal) {
    await new Promise<void>((r) => setTimeout(r, ms))
    return
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function backoffMs(attempt: number) {
  const base = 800
  const max = 20_000
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt))
  const jitter = 0.2 + Math.random() * 0.6 // 0.2x ~ 0.8x
  return Math.floor(exp * jitter)
}

async function chatCompleteWithRetry(
  input: Parameters<typeof chatComplete>[0],
  opts: { signal?: AbortSignal; onRetry?: (info: { attempt: number; waitMs: number; error: unknown }) => void } = {},
) {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_CHAT_RETRIES; attempt++) {
    try {
      return await chatComplete({ ...input, signal: opts.signal })
    } catch (err) {
      lastErr = err
      if (opts.signal?.aborted || isAbortLikeError(err)) throw err
      if (!isRetryableError(err) || attempt >= MAX_CHAT_RETRIES) throw err

      const waitMs = backoffMs(attempt)
      opts.onRetry?.({ attempt: attempt + 1, waitMs, error: err })
      await sleep(waitMs, opts.signal)
    }
  }
  // should be unreachable
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function repairJson<T>(input: {
  baseUrl: string
  apiKey?: string
  modelId: string
  temperature?: number
  signal?: AbortSignal
  rawText: string
  schemaHint: string
}): Promise<T | null> {
  const fixed = await chatCompleteWithRetry(
    {
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      modelId: input.modelId,
      temperature: input.temperature ?? 0,
      messages: [
        {
          role: 'system',
          content: '你是一个严格的 JSON 修复器。你的输出必须是严格 JSON，不能包含任何额外文字、代码块、解释或注释。',
        },
        {
          role: 'user',
          content:
            `把下面内容修复/转换成严格 JSON。\n` +
            `只输出 JSON。\n` +
            `JSON 格式要求：\n${input.schemaHint}\n\n` +
            `待修复内容：\n${input.rawText}`,
        },
      ],
    },
    { signal: input.signal },
  )

  return tryParseJson<T>(fixed)
}

async function writeJsonAtomic(filePath: string, data: unknown) {
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  try {
    await fs.rename(tmp, filePath)
  } catch {
    await fs.rm(filePath, { force: true }).catch(() => {})
    await fs.rename(tmp, filePath)
  }
}

export function cancelGeneration(jobId: GenerationJobId) {
  const job = jobs.get(jobId)
  if (!job) return
  job.cancelled = true
  job.abort.abort('cancelled')
}

export function startGeneration(input: {
  settings: AppSettings
  title: string
  chapterCount: number
  bookMeta?: GenerationBookMeta
  completionMode?: GenerationCompletionMode
  projectDir?: string
  emit: Emit
}): GenerationJobId {
  const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const abort = new AbortController()
  jobs.set(jobId, { abort, cancelled: false })

  void (async () => {
    const emit = input.emit
    const targetChapterCount = Math.max(1, Math.min(200, Math.floor(input.chapterCount || 1)))
    const requestedTitle = (input.title || '').trim()
    const requestedProjectDir = String(input.projectDir || '').trim()
    let statePath = ''

    try {
      const apiKey = decryptApiKey(input.settings.apiKeyEncrypted)
      const baseUrl = input.settings.baseUrl
      const modelId = input.settings.modelId
      if (!baseUrl || !modelId) throw new Error('请先在设置中配置 Base URL 和模型。')

      type PersistedState = {
        version: number
        jobId: string
        title: string
        chapterCount: number
        completionMode: GenerationCompletionMode
        bookMeta?: ReturnType<typeof normalizeBookMeta>
        projectDir: string
        startedAt: string
        updatedAt: string
        outline?: Outline
        nextChapterIndex: number
        completed: Array<{ index: number; title: string; fileName: string; summary?: string }>
        errors: Array<{ at: string; stage: string; index?: number; error: string }>
      }

      let existingState: PersistedState | undefined
      if (requestedProjectDir) {
        statePath = path.join(requestedProjectDir, 'state.json')
        const raw = await fs.readFile(statePath, 'utf8').catch(() => '')
        if (!raw) throw new Error('续写失败：未找到已有工程状态，请先在作品库确认该作品已生成过章节。')
        existingState = JSON.parse(raw) as PersistedState
      }

      const title = (requestedTitle || existingState?.title || '').trim() || '未命名'
      const chapterCount = targetChapterCount
      const bookMeta = normalizeBookMeta(input.bookMeta ?? (existingState?.bookMeta as GenerationBookMeta | undefined))
      const completionMode = normalizeCompletionMode(input.completionMode ?? existingState?.completionMode)
      const storyContext = buildStoryContext(title, bookMeta, completionMode)
      const storyRules = buildMetaRules(bookMeta)
      const completionRules = buildCompletionRules(completionMode, chapterCount)
      const completionRuleText = completionRules.map((rule) => `- ${rule}`).join('\n')

      emit({
        type: 'progress',
        jobId,
        phase: 'init',
        message: requestedProjectDir ? '读取已有工程并准备续写…' : '创建工程目录…',
        chapterCount,
      })

      let projectDir = requestedProjectDir
      if (!projectDir) {
        const project = await createProjectDir(title, chapterCount)
        projectDir = project.dir
      } else {
        await updateProjectMeta(projectDir, { title, chapterCount })
      }

      statePath = path.join(projectDir, 'state.json')
      const chaptersJsonlPath = path.join(projectDir, 'chapters.jsonl')
      const novelPath = path.join(projectDir, 'novel.md')

      const completed = Array.isArray(existingState?.completed)
        ? [...existingState.completed].sort((a, b) => a.index - b.index)
        : []
      const completedCount = completed.length
      const nextChapterIndexRaw = Number(existingState?.nextChapterIndex)
      const startChapterIndex =
        existingState && Number.isFinite(nextChapterIndexRaw) && nextChapterIndexRaw > 0
          ? Math.floor(nextChapterIndexRaw)
          : completedCount + 1

      if (requestedProjectDir && chapterCount < startChapterIndex) {
        throw new Error(`当前工程已生成到第 ${startChapterIndex - 1} 章。请输入更大的目标总章数来续写。`)
      }

      const persistBase: PersistedState = existingState
        ? {
            ...existingState,
            version: 1,
            jobId,
            title,
            chapterCount,
            completionMode,
            bookMeta,
            projectDir,
            updatedAt: new Date().toISOString(),
            nextChapterIndex: startChapterIndex,
            completed,
            errors: Array.isArray(existingState.errors) ? existingState.errors : [],
          }
        : {
            version: 1,
            jobId,
            title,
            chapterCount,
            completionMode,
            bookMeta,
            projectDir,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            nextChapterIndex: 1,
            completed: [],
            errors: [],
          }

      await writeJsonAtomic(statePath, persistBase)
      await writeJsonAtomic(path.join(projectDir, 'book-meta.json'), {
        title,
        completionMode,
        completionModeLabel: completionModeLabel(completionMode),
        ...bookMeta,
      })

      const readState = async (): Promise<PersistedState> => {
        const raw = await fs.readFile(statePath, 'utf8').catch(() => '')
        if (!raw) return persistBase
        try {
          return JSON.parse(raw) as PersistedState
        } catch {
          return persistBase
        }
      }

      const persistError = async (stage: string, error: unknown, index?: number) => {
        const message = error instanceof Error ? error.message : String(error)
        const cur = await readState()
        const errors = Array.isArray(cur.errors) ? cur.errors : []
        errors.push({ at: new Date().toISOString(), stage, index, error: message })
        await writeJsonAtomic(statePath, { ...cur, errors, updatedAt: new Date().toISOString() })
      }

      const persistPatch = async (patch: Partial<PersistedState>) => {
        const cur = await readState()
        const next: PersistedState = { ...cur, ...patch, updatedAt: new Date().toISOString() }
        await writeJsonAtomic(statePath, next)
      }

      const persistCompleted = async (entry: { index: number; title: string; fileName: string; summary?: string }) => {
        const cur = await readState()
        const completed = Array.isArray(cur.completed) ? cur.completed : []
        if (!completed.some((x) => x.index === entry.index)) completed.push(entry)
        const next: PersistedState = { ...cur, completed, updatedAt: new Date().toISOString() }
        await writeJsonAtomic(statePath, next)
      }

      const buildContinuationContext = async () => {
        if (startChapterIndex <= 1 || !completed.length) return ''

        emit({
          type: 'progress',
          jobId,
          phase: 'continuity',
          chapterCount,
          message: `读取前 ${completed.length} 章并整理续写上下文…`,
        })

        const previousChapters = await readChaptersMarkdown({
          projectDir,
          chapterIndices: completed.map((item) => item.index),
        })
        if (!previousChapters.length) return ''

        const batchSummaries: string[] = []
        for (let start = 0; start < previousChapters.length; start += CONTINUATION_SUMMARY_BATCH_SIZE) {
          const batch = previousChapters.slice(start, start + CONTINUATION_SUMMARY_BATCH_SIZE)
          const rangeText = `第${batch[0].index}-${batch[batch.length - 1].index}章`
          emit({
            type: 'progress',
            jobId,
            phase: 'continuity',
            chapterCount,
            message: `整理前文脉络：${rangeText}…`,
          })

          const batchSource = batch
            .map((chapter) => `## 第${chapter.index}章 ${chapter.title}\n${chapter.markdown}`)
            .join('\n\n')

          const summaryText = await chatCompleteWithRetry(
            {
              baseUrl,
              apiKey,
              modelId,
              temperature: 0.3,
              messages: [
                {
                  role: 'system',
                  content:
                    '你是中文长篇小说续写助手。请认真阅读给定章节正文，提炼连续性信息，重点保留剧情推进、人物关系变化、重要线索、未回收伏笔、时间线和当前局势。',
                },
                {
                  role: 'user',
                  content:
                    storyContext +
                    `下面是 ${rangeText} 的完整正文，请输出严格 JSON（不要任何额外文字）：\n` +
                    '{ "summary": "..." }\n' +
                    '要求：summary 400-700 字，必须写清这一批章节里发生了什么、人物状态如何变化、遗留了哪些悬念，供后续续写使用。\n\n' +
                    batchSource,
                },
              ],
            },
            { signal: abort.signal },
          )

          const parsed =
            tryParseJson<{ summary?: string }>(summaryText) ??
            (await repairJson<{ summary?: string }>({
              baseUrl,
              apiKey,
              modelId,
              signal: abort.signal,
              rawText: summaryText,
              schemaHint: '{ "summary": "..." }',
            }))
          const summary = (parsed?.summary || '').trim()
          if (summary) batchSummaries.push(`${rangeText}：${summary}`)
        }

        if (!batchSummaries.length) return ''

        emit({
          type: 'progress',
          jobId,
          phase: 'continuity',
          chapterCount,
          message: '合并前文摘要，生成续写脉络…',
        })

        const mergedText = await chatCompleteWithRetry(
          {
            baseUrl,
            apiKey,
            modelId,
            temperature: 0.25,
            messages: [
              {
                role: 'system',
                content:
                  '你是中文长篇小说续写统筹助手。请把多个章节批次摘要整合为一份高质量续写脉络，确保人物、线索、冲突和当前局面清晰完整。',
              },
              {
                role: 'user',
                content:
                  storyContext +
                  `当前已完成章节：1-${startChapterIndex - 1}\n` +
                  '下面是按批次整理的前文摘要，请输出严格 JSON（不要任何额外文字）：\n' +
                  '{ "summary": "..." }\n' +
                  '要求：summary 800-1500 字，至少包含：主线推进、角色关系现状、关键证据/伏笔、最近局势、续写时绝不能写错的事实，以及第下一章必须承接的现场状态。\n\n' +
                  batchSummaries.join('\n\n'),
              },
            ],
          },
          { signal: abort.signal },
        )

        const merged =
          tryParseJson<{ summary?: string }>(mergedText) ??
          (await repairJson<{ summary?: string }>({
            baseUrl,
            apiKey,
            modelId,
            signal: abort.signal,
            rawText: mergedText,
            schemaHint: '{ "summary": "..." }',
          }))
        const summary = (merged?.summary || '').trim()
        if (summary) {
          await fs.writeFile(path.join(projectDir, 'continuity-context.txt'), summary, 'utf8').catch(() => {})
        }
        return summary
      }

      const continuationContext = await buildContinuationContext().catch(async (e) => {
        await persistError('continuity', e)
        return ''
      })

      const generateOutline = async (): Promise<Outline | undefined> => {
        const system =
          '你是专业中文网络小说写作助手。目标：写一部长篇网文，节奏明快、爽点明确、人物动机清晰、铺垫与回收完整，并严格遵守给定的新书资料。'
        const existingOutline = persistBase.outline
        const existingSynopsis = (existingOutline?.synopsis || '').trim()
        const prefixChapters = Array.isArray(existingOutline?.chapters)
          ? existingOutline.chapters
              .filter((c) => Number.isFinite(Number(c?.index)) && Number(c.index) < startChapterIndex)
              .map((c) => ({
                index: Math.floor(Number(c.index)),
                title: String(c.title || `第${c.index}章`),
                summary: String(c.summary || ''),
              }))
          : []

        if (startChapterIndex > chapterCount) {
          return existingOutline
        }

        const continuationTail = completed
          .slice(Math.max(0, completed.length - 5))
          .map((c) => `第${c.index}章《${c.title}》：${c.summary || '（无）'}`)
          .join('\n')

        if (startChapterIndex > 1) {
          const singleCall = async () => {
            const outlineText = await chatCompleteWithRetry(
              {
                baseUrl,
                apiKey,
                modelId,
                temperature: 0.45,
                messages: [
                  { role: 'system', content: system },
                  {
                    role: 'user',
                    content:
                      storyContext +
                      `当前已完成章节：1-${startChapterIndex - 1}\n` +
                      `本次目标总章节数：${chapterCount}\n` +
                      (existingSynopsis ? `既有总梗概：${existingSynopsis}\n` : '') +
                      (continuationContext ? `前文通读摘要：\n${continuationContext}\n` : '') +
                      (continuationTail ? `最近已完成章节要点：\n${continuationTail}\n` : '') +
                      `写作约束：\n${storyRules}\n\n` +
                      `完结/连载要求：\n${completionRuleText}\n\n` +
                      `请只为第 ${startChapterIndex}-${chapterCount} 章续写章节大纲。\n` +
                      '请输出严格 JSON（不要任何额外文字），格式：\n' +
                      '{ "chapters": [ { "index": 51, "title": "...", "summary": "..." } ] }\n' +
                      `要求：chapters 仅包含 index=${startChapterIndex}..${chapterCount}；每章 summary 2-4 句，包含冲突/转折/钩子；必须紧接前文，不能重写前面的章节。`,
                  },
                ],
              },
              { signal: abort.signal },
            )

            await fs.writeFile(path.join(projectDir, `outline.continue.${startChapterIndex}-${chapterCount}.raw.txt`), outlineText, 'utf8')
            const parsed =
              tryParseJson<{ chapters?: Outline['chapters'] }>(outlineText) ??
              (await repairJson<{ chapters?: Outline['chapters'] }>({
                baseUrl,
                apiKey,
                modelId,
                signal: abort.signal,
                rawText: outlineText,
                schemaHint: '{ "chapters": [ { "index": 51, "title": "...", "summary": "..." } ] }',
              }))

            const batch = Array.isArray(parsed?.chapters) ? parsed.chapters : []
            const chapters = batch
              .flatMap((item) => {
                const idx = Number(item?.index)
                if (!Number.isFinite(idx) || idx < startChapterIndex || idx > chapterCount) return []
                return [{ index: Math.floor(idx), title: String(item.title || `第${idx}章`), summary: String(item.summary || '') }]
              })
              .sort((a, b) => a.index - b.index)

            if (chapters.length !== chapterCount - startChapterIndex + 1) return undefined
            const merged = { synopsis: existingSynopsis, chapters: [...prefixChapters, ...chapters] }
            await writeJsonAtomic(path.join(projectDir, 'outline.json'), merged)
            return merged
          }

          const chunked = async () => {
            const chapters: Outline['chapters'] = [...prefixChapters]
            for (let start = startChapterIndex; start <= chapterCount; start += OUTLINE_BATCH_SIZE) {
              const end = Math.min(chapterCount, start + OUTLINE_BATCH_SIZE - 1)
              const job = jobs.get(jobId)
              if (!job || job.cancelled) throw new Error('已取消')

              const tail = chapters
                .slice(Math.max(0, chapters.length - 4))
                .map((c) => `第${c.index}章《${c.title}》：${c.summary}`)
                .join('\n')

              emit({
                type: 'progress',
                jobId,
                phase: 'outline',
                chapterCount,
                message: `生成续写大纲：第 ${start}-${end} 章…`,
              })

              const batchText = await chatCompleteWithRetry(
                {
                  baseUrl,
                  apiKey,
                  modelId,
                  temperature: 0.45,
                  messages: [
                    { role: 'system', content: system },
                    {
                      role: 'user',
                      content:
                        storyContext +
                        `当前已完成章节：1-${startChapterIndex - 1}\n` +
                        (existingSynopsis ? `既有总梗概：${existingSynopsis}\n` : '') +
                        (continuationContext ? `前文通读摘要：\n${continuationContext}\n` : '') +
                        (tail || continuationTail ? `前文承接要点：\n${tail || continuationTail}\n` : '') +
                        `写作约束：\n${storyRules}\n` +
                        `完结/连载要求：\n${completionRuleText}\n` +
                        `\n请为第 ${start}-${end} 章续写章节大纲。\n` +
                        '请输出严格 JSON（不要任何额外文字），格式：\n' +
                        '{ "chapters": [ { "index": 51, "title": "...", "summary": "..." } ] }\n' +
                        `要求：chapters 仅包含 index=${start}..${end}；要紧接前文，不要重写旧章节，不要让人物关系断层。`,
                    },
                  ],
                },
                { signal: abort.signal },
              )

              const rawPath = path.join(projectDir, `outline.continue.batch-${String(start).padStart(3, '0')}-${String(end).padStart(3, '0')}.raw.txt`)
              await fs.writeFile(rawPath, batchText, 'utf8')

              const parsed =
                tryParseJson<{ chapters?: Outline['chapters'] }>(batchText) ??
                (await repairJson<{ chapters?: Outline['chapters'] }>({
                  baseUrl,
                  apiKey,
                  modelId,
                  signal: abort.signal,
                  rawText: batchText,
                  schemaHint: '{ "chapters": [ { "index": 51, "title": "...", "summary": "..." } ] }',
                }))

              const batch = Array.isArray(parsed?.chapters) ? parsed.chapters : null
              if (!batch || batch.length === 0) throw new Error(`续写大纲解析失败：第 ${start}-${end} 章`)

              const byIndex = new Map<number, Outline['chapters'][number]>()
              for (const item of batch) {
                const idx = Number(item?.index)
                if (!Number.isFinite(idx) || idx < start || idx > end) continue
                byIndex.set(Math.floor(idx), {
                  index: Math.floor(idx),
                  title: String(item.title || `第${idx}章`),
                  summary: String(item.summary || ''),
                })
              }

              for (let i = start; i <= end; i++) {
                chapters.push(byIndex.get(i) ?? { index: i, title: `第${i}章`, summary: '' })
              }
            }

            const merged = { synopsis: existingSynopsis, chapters }
            await writeJsonAtomic(path.join(projectDir, 'outline.json'), merged)
            return merged
          }

          emit({ type: 'progress', jobId, phase: 'outline', message: '生成续写大纲…', chapterCount })
          if (chapterCount - startChapterIndex + 1 <= OUTLINE_CHUNK_THRESHOLD) {
            const outline = await singleCall()
            if (outline) return outline
          }
          return await chunked()
        }

        const singleCall = async () => {
          const outlineText = await chatCompleteWithRetry(
            {
              baseUrl,
              apiKey,
              modelId,
              temperature: 0.45,
              messages: [
                { role: 'system', content: system },
                {
                  role: 'user',
                  content:
                    storyContext +
                    `章节数：${chapterCount}\n\n` +
                    `写作约束：\n${storyRules}\n\n` +
                    `完结/连载要求：\n${completionRuleText}\n\n` +
                    '请输出严格 JSON（不要任何额外文字），格式：\n' +
                    '{ "synopsis": "...", "chapters": [ { "index": 1, "title": "...", "summary": "..." } ] }\n' +
                    '要求：每章 summary 2-4 句，包含冲突/转折/钩子；章节 index 从 1 递增到章节数；章节设计必须围绕给定主角、标签和简介展开。',
                },
              ],
            },
            {
              signal: abort.signal,
              onRetry: ({ waitMs, attempt, error }) => {
                const msg = error instanceof Error ? error.message : String(error)
                emit({
                  type: 'progress',
                  jobId,
                  phase: 'outline',
                  chapterCount,
                  message: `大纲请求失败，等待 ${Math.ceil(waitMs / 1000)}s 重试（${attempt}/${MAX_CHAT_RETRIES + 1}）：${msg}`,
                })
              },
            },
          )

          await fs.writeFile(path.join(projectDir, 'outline.raw.txt'), outlineText, 'utf8')
          let outline = tryParseJson<Outline>(outlineText)
          if (!outline) {
            outline = await repairJson<Outline>({
              baseUrl,
              apiKey,
              modelId,
              signal: abort.signal,
              rawText: outlineText,
              schemaHint: '{ "synopsis": "...", "chapters": [ { "index": 1, "title": "...", "summary": "..." } ] }',
            })
          }

          if (!outline) return undefined
          if (!Array.isArray(outline.chapters) || outline.chapters.length !== chapterCount) return undefined
          await writeJsonAtomic(path.join(projectDir, 'outline.json'), outline)
          return outline
        }

        const chunked = async () => {
          const outlineDir = path.join(projectDir, 'outline-batches')
          await fs.mkdir(outlineDir, { recursive: true })

          emit({ type: 'progress', jobId, phase: 'outline', message: '生成大纲（分批）…', chapterCount })
          const synopsisText = await chatCompleteWithRetry(
            {
              baseUrl,
              apiKey,
              modelId,
              temperature: 0.45,
              messages: [
                { role: 'system', content: system },
                {
                  role: 'user',
                  content:
                    storyContext +
                    `章节数：${chapterCount}\n\n` +
                    `写作约束：\n${storyRules}\n\n` +
                    `完结/连载要求：\n${completionRuleText}\n\n` +
                    '请输出严格 JSON（不要任何额外文字），格式：\n' +
                    '{ "synopsis": "..." }\n' +
                    '要求：synopsis 200-400 字，交代主角目标、核心矛盾、爽点来源与大结局方向，并与给定简介保持一致。',
                },
              ],
            },
            { signal: abort.signal },
          )

          await fs.writeFile(path.join(outlineDir, 'synopsis.raw.txt'), synopsisText, 'utf8')
          const synObj =
            tryParseJson<{ synopsis?: string }>(synopsisText) ??
            (await repairJson<{ synopsis?: string }>({
              baseUrl,
              apiKey,
              modelId,
              signal: abort.signal,
              rawText: synopsisText,
              schemaHint: '{ "synopsis": "..." }',
            }))
          const synopsis = (synObj?.synopsis || '').trim()

          const chapters: Outline['chapters'] = []
          const byIndex = new Map<number, Outline['chapters'][number]>()

          for (let start = 1; start <= chapterCount; start += OUTLINE_BATCH_SIZE) {
            const end = Math.min(chapterCount, start + OUTLINE_BATCH_SIZE - 1)
            const job = jobs.get(jobId)
            if (!job || job.cancelled) throw new Error('已取消')

            const tail = chapters
              .slice(Math.max(0, chapters.length - 3))
              .map((c) => `第${c.index}章《${c.title}》：${c.summary}`)
              .join('\n')

            emit({
              type: 'progress',
              jobId,
              phase: 'outline',
              chapterCount,
              message: `生成大纲：第 ${start}-${end} 章…`,
            })

            const batchText = await chatCompleteWithRetry(
              {
                baseUrl,
                apiKey,
                modelId,
                temperature: 0.45,
                messages: [
                  { role: 'system', content: system },
                  {
                    role: 'user',
                    content:
                      storyContext +
                      (synopsis ? `总梗概：${synopsis}\n` : '') +
                      (tail ? `已生成的前文要点（承接用）：\n${tail}\n` : '') +
                      `写作约束：\n${storyRules}\n` +
                      `完结/连载要求：\n${completionRuleText}\n` +
                      `\n请为第 ${start}-${end} 章生成章节大纲。\n` +
                      '请输出严格 JSON（不要任何额外文字），格式：\n' +
                      '{ "chapters": [ { "index": 1, "title": "...", "summary": "..." } ] }\n' +
                      `要求：chapters 仅包含 index=${start}..${end}，不能越界；每章 summary 2-4 句，包含冲突/转折/钩子；保证章节衔接自然；不要新增与资料不一致的主角名。`,
                  },
                ],
              },
              { signal: abort.signal },
            )

            const rawPath = path.join(outlineDir, `batch-${String(start).padStart(3, '0')}-${String(end).padStart(3, '0')}.raw.txt`)
            await fs.writeFile(rawPath, batchText, 'utf8')

            const parsed =
              tryParseJson<{ chapters?: Outline['chapters'] }>(batchText) ??
              (await repairJson<{ chapters?: Outline['chapters'] }>({
                baseUrl,
                apiKey,
                modelId,
                signal: abort.signal,
                rawText: batchText,
                schemaHint: '{ "chapters": [ { "index": 1, "title": "...", "summary": "..." } ] }',
              }))

            const batch = Array.isArray(parsed?.chapters) ? parsed?.chapters : null
            if (!batch || batch.length === 0) throw new Error(`大纲解析失败：第 ${start}-${end} 章`)

            for (const item of batch) {
              const idx = Number(item?.index)
              if (!Number.isFinite(idx) || idx < start || idx > end) continue
              const rec = { index: idx, title: String(item.title || `第${idx}章`), summary: String(item.summary || '') }
              byIndex.set(idx, rec)
            }

            for (let i = start; i <= end; i++) {
              const rec = byIndex.get(i) ?? { index: i, title: `第${i}章`, summary: '' }
              chapters.push(rec)
            }

            await writeJsonAtomic(path.join(projectDir, 'outline.json'), { synopsis, chapters })
          }

          return { synopsis, chapters }
        }

        emit({ type: 'progress', jobId, phase: 'outline', message: '生成大纲…', chapterCount })
        if (chapterCount <= OUTLINE_CHUNK_THRESHOLD) {
          const outline = await singleCall()
          if (outline) return outline
        }
        return await chunked()
      }

      const outline = await generateOutline().catch(async (e) => {
        await persistError('outline', e)
        throw e
      })
      if (outline) {
        await persistPatch({ outline })
      }

      const novelHeader =
        `# ${title}\n\n` +
        renderCompletionModeMarkdown(completionMode) +
        renderBookMetaMarkdown(bookMeta) +
        (outline?.synopsis ? `> 梗概：${outline.synopsis}\n\n` : '')
      if (!existingState) {
        await fs.writeFile(novelPath, novelHeader, 'utf8')
      } else {
        await fs.access(novelPath).catch(async () => {
          await fs.writeFile(novelPath, novelHeader, 'utf8')
        })
      }

      const plannedByIndex = new Map<number, { title: string; summary: string }>()
      for (const c of outline?.chapters ?? []) {
        plannedByIndex.set(c.index, { title: c.title, summary: c.summary })
      }

      const chaptersForUi: GeneratedChapter[] = []
      const recentSummaryWindow: Array<{ index: number; title: string; summary?: string }> = completed
        .slice(Math.max(0, completed.length - 12))
        .map((c) => ({ index: c.index, title: c.title, summary: c.summary }))
      for (let i = startChapterIndex; i <= chapterCount; i++) {
        const job = jobs.get(jobId)
        if (!job || job.cancelled) throw new Error('已取消')

        const planned = plannedByIndex.get(i)
        const chapterTitle = planned?.title || `第${i}章`
        const chapterSummary = planned?.summary || ''
        const chapterStageRule = buildChapterStageRule({ completionMode, chapterIndex: i, chapterCount })
        emit({
          type: 'progress',
          jobId,
          phase: 'chapter',
          chapterIndex: i,
          chapterCount,
          message: `生成第 ${i}/${chapterCount} 章：${chapterTitle}`,
        })

        const recentSummaries = recentSummaryWindow
          .slice(Math.max(0, recentSummaryWindow.length - 4))
          .map((c) => `第${c.index}章《${c.title}》：${c.summary || '（无）'}`)
          .join('\n')

        const chapterText = await chatCompleteWithRetry(
          {
            baseUrl,
            apiKey,
            modelId,
            temperature: 0.8,
            messages: [
              {
                role: 'system',
                content:
                  '你是中文网文作者。写作要求：人物对话自然；场景细节具体；避免说教；尽量避免重复套话；严格遵守既定主角名与作品简介；除非明确要求写最终章，否则章节结尾要保留悬念或追读钩子。',
              },
              {
                role: 'user',
                content:
                  storyContext +
                  (outline?.synopsis ? `总梗概：${outline.synopsis}\n` : '') +
                  (continuationContext ? `前文通读摘要：\n${continuationContext}\n` : '') +
                  (chapterSummary ? `本章大纲：${chapterSummary}\n` : '') +
                  (recentSummaries ? `前文要点：\n${recentSummaries}\n` : '') +
                  `写作约束：\n${storyRules}\n` +
                  `阶段要求：${chapterStageRule}\n` +
                  `\n请写第${i}章《${chapterTitle}》。字数目标：2000-3500 汉字。\n` +
                  '请输出严格 JSON（不要任何额外文字），格式：\n' +
                  '{ "title": "...", "content": "...", "summary": "..." }\n' +
                  'content 为正文，summary 为 2-3 句章节总结（便于后续续写）。如果给定了主角名，正文必须自然写出至少一个主角名。',
              },
            ],
          },
          {
            signal: abort.signal,
            onRetry: ({ waitMs, attempt, error }) => {
              const msg = error instanceof Error ? error.message : String(error)
              emit({
                type: 'progress',
                jobId,
                phase: 'chapter',
                chapterIndex: i,
                chapterCount,
                message: `请求失败，等待 ${Math.ceil(waitMs / 1000)}s 重试（${attempt}/${MAX_CHAT_RETRIES + 1}）：${msg}`,
              })
            },
          },
        )

        let parsed = tryParseJson<{ title?: string; content?: string; summary?: string }>(chapterText)
        if (!parsed) {
          parsed = await repairJson<{ title?: string; content?: string; summary?: string }>({
            baseUrl,
            apiKey,
            modelId,
            signal: abort.signal,
            rawText: chapterText,
            schemaHint: '{ "title": "...", "content": "...", "summary": "..." }',
          })
        }
        let finalTitle = (parsed?.title || chapterTitle).trim()
        let content = (parsed?.content || chapterText).trim()
        let finalSummary = (parsed?.summary || '').trim() || undefined

        if (bookMeta.protagonists.length && !hasProtagonistMention(content, bookMeta.protagonists)) {
          emit({
            type: 'progress',
            jobId,
            phase: 'chapter',
            chapterIndex: i,
            chapterCount,
            message: `检测到第 ${i} 章未出现主角名，正在修正…`,
          })

          const repairedText = await chatCompleteWithRetry(
            {
              baseUrl,
              apiKey,
              modelId,
              temperature: 0.4,
              messages: [
                {
                  role: 'system',
                  content: '你是中文小说改写助手。请保持原章节剧情、节奏与悬念，只修正设定一致性问题。',
                },
                {
                  role: 'user',
                  content:
                    storyContext +
                    `必须保留的主角名：${bookMeta.protagonists.join('、')}\n` +
                    (outline?.synopsis ? `总梗概：${outline.synopsis}\n` : '') +
                    (continuationContext ? `前文通读摘要：\n${continuationContext}\n` : '') +
                    `当前章节：第${i}章《${chapterTitle}》\n` +
                    `本章大纲：${chapterSummary || '无'}\n` +
                    `修正要求：\n${storyRules}\n` +
                    '下面这段正文没有自然出现主角名，请在不改变核心剧情的前提下改写，并输出严格 JSON：\n' +
                    '{ "title": "...", "content": "...", "summary": "..." }\n\n' +
                    `原正文：\n${content}`,
                },
              ],
            },
            { signal: abort.signal },
          )

          let repaired = tryParseJson<{ title?: string; content?: string; summary?: string }>(repairedText)
          if (!repaired) {
            repaired = await repairJson<{ title?: string; content?: string; summary?: string }>({
              baseUrl,
              apiKey,
              modelId,
              signal: abort.signal,
              rawText: repairedText,
              schemaHint: '{ "title": "...", "content": "...", "summary": "..." }',
            })
          }

          const repairedContent = (repaired?.content || '').trim()
          if (repairedContent && hasProtagonistMention(repairedContent, bookMeta.protagonists)) {
            finalTitle = (repaired?.title || finalTitle).trim()
            content = repairedContent
            finalSummary = (repaired?.summary || '').trim() || finalSummary
          }
        }

        const ch: GeneratedChapter = {
          index: i,
          title: finalTitle,
          content,
          summary: finalSummary,
        }

        const chapterDir = path.join(projectDir, 'chapters')
        await fs.mkdir(chapterDir, { recursive: true })
        const fileName = `${String(i).padStart(3, '0')}-${ch.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50)}.md`
        await fs.writeFile(path.join(chapterDir, fileName), toMdChapter(ch), 'utf8')
        await fs.appendFile(novelPath, `\n${toMdChapter(ch)}\n`, 'utf8')
        await fs.appendFile(chaptersJsonlPath, `${JSON.stringify(ch)}\n`, 'utf8')

        recentSummaryWindow.push({ index: ch.index, title: ch.title, summary: ch.summary })
        if (recentSummaryWindow.length > 12) recentSummaryWindow.splice(0, recentSummaryWindow.length - 12)

        if (chaptersForUi.length < UI_CHAPTER_LIMIT) chaptersForUi.push(ch)
        await persistCompleted({ index: ch.index, title: ch.title, fileName, summary: ch.summary }).catch(async (e) => {
          await persistError('persist', e, i)
        })
        await persistPatch({ nextChapterIndex: i + 1 }).catch(async (e) => {
          await persistError('persist', e, i)
        })

        // 给长跑一点喘息，减少触发限流概率
        await sleep(250, abort.signal)
      }

      const result: GenerationResult = { jobId, projectDir, outline, chapters: chaptersForUi }
      emit({ type: 'complete', jobId, result })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (statePath) {
        try {
          const raw = await fs.readFile(statePath, 'utf8').catch(() => '')
          const cur = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
          const errors = Array.isArray(cur.errors) ? (cur.errors as unknown[]) : []
          errors.push({ at: new Date().toISOString(), stage: 'fatal', error: message })
          await writeJsonAtomic(statePath, { ...cur, errors, updatedAt: new Date().toISOString() })
        } catch {
          // ignore
        }
      }
      emit({ type: 'error', jobId, error: message })
    } finally {
      jobs.delete(jobId)
    }
  })()

  return jobId
}
