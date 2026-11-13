// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import router from './index'

describe('creation route shell switching', () => {
  beforeEach(async () => {
    localStorage.removeItem('mojian-ui-shell')
    await router.replace('/')
  })

  afterEach(() => localStorage.removeItem('mojian-ui-shell'))

  it('keeps the V3 creation flow reversible and routes legacy creation pages back to V3', async () => {
    localStorage.setItem('mojian-ui-shell', 'legacy')
    await router.push('/generate/book-1')
    expect(router.currentRoute.value.path).toBe('/legacy-generate/book-1')

    await router.push('/legacy-generate/book-1?ui=v3')
    expect(router.currentRoute.value.path).toBe('/generate/book-1')
    expect(localStorage.getItem('mojian-ui-shell')).toBe('v3')

    await router.push('/create?ui=legacy')
    expect(router.currentRoute.value.path).toBe('/legacy-create')

    await router.push('/legacy-create?ui=v3')
    expect(router.currentRoute.value.path).toBe('/create')
  }, 15000)

  it('opens global and novel knowledge management inside the V3 shell', async () => {
    await router.push('/knowledge')
    expect(router.currentRoute.value.meta).toMatchObject({ shell: 'v3', area: 'knowledge' })

    await router.push('/workspace/book-1/knowledge')
    expect(router.currentRoute.value.path).toBe('/knowledge/book-1')
    expect(router.currentRoute.value.meta).toMatchObject({ shell: 'v3', area: 'knowledge' })
    expect(router.currentRoute.value.params.novelId).toBe('book-1')
  })

  it('opens cloud sync directly from the settings route', async () => {
    await router.push({ path: '/settings', query: { section: 'cloud' } })

    expect(router.currentRoute.value.name).toBe('Settings')
    expect(router.currentRoute.value.query.section).toBe('cloud')
  })
})
