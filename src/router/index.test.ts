// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import router from './index'

describe('native V3 routes', () => {
  it.each([
    ['', 'NovelList'], ['/create', 'CreateWizard'], ['/settings?section=cloud', 'Settings'],
    ['/write/book/chapter?evidenceVersion=v1&evidenceStart=12&evidenceEnd=30#quote', 'V3Write'],
    ['/plan/book?view=workbench&plannerTab=timeline&plannerSelection=event', 'V3Plan'],
    ['/characters/book?character=person', 'V3Characters'], ['/data/book?chapterId=chapter', 'V3Data'],
    ['/inspiration/book', 'V3Inspiration'], ['/chapters/book', 'V3Chapters'], ['/outline/book', 'V3Outline'],
    ['/knowledge/book', 'KnowledgeLibrary'], ['/generate/book?edit=direction', 'V3CreateFlow'],
  ])('opens %s as a native V3 page', async (path, name) => {
    await router.push(path || '/')
    expect(router.currentRoute.value.meta.shell).toBe('v3')
    expect(router.currentRoute.value.name).toBe(name)
    expect(router.currentRoute.value.fullPath).toBe(path || '/')
  }, 15000)

  it.each(['/legacy', '/legacy-create', '/legacy-generate/book', '/workspace/book', '/workspace/book/editor/chapter', '/workspace/book/planning?tab=timeline'])('does not adapt retired addresses: %s', path => {
    expect(router.resolve(path).name).toBe('V3NotFound')
  })

  it('contains no retired route records or nested workspace shell', () => {
    const routes = router.getRoutes()
    expect(routes.every(route => !route.path.startsWith('/workspace') && !route.path.startsWith('/legacy'))).toBe(true)
    expect(routes.every(route => route.meta.shell === 'v3')).toBe(true)
  })
})
