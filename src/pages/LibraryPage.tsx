import { useEffect, useMemo, useState } from 'react'
import { Button, Card, InlineCode } from '../components/ui'

type Project = { id: string; title: string; createdAt: string; dir: string; chapterCount: number }
type ProjectState = {
  title: string
  chapterCount: number
  completed: Array<{ index: number; title: string; summary?: string }>
}
type ProjectChapter = {
  index: number
  title: string
  content: string
  markdown: string
  summary?: string
}

const defaultPublisherUrl = 'https://fanqienovel.com/main/writer/home'

function buildChapterTitle(chapter: ProjectChapter) {
  return `第${chapter.index}章 ${chapter.title}`.trim()
}

function buildChapterPayload(chapter: ProjectChapter) {
  return `${buildChapterTitle(chapter)}\n\n${chapter.content}`.trim()
}

export default function LibraryPage() {
  const [items, setItems] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selectedProjectDir, setSelectedProjectDir] = useState('')
  const [projectState, setProjectState] = useState<ProjectState>()
  const [chapters, setChapters] = useState<ProjectChapter[]>([])
  const [chaptersLoading, setChaptersLoading] = useState(false)
  const [chaptersError, setChaptersError] = useState('')
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0)

  const [publisherUrl, setPublisherUrl] = useState(defaultPublisherUrl)
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const list = await window.api.projects.list()
      setItems(list)
      setSelectedProjectDir((current) => {
        if (current && list.some((item) => item.dir === current)) return current
        return list[0]?.dir ?? ''
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    void (async () => {
      try {
        const settings = await window.api.settings.get()
        setPublisherUrl(settings.publisherUrl?.trim() || defaultPublisherUrl)
      } catch {
        setPublisherUrl(defaultPublisherUrl)
      }
    })()
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!selectedProjectDir) {
      setProjectState(undefined)
      setChapters([])
      setChaptersError('')
      setSelectedChapterIndex(0)
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      setChaptersLoading(true)
      setChaptersError('')
      try {
        const [state, chapterList] = await Promise.all([
          window.api.projects.state({ projectDir: selectedProjectDir }),
          window.api.projects.chapters({ projectDir: selectedProjectDir }),
        ])
        if (cancelled) return
        setProjectState(state)
        setChapters(chapterList)
        setSelectedChapterIndex((current) => {
          if (current && chapterList.some((chapter) => chapter.index === current)) return current
          return chapterList[0]?.index ?? 0
        })
      } catch (e) {
        if (cancelled) return
        setProjectState(undefined)
        setChapters([])
        setSelectedChapterIndex(0)
        setChaptersError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setChaptersLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedProjectDir])

  const selectedProject = useMemo(() => items.find((item) => item.dir === selectedProjectDir), [items, selectedProjectDir])
  const selectedChapter = useMemo(() => {
    if (!chapters.length) return undefined
    return chapters.find((chapter) => chapter.index === selectedChapterIndex) ?? chapters[0]
  }, [chapters, selectedChapterIndex])

  async function copyChapter(chapter: ProjectChapter) {
    await navigator.clipboard.writeText(buildChapterPayload(chapter))
  }

  async function openSystemPublisher(copyCurrentChapter = false) {
    setActionError('')
    setActionMessage('')
    try {
      if (copyCurrentChapter && selectedChapter) {
        await copyChapter(selectedChapter)
      }
      await window.api.os.openExternal({ url: publisherUrl || defaultPublisherUrl })
      setActionMessage(copyCurrentChapter ? '已复制当前章节，并打开系统浏览器中的番茄后台。' : '已打开系统浏览器中的番茄后台。')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  async function openEmbeddedPublisher() {
    setActionError('')
    setActionMessage('')
    try {
      await window.api.publisher.open()
      setActionMessage('已打开内置番茄发布窗口。')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  async function injectChapter(chapter: ProjectChapter, clickPublish = false) {
    setActionError('')
    setActionMessage('')
    try {
      await window.api.publisher.open()
      const res = await window.api.publisher.inject({
        title: chapter.title,
        content: chapter.content,
        clickPublish,
      })
      if (!res?.ok) {
        throw new Error('注入失败：请先等待番茄页面加载完成，并打开新建章节/发布章节页。')
      }
      setActionMessage(clickPublish ? '章节已注入，并尝试点击页面上的发布按钮。' : '章节已注入到番茄发布窗口。')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  async function copySelectedChapter() {
    if (!selectedChapter) return
    setActionError('')
    setActionMessage('')
    try {
      await copyChapter(selectedChapter)
      setActionMessage('已复制当前章节，可直接粘贴到番茄后台。')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 1160 }}>
      <h2 style={{ margin: 0 }}>作品库</h2>

      {error ? (
        <div style={{ color: 'rgba(255, 120, 120, 0.92)' }}>
          错误：<InlineCode>{error}</InlineCode>
        </div>
      ) : null}

      <Card
        title="本地工程"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => void refresh()} disabled={loading} variant="primary">
              {loading ? '刷新中…' : '刷新'}
            </Button>
          </div>
        }
      >
        {items.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.65)' }}>暂无作品。先去“创作中心”生成一本小说，作品库会自动收录。</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {items.map((project) => {
              const active = project.dir === selectedProjectDir
              return (
                <div
                  key={project.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 12,
                    alignItems: 'center',
                    borderTop: '1px solid rgba(255,255,255,0.08)',
                    paddingTop: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 650 }}>{project.title || '未命名作品'}</div>
                    <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 1.6 }}>
                      {new Date(project.createdAt).toLocaleString()} · {project.chapterCount} 章 · <InlineCode>{project.dir}</InlineCode>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button
                      onClick={() => setSelectedProjectDir(project.dir)}
                      variant={active ? 'primary' : 'default'}
                      title="选中后会自动加载已生成章节"
                    >
                      {active ? '已选中' : '选择'}
                    </Button>
                    <Button onClick={() => void window.api.projects.reveal({ path: project.dir })}>打开目录</Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {selectedProject ? (
        <Card
          title="章节发布台"
          right={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Button onClick={() => void openEmbeddedPublisher()} variant="primary">
                打开内置番茄窗口
              </Button>
              <Button onClick={() => void openSystemPublisher(false)}>打开系统浏览器</Button>
              <Button onClick={() => void openSystemPublisher(true)} disabled={!selectedChapter}>
                浏览器打开并复制当前章
              </Button>
            </div>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ color: 'rgba(255,255,255,0.72)', lineHeight: 1.6 }}>
              当前作品：<InlineCode>{selectedProject.title || projectState?.title || '未命名作品'}</InlineCode>
              {' · '}
              已生成章节：<InlineCode>{projectState?.completed.length ?? chapters.length}</InlineCode>
              {projectState?.chapterCount ? (
                <>
                  {' / '}
                  计划章节：<InlineCode>{projectState.chapterCount}</InlineCode>
                </>
              ) : null}
            </div>

            <div style={{ color: 'rgba(255,255,255,0.58)', fontSize: 12, lineHeight: 1.7 }}>
              说明：选中一本书后，这里会自动带出已生成章节。内置番茄窗口支持自动注入；系统浏览器方案会先打开番茄后台，你可以直接粘贴当前章节。
            </div>

            {chaptersError ? (
              <div style={{ color: 'rgba(255, 120, 120, 0.92)' }}>
                章节错误：<InlineCode>{chaptersError}</InlineCode>
              </div>
            ) : null}

            {actionError ? (
              <div style={{ color: 'rgba(255, 120, 120, 0.92)' }}>
                发布错误：<InlineCode>{actionError}</InlineCode>
              </div>
            ) : null}

            {actionMessage ? (
              <div style={{ color: 'rgba(165, 255, 195, 0.9)' }}>
                提示：<InlineCode>{actionMessage}</InlineCode>
              </div>
            ) : null}

            {chaptersLoading ? (
              <div style={{ color: 'rgba(255,255,255,0.68)' }}>正在读取章节…</div>
            ) : chapters.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.65)' }}>这本书还没有可发布的章节，请先在“创作中心”生成章节。</div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)',
                  gap: 14,
                  alignItems: 'start',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gap: 8,
                    maxHeight: 640,
                    overflow: 'auto',
                    paddingRight: 4,
                  }}
                >
                  {chapters.map((chapter) => {
                    const active = chapter.index === selectedChapter?.index
                    return (
                      <button
                        key={chapter.index}
                        type="button"
                        onClick={() => setSelectedChapterIndex(chapter.index)}
                        style={{
                          textAlign: 'left',
                          border: active ? '1px solid rgba(102, 108, 255, 0.62)' : '1px solid rgba(255,255,255,0.08)',
                          background: active ? 'rgba(102, 108, 255, 0.16)' : 'rgba(255,255,255,0.02)',
                          color: 'rgba(255,255,255,0.92)',
                          borderRadius: 12,
                          padding: '12px 12px 10px',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontWeight: 650 }}>{buildChapterTitle(chapter)}</div>
                        <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                          {chapter.summary || '已生成正文，点击右侧可预览并发布。'}
                        </div>
                      </button>
                    )
                  })}
                </div>

                {selectedChapter ? (
                  <div
                    style={{
                      display: 'grid',
                      gap: 12,
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 16,
                      padding: 14,
                      background: 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{buildChapterTitle(selectedChapter)}</div>
                      {selectedChapter.summary ? (
                        <div style={{ color: 'rgba(255,255,255,0.68)', lineHeight: 1.6 }}>{selectedChapter.summary}</div>
                      ) : null}
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Button onClick={() => void copySelectedChapter()}>复制当前章节</Button>
                      <Button onClick={() => void injectChapter(selectedChapter, false)} variant="primary">
                        注入到番茄
                      </Button>
                      <Button
                        onClick={() => void injectChapter(selectedChapter, true)}
                        title="会尝试点击页面中带有“发布/提交/保存”的按钮，若页面结构变化可能失效"
                      >
                        注入并尝试发布
                      </Button>
                    </div>

                    <div
                      style={{
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 12,
                        padding: 14,
                        background: 'rgba(0,0,0,0.2)',
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.82,
                        maxHeight: 560,
                        overflow: 'auto',
                      }}
                    >
                      {selectedChapter.content}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  )
}
