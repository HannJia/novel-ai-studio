import { nextTick } from 'vue'
import router from '@/router'
import { seedV3DenseVisualState } from './v3DenseVisualWorkflow'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useConfigStore } from '@/stores/config'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { useThemeStore, type ThemeName } from '@/stores/theme'
import { createAiRun } from '@/services/reconstructionAiRun'
import { captureProjectSnapshot } from '@/services/projectSnapshot'

let externalRequests = 0
const runtimeErrors: string[] = []
export const finalUiPages = ['shelf', 'write', 'plan', 'codex', 'review', 'auto', 'settings', 'create', 'chapters', 'characters', 'data', 'inspiration', 'outline', 'knowledge', 'contract']

export async function seedFinalUiState() {
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
    if (url.origin !== location.origin) { externalRequests++; return Promise.reject(new Error('视觉验收禁止外部请求')) }
    return nativeFetch(input, init)
  }
  window.addEventListener('error', event => runtimeErrors.push(event.message))
  window.addEventListener('unhandledrejection', event => runtimeErrors.push(String(event.reason)))
  const fixture = await seedV3DenseVisualState()
  const novels = useNovelStore(), knowledge = useKnowledgeStore(), config = useConfigStore(), workspace = useReconstructionWorkspaceStore()
  const book = novels.getNovel(fixture.novelId)!
  const now = new Date().toISOString()
  for (const name of ['长街灯火', '渡口来信', '雨城旧事', '灯下账册', '一次很长的书名展示：从渡口到旧城的漫长调查']) {
    const extra = novels.addNovel({ workingTitle: name, genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 10, targetWordCountMax: 30,
      writingStyle: novels.defaultWritingStyle(), settings: novels.defaultSettings() })
    extra.updatedAt = '2026-11-01T00:00:00.000Z'
    await novels.saveNovelNow(extra.id)
  }
  book.updatedAt = now
  await novels.saveNovelNow(book.id)
  const library = knowledge.createKB('渡口史料·合成参考', '只用于检查资料展示与挂载。')
  knowledge.addEntry(library.id, { title: '渡口日常', category: '世界观', content: '渡口由账房和守灯人共同值守，交接时核对账册与灯油。', summary: '', tags: ['合成史料'] })
  await knowledge.flushPendingSaves()
  const run = createAiRun({ id: 'visual-autonomous', mode: 'autonomous', taskType: 'draft', targetId: book.id, chapterStart: 41, chapterEnd: 44, tokenBudget: 60000, requestLimit: 20, checkpointEvery: 1, now })
  run.status = 'needs_author'; run.checkpoint = 'chapter-41:checkpoint'
  workspace.replaceAiRun(book.id, run)
  await workspace.persistToDatabase(book.id)
  config.models.splice(0, config.models.length, ...['写作与规划', '审校与对话'].map((name, i) => ({ id: 'visual-model-' + i, name: '合成验收·' + name,
    baseUrl: 'https://example.invalid', apiKey: 'synthetic-visual-only', modelName: i ? 'synthetic-review-model' : 'synthetic-writing-model', maxTokens: 8192, temperature: 0.7, topP: 1 })))
  Object.assign(config.assignments, { outline: 'visual-model-0', writing: 'visual-model-0', review: 'visual-model-1', chat: 'visual-model-1', embedding: '' })
  config.isConfigured = true; config.embedding.enabled = false
  document.querySelector<HTMLButtonElement>('.m-modal.guide [aria-label="关闭"]')?.click()
  await captureProjectSnapshot()
  return { ...fixture, chapterId: book.chapters[41].id, pages: finalUiPages }
}

export async function openFinalUiPage(fixture: { novelId: string; chapterId: string }, page: string, theme: ThemeName) {
  useThemeStore().switchTheme(theme)
  const paths: Record<string, string> = { shelf: '/', write: `/write/${fixture.novelId}/${fixture.chapterId}`, settings: '/settings', create: '/create', contract: `/generate/${fixture.novelId}?edit=direction` }
  const selectors: Record<string, string> = { shelf: '[data-keep="shelf"]', write: '.write-page', plan: '.plan-page', codex: '.codex-page', review: '.review-page', auto: '.auto-view',
    settings: '#settings-page', create: '#create-wizard-page', chapters: '#chapter-list-view', characters: '#characters-page', data: '.data-workspace',
    inspiration: '#inspiration-archive', outline: '#outline-view', knowledge: '#knowledge-base', contract: '.story-contract' }
  const started = performance.now()
  await router.push(paths[page] || `/${page}/${fixture.novelId}`)
  await nextTick()
  for (let attempt = 0; attempt < 300 && !document.querySelector(selectors[page]); attempt++) await new Promise(resolve => setTimeout(resolve, 30))
  const target = document.querySelector<HTMLElement>(selectors[page])
  if (!target) throw new Error('页面未就绪：' + page)
  document.querySelectorAll('.page, .page-in, .settings-content').forEach(element => { element.scrollTop = 0 })
  await document.fonts.ready
  await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished))
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  // capturePage can read the previous compositor frame immediately after a fast route mount.
  await new Promise(resolve => setTimeout(resolve, 200))
  const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect()
  const tokens = getComputedStyle(document.documentElement)
  return { page, theme, width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
    railWidth: box('.rail')?.width, headerHeight: box('.top')?.height, footerHeight: box('.status')?.height,
    rootWidth: target.getBoundingClientRect().width, desk: tokens.getPropertyValue('--desk').trim(), paper: tokens.getPropertyValue('--paper').trim(),
    heading: target.querySelector('h1,h2,h3')?.textContent?.trim() || '', readyMs: Math.round(performance.now() - started), runtimeErrors: [...runtimeErrors], externalRequests }
}
