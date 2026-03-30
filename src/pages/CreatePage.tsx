import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Field, InlineCode, NumberInput, TextArea, TextInput } from '../components/ui'

type ReaderType = '男频' | '女频'
type CompletionMode = 'completed' | 'ongoing'
type GeneratedChapter = { index: number; title: string; content: string }
type Project = { id: string; title: string; createdAt: string; dir: string; chapterCount: number }
type ProjectDetail = {
  project: Project
  state: {
    title: string
    chapterCount: number
    completed: Array<{ index: number; title: string; summary?: string }>
    nextChapterIndex?: number
    completionMode?: CompletionMode
  }
  bookMeta: {
    title: string
    targetReader?: ReaderType
    tags: string[]
    protagonists: string[]
    intro: string
    completionMode?: CompletionMode
  }
}
type GenEvent =
  | { type: 'progress'; jobId: string; phase: string; message: string; chapterIndex?: number; chapterCount?: number }
  | { type: 'complete'; jobId: string; result: { projectDir: string; chapters: unknown } }
  | { type: 'error'; jobId: string; error: string }

type CoverMeta = {
  title: string
  targetReader: ReaderType
  tags: string[]
  protagonists: string[]
  intro: string
}

const DEFAULT_PUBLISHER_URL = 'https://fanqienovel.com/main/writer/home'

function escapeXml(text: string) {
  return text.replace(/[&<>"']/g, (char) => {
    if (char === '&') return '&amp;'
    if (char === '<') return '&lt;'
    if (char === '>') return '&gt;'
    if (char === '"') return '&quot;'
    return '&apos;'
  })
}

function wrapLines(text: string, maxChars: number, maxLines: number) {
  const normalized = String(text ?? '').replace(/\s+/g, '')
  if (!normalized) return []
  const lines: string[] = []
  for (let i = 0; i < normalized.length && lines.length < maxLines; i += maxChars) {
    lines.push(normalized.slice(i, i + maxChars))
  }
  if (normalized.length > maxChars * maxLines && lines.length) {
    const last = lines.length - 1
    lines[last] = `${lines[last].slice(0, Math.max(0, maxChars - 1))}…`
  }
  return lines
}

function pickCoverPalette(targetReader: ReaderType) {
  return targetReader === '女频'
    ? ['#221126', '#5f2567', '#ee6fc0', '#ffd1ef']
    : ['#081225', '#122f5f', '#3f8cff', '#9bd1ff']
}

function buildCoverSvg(meta: CoverMeta) {
  const [bg1, bg2, accent, textSoft] = pickCoverPalette(meta.targetReader)
  const titleLines = wrapLines(meta.title || '未命名小说', 6, 3)
  const introLines = wrapLines(meta.intro || '填写书名与资料后，可直接下载本地封面。', 16, 3)
  const tags = meta.tags.slice(0, 4)
  const protagonists = meta.protagonists.slice(0, 2).join(' · ')
  const badge = meta.targetReader
  const topLine = tags.length ? `${tags.join(' · ')} · ${badge}` : `${badge}作品`

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${bg1}" />
          <stop offset="100%" stop-color="${bg2}" />
        </linearGradient>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(0,0,0,0.2)" />
          <stop offset="100%" stop-color="rgba(0,0,0,0.75)" />
        </linearGradient>
      </defs>
      <rect width="900" height="1200" rx="48" fill="url(#bg)" />
      <circle cx="760" cy="160" r="180" fill="${accent}" fill-opacity="0.2" />
      <circle cx="160" cy="1020" r="220" fill="${accent}" fill-opacity="0.14" />
      <rect width="900" height="1200" rx="48" fill="url(#shade)" />
      <rect x="66" y="66" width="768" height="1068" rx="36" fill="none" stroke="rgba(255,255,255,0.16)" />
      <text x="450" y="118" text-anchor="middle" font-size="26" letter-spacing="8" fill="rgba(255,255,255,0.9)" font-family="Microsoft YaHei, sans-serif">${escapeXml(topLine)}</text>
      <g transform="translate(88 270)">
        ${titleLines.map((line, index) => `<text x="0" y="${index * 108}" font-size="92" font-weight="900" fill="#ffffff" font-family="Microsoft YaHei, sans-serif">${escapeXml(line)}</text>`).join('')}
      </g>
      <rect x="86" y="520" width="728" height="130" rx="18" fill="rgba(0,0,0,0.38)" />
      <g transform="translate(104 566)">
        ${introLines.map((line, index) => `<text x="0" y="${index * 40}" font-size="28" fill="#ffffff" font-family="Microsoft YaHei, sans-serif">${escapeXml(line)}</text>`).join('')}
      </g>
      ${protagonists ? `<text x="450" y="1036" text-anchor="middle" font-size="38" fill="#ffffff" font-family="Microsoft YaHei, sans-serif">主角：${escapeXml(protagonists)}</text>` : ''}
      <text x="450" y="1144" text-anchor="middle" font-size="22" letter-spacing="4" fill="${textSoft}" font-family="Microsoft YaHei, sans-serif">AI NOVEL STUDIO COVER</text>
    </svg>
  `.trim()
}

async function downloadSvgAsPng(svg: string, fileName: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('封面渲染失败'))
      img.src = url
    })

    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 1200
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((nextBlob) => {
        if (nextBlob) resolve(nextBlob)
        else reject(new Error('封面导出失败'))
      }, 'image/png')
    })

    const downloadUrl = URL.createObjectURL(pngBlob)
    try {
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = fileName
      link.click()
    } finally {
      URL.revokeObjectURL(downloadUrl)
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function toChapters(raw: unknown): GeneratedChapter[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const index = typeof record.index === 'number' ? record.index : Number(record.index)
      const title = typeof record.title === 'string' ? record.title : ''
      const content = typeof record.content === 'string' ? record.content : ''
      if (!Number.isFinite(index) || index <= 0) return null
      return { index, title, content }
    })
    .filter((item): item is GeneratedChapter => Boolean(item))
}

export default function CreatePage() {
  const [title, setTitle] = useState('')
  const [chapterCount, setChapterCount] = useState(20)
  const [completionMode, setCompletionMode] = useState<CompletionMode>('completed')
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [selectedProjectDir, setSelectedProjectDir] = useState('')
  const [selectedProjectDetail, setSelectedProjectDetail] = useState<ProjectDetail>()
  const [projectDetailLoading, setProjectDetailLoading] = useState(false)
  const [metaTargetReader, setMetaTargetReader] = useState<ReaderType>('男频')
  const [metaTags, setMetaTags] = useState('')
  const [metaProtagonists, setMetaProtagonists] = useState('')
  const [metaIntro, setMetaIntro] = useState('')
  const [metaError, setMetaError] = useState('')
  const [metaLoading, setMetaLoading] = useState(false)
  const [metaDirty, setMetaDirty] = useState(false)
  const [autoMeta, setAutoMeta] = useState(true)
  const [coverDownloading, setCoverDownloading] = useState(false)
  const [publisherUrl, setPublisherUrl] = useState(DEFAULT_PUBLISHER_URL)
  const [availableTokens, setAvailableTokens] = useState<number | null>(null)
  const [jobId, setJobId] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ phase: string; message: string; chapterIndex?: number; chapterCount?: number }>({ phase: '', message: '' })
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ projectDir: string; chapters: GeneratedChapter[] }>()
  const metaReq = useRef(0)
  const lastMetaTitle = useRef('')

  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true)
    try {
      const list = await window.api.projects.list()
      setProjects(list)
    } finally {
      setProjectsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshProjects()
    void (async () => {
      try {
        const settings = await window.api.settings.get()
        setPublisherUrl(settings.publisherUrl?.trim() || DEFAULT_PUBLISHER_URL)
      } catch {
        setPublisherUrl(DEFAULT_PUBLISHER_URL)
      }
    })()
    void (async () => {
      try {
        const b = await window.api.billing.get()
        setAvailableTokens(b.balance)
      } catch {
        setAvailableTokens(null)
      }
    })()
  }, [refreshProjects])

  useEffect(() => {
    const off = window.api.generation.onEvent((raw) => {
      const ev = raw as GenEvent
      if (!ev || !('type' in ev)) return
      if (jobId && 'jobId' in ev && ev.jobId !== jobId) return
      if (ev.type === 'progress') {
        setProgress({ phase: ev.phase, message: ev.message, chapterIndex: ev.chapterIndex, chapterCount: ev.chapterCount })
      } else if (ev.type === 'error') {
        setRunning(false)
        setError(ev.error || '未知错误')
      } else {
        setRunning(false)
        setError('')
        setResult({ projectDir: String(ev.result?.projectDir ?? ''), chapters: toChapters(ev.result?.chapters) })
        void refreshProjects()
      }
    })
    return () => off()
  }, [jobId, refreshProjects])

  useEffect(() => {
    let cancelled = false
    if (!selectedProjectDir) {
      setSelectedProjectDetail(undefined)
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      setProjectDetailLoading(true)
      setError('')
      try {
        const detail = await window.api.projects.detail({ projectDir: selectedProjectDir })
        if (cancelled) return
        setSelectedProjectDetail(detail)
        setTitle(detail.bookMeta.title || detail.state.title || detail.project.title || '')
        setMetaTargetReader(detail.bookMeta.targetReader === '女频' ? '女频' : '男频')
        setMetaTags(detail.bookMeta.tags.join('，'))
        setMetaProtagonists(detail.bookMeta.protagonists.join('，'))
        setMetaIntro(detail.bookMeta.intro || '')
        setCompletionMode(detail.bookMeta.completionMode ?? detail.state.completionMode ?? 'ongoing')
        setChapterCount(Math.max(detail.state.chapterCount, detail.state.completed.length + 1))
        setMetaDirty(false)
        setMetaError('')
        lastMetaTitle.current = detail.bookMeta.title || detail.state.title || detail.project.title || ''
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setProjectDetailLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedProjectDir])

  const existingCompletedCount = selectedProjectDetail?.state.completed.length ?? 0
  const nextChapterIndex = selectedProjectDetail?.state.nextChapterIndex ?? existingCompletedCount + 1
  const plannedChapterCount = useMemo(() => {
    const total = Math.max(0, Math.floor(Number(chapterCount) || 0))
    if (selectedProjectDir && selectedProjectDetail) {
      return Math.max(0, total - existingCompletedCount)
    }
    return total
  }, [chapterCount, selectedProjectDir, selectedProjectDetail, existingCompletedCount])

  const tokenEstimate = useMemo(() => {
    // 粗略估算：每章输入+输出+上下文约 4200 token，首章额外准备成本约 1600 token
    const base = plannedChapterCount * 4200 + 1600
    const modeExtra = completionMode === 'completed' ? 800 : 0
    const tagsCount = String(metaTags ?? '').split(/[，、,\n]/g).map((item) => item.trim()).filter(Boolean).length
    const protagonistsCount = String(metaProtagonists ?? '').split(/[，、,\n]/g).map((item) => item.trim()).filter(Boolean).length
    const metaExtra = (title.trim() ? 120 : 0) + (metaIntro.trim() ? 220 : 0) + tagsCount * 35 + protagonistsCount * 45
    const estimate = Math.max(0, base + modeExtra + metaExtra)
    const low = Math.floor(estimate * 0.8)
    const high = Math.ceil(estimate * 1.25)
    return { estimate, low, high }
  }, [plannedChapterCount, completionMode, title, metaIntro, metaTags, metaProtagonists])
  const parsedTags = useMemo(() => String(metaTags ?? '').split(/[，、,\n]/g).map((item) => item.trim()).filter(Boolean).slice(0, 8), [metaTags])
  const parsedProtagonists = useMemo(() => String(metaProtagonists ?? '').split(/[，、,\n]/g).map((item) => item.trim()).filter(Boolean).slice(0, 3), [metaProtagonists])
  const coverSvg = useMemo(
    () => buildCoverSvg({ title: title.trim() || '未命名小说', targetReader: metaTargetReader, tags: parsedTags, protagonists: parsedProtagonists, intro: metaIntro.trim() }),
    [title, metaTargetReader, parsedTags, parsedProtagonists, metaIntro],
  )

  const canStart = useMemo(() => {
    if (running || !title.trim() || !Number.isFinite(chapterCount) || chapterCount < 1) return false
    if (availableTokens !== null && availableTokens < tokenEstimate.estimate) return false
    if (!selectedProjectDir) return true
    if (!selectedProjectDetail) return false
    return chapterCount >= nextChapterIndex
  }, [running, title, chapterCount, availableTokens, tokenEstimate.estimate, selectedProjectDir, selectedProjectDetail, nextChapterIndex])

  const chapterHint = useMemo(() => {
    if (selectedProjectDir && selectedProjectDetail) {
      const tail = completionMode === 'completed' ? '这次会朝结尾方向收束。' : '这次只续写后文，保留后续空间。'
      return `当前已完成 ${existingCompletedCount} 章，下一章从第 ${nextChapterIndex} 章开始。这里填目标总章数，例如 ${existingCompletedCount + 10}，就会续写到第 ${existingCompletedCount + 10} 章。${tail}`
    }
    return completionMode === 'completed'
      ? '已完结模式下，最后一章会收束主线并写出结尾。'
      : '连载中模式下，最后一章只做阶段性收束，会保留后续空间。'
  }, [selectedProjectDir, selectedProjectDetail, completionMode, existingCompletedCount, nextChapterIndex])

  const generateBookMeta = useCallback(async (nextTitle: string, opts: { force?: boolean } = {}) => {
    const trimmed = nextTitle.trim()
    if (!trimmed) return
    if (!opts.force && metaDirty) return
    if (!opts.force && lastMetaTitle.current === trimmed) return

    setMetaError('')
    setMetaLoading(true)
    const reqId = ++metaReq.current
    try {
      const res = await window.api.publisher.generateBookMeta({ title: trimmed })
      if (reqId !== metaReq.current) return
      if (!res?.meta) throw new Error('返回为空')
      setMetaTargetReader(res.meta.targetReader === '女频' ? '女频' : '男频')
      setMetaTags(Array.isArray(res.meta.tags) ? res.meta.tags.join('，') : String(res.meta.tags ?? ''))
      setMetaProtagonists(Array.isArray(res.meta.protagonists) ? res.meta.protagonists.join('，') : String(res.meta.protagonists ?? ''))
      setMetaIntro(String(res.meta.intro ?? ''))
      setMetaDirty(false)
      lastMetaTitle.current = trimmed
    } catch (e) {
      if (reqId === metaReq.current) setMetaError(e instanceof Error ? e.message : String(e))
    } finally {
      if (reqId === metaReq.current) setMetaLoading(false)
    }
  }, [metaDirty])

  useEffect(() => {
    if (!autoMeta || metaDirty) return
    if (!title.trim() || metaTags.trim() || metaProtagonists.trim() || metaIntro.trim()) return
    const timer = window.setTimeout(() => void generateBookMeta(title), 900)
    return () => window.clearTimeout(timer)
  }, [autoMeta, metaDirty, title, metaTags, metaProtagonists, metaIntro, generateBookMeta])

  async function start() {
    setError('')
    setResult(undefined)
    setProgress({ phase: '', message: '' })
    const res = await window.api.generation.start({
      title: title.trim(),
      chapterCount: Math.floor(chapterCount),
      completionMode,
      projectDir: selectedProjectDir || undefined,
      bookMeta: { targetReader: metaTargetReader, tags: parsedTags, protagonists: parsedProtagonists, intro: metaIntro.trim() },
    })
    setJobId(res.jobId)
    setRunning(true)
  }

  async function cancel() {
    if (!jobId) return
    await window.api.generation.cancel({ jobId })
    setRunning(false)
  }

  async function injectBookMeta() {
    setMetaError('')
    try {
      await window.api.publisher.open()
      const res = await window.api.publisher.injectBookMeta({ title: title.trim(), targetReader: metaTargetReader, tags: parsedTags, protagonists: parsedProtagonists, intro: metaIntro.trim() })
      if (!res?.ok) throw new Error('请先打开番茄创建新书页面，再执行注入。')
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : String(e))
    }
  }

  async function injectChapter(chapter: GeneratedChapter, clickPublish = false) {
    setError('')
    try {
      await window.api.publisher.open()
      const res = await window.api.publisher.inject({ title: chapter.title, content: chapter.content, clickPublish })
      if (!res?.ok) throw new Error('请先打开番茄章节编辑页，再执行注入。')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function openPublisherInBrowser() {
    try {
      await window.api.os.openExternal({ url: publisherUrl || DEFAULT_PUBLISHER_URL })
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : String(e))
    }
  }

  async function downloadCover() {
    if (!title.trim()) return
    setCoverDownloading(true)
    try {
      const safeName = `${title.trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'novel'}-cover.png`
      await downloadSvgAsPng(coverSvg, safeName)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCoverDownloading(false)
    }
  }

  async function reveal(path: string) {
    try {
      await window.api.projects.reveal({ path })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function copyChapter(chapter: GeneratedChapter) {
    await navigator.clipboard.writeText(`第${chapter.index}章 ${chapter.title}\n\n${chapter.content}`)
  }
  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 1040 }}>
      <h2 style={{ margin: 0 }}>创作中心</h2>

      <Card
        title="快速生成 / 续写小说"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => void start()} disabled={!canStart} variant="primary">{selectedProjectDir ? '开始续写' : '开始生成'}</Button>
            <Button onClick={() => void cancel()} disabled={!running} variant="danger">取消</Button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <Field label="续写已有作品" hint="选中作品库里的小说后，会自动带出书名、新书资料和当前章节，并从下一章继续生成。">
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select className="input" value={selectedProjectDir} onChange={(e) => setSelectedProjectDir(e.target.value)} disabled={projectsLoading}>
                  <option value="">新建作品</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.dir}>{(project.title || '未命名作品') + `（${project.chapterCount}章）`}</option>
                  ))}
                </select>
                <Button onClick={() => void refreshProjects()} disabled={projectsLoading}>{projectsLoading ? '刷新中…' : '刷新作品库'}</Button>
                {selectedProjectDir ? <Button onClick={() => { setSelectedProjectDir(''); setSelectedProjectDetail(undefined) }}>改为新建</Button> : null}
              </div>
              {projectDetailLoading ? <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.66)' }}>正在读取已选作品资料…</div> : null}
              {selectedProjectDetail ? <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.66)' }}>已完成 <InlineCode>{existingCompletedCount}</InlineCode> 章，下一章从 <InlineCode>第 {nextChapterIndex} 章</InlineCode> 开始。</div> : null}
            </div>
          </Field>

          <Field label="小说名" hint="建议先写一个抓人的书名。">
            <TextInput value={title} onChange={setTitle} placeholder="例如：我在末世开局觉醒神级拾荒系统" />
          </Field>

          <Card
            title="新书资料（可自动生成）"
            right={
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Button onClick={() => setAutoMeta((value) => !value)}>自动生成：{autoMeta ? '开' : '关'}</Button>
                <Button onClick={() => void generateBookMeta(title, { force: true })} disabled={!title.trim() || metaLoading} variant="primary">{metaLoading ? '生成中…' : '智能生成'}</Button>
                <Button onClick={() => void downloadCover()} disabled={!title.trim() || coverDownloading}>{coverDownloading ? '导出中…' : '下载封面 PNG'}</Button>
                <Button onClick={() => void injectBookMeta()} disabled={!title.trim()}>注入到番茄新书页</Button>
                <Button onClick={() => void openPublisherInBrowser()}>打开番茄作者后台</Button>
              </div>
            }
          >
            <div style={{ display: 'grid', gap: 10 }}>
              <Field label="目标读者">
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button onClick={() => { setMetaTargetReader('男频'); setMetaDirty(true) }} variant={metaTargetReader === '男频' ? 'primary' : 'default'}>男频</Button>
                  <Button onClick={() => { setMetaTargetReader('女频'); setMetaDirty(true) }} variant={metaTargetReader === '女频' ? 'primary' : 'default'}>女频</Button>
                </div>
              </Field>
              <Field label="标签"><TextInput value={metaTags} onChange={(value) => { setMetaTags(value); setMetaDirty(true) }} placeholder="悬疑，重生，系统" /></Field>
              <Field label="主角名"><TextInput value={metaProtagonists} onChange={(value) => { setMetaProtagonists(value); setMetaDirty(true) }} placeholder="林默，沈青禾" /></Field>
              <Field label="作品简介"><TextArea value={metaIntro} onChange={(value) => { setMetaIntro(value); setMetaDirty(true) }} placeholder="一句话抓住设定，再补充冲突与爽点。" rows={5} /></Field>
              {metaError ? <div style={{ color: 'rgba(255, 120, 120, 0.92)' }}>新书资料错误：<InlineCode>{metaError}</InlineCode></div> : null}
            </div>
          </Card>

          <Field label="作品状态" hint={selectedProjectDir ? '续写时也可以切换：已完结会往结尾收束，连载中则继续保留后续空间。' : '已完结模式会写出结尾；连载中模式会继续留后续。'}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => setCompletionMode('completed')} variant={completionMode === 'completed' ? 'primary' : 'default'}>已完结</Button>
              <Button onClick={() => setCompletionMode('ongoing')} variant={completionMode === 'ongoing' ? 'primary' : 'default'}>连载中</Button>
            </div>
          </Field>

          <Field label="目标总章数" hint={chapterHint}><NumberInput value={chapterCount} onChange={setChapterCount} min={1} max={300} /></Field>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', lineHeight: 1.7 }}>
            预计本次消耗：<InlineCode>{tokenEstimate.estimate}</InlineCode> tokens（大概范围 {tokenEstimate.low} - {tokenEstimate.high}）
            <br />
            说明：这是粗略估算值，用于后续做充值与配额策略，最终账单应以服务端实际统计为准。
            <br />
            当前可用余额：
            <InlineCode>{availableTokens === null ? '未获取' : availableTokens}</InlineCode>
            {availableTokens !== null && availableTokens < tokenEstimate.estimate ? '（余额不足，请先充值）' : ''}
          </div>
          {running || progress.message ? <div style={{ color: 'rgba(255,255,255,0.78)' }}>进度：<InlineCode>{progress.phase || '...'}</InlineCode> {progress.message}</div> : null}
          {error ? <div style={{ color: 'rgba(255, 120, 120, 0.92)' }}>错误：<InlineCode>{error}</InlineCode></div> : null}
        </div>
      </Card>

      {result ? (
        <Card
          title="最新生成结果"
          right={<div style={{ display: 'flex', gap: 8 }}><Button onClick={() => void reveal(result.projectDir)} disabled={!result.projectDir}>打开项目目录</Button><Button onClick={() => void openPublisherInBrowser()}>打开番茄后台</Button></div>}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ color: 'rgba(255,255,255,0.72)' }}>本次生成 <InlineCode>{result.chapters.length}</InlineCode> 章{result.projectDir ? <>，目录：<InlineCode>{result.projectDir}</InlineCode></> : null}</div>
            {result.chapters.map((chapter) => (
              <div key={chapter.index} style={{ display: 'grid', gap: 10, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 14, background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>第 {chapter.index} 章 {chapter.title}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button onClick={() => void copyChapter(chapter)}>复制</Button>
                    <Button onClick={() => void injectChapter(chapter)} variant="primary">注入到番茄</Button>
                    <Button onClick={() => void injectChapter(chapter, true)} title="会先注入内容，再尝试点击页面上的发布按钮。请确认当前已打开章节编辑页。">注入并尝试发布</Button>
                  </div>
                </div>
                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14, background: 'rgba(0,0,0,0.2)', whiteSpace: 'pre-wrap', lineHeight: 1.82, maxHeight: 520, overflow: 'auto' }}>{chapter.content}</div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  )
}
