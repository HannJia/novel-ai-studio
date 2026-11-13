import type { StoryImpactReport, StoryImpactRef } from '@/types/storyImpact'

const kinds = new Set(['novel', 'volume', 'character', 'event', 'arc', 'node', 'plan', 'scene', 'chapter', 'memory'])
const key = (ref: StoryImpactRef) => JSON.stringify([ref.kind, ref.id])

/** Shared by SQL, renderer backups and the generated main-process validator. */
export function assertStoryImpactReport(value: unknown, novelId: string): asserts value is StoryImpactReport {
  const fail = (): never => { throw new Error('设定影响报告损坏或不属于当前作品，已停止保存或读取。') }
  const object = (value: unknown): Record<string, any> => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail()
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (['__proto__', 'prototype', 'constructor'].includes(name) || !('value' in descriptor)) fail()
    }
    return value as Record<string, any>
  }
  const text = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 5_000_000) fail()
    return value as string
  }
  const array = (value: unknown): any[] => { if (!Array.isArray(value) || value.length > 100_000) fail(); return value as any[] }
  const reference = (value: unknown): StoryImpactRef => {
    const ref = object(value)
    if (!kinds.has(ref.kind)) fail()
    text(ref.id); text(ref.label)
    if (ref.parentId !== undefined) text(ref.parentId)
    return ref as unknown as StoryImpactRef
  }
  const report = object(value)
  text(report.id); text(report.novelId); text(report.beforeVersion); text(report.afterVersion)
  if (report.novelId !== novelId || report.version !== 1 || !['all-written', 'changed-inputs'].includes(report.reviewPolicy as string)) fail()
  const date = text(report.createdAt)
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:[.][0-9]+)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/.test(date)
    || !Number.isFinite(Date.parse(date)) || new Date(date.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== date.slice(0, 10)) fail()
  const roots = new Set<string>()
  if (!array(report.changes).length) fail()
  for (const value of report.changes) {
    const change = object(value)
    roots.add(key(reference(change.target)))
    if (!['create', 'update', 'delete', 'confirm'].includes(change.action)) fail()
    if (!array(change.fields).length) fail()
    change.fields.forEach(text)
  }
  const affected = array(report.affected), targets = new Set(roots)
  for (const value of affected) {
    const item = object(value), id = key(reference(item.target))
    if (targets.has(id) || !Number.isSafeInteger(item.depth) || item.depth < 1) fail()
    targets.add(id)
  }
  for (const item of affected) {
    if (!array(item.reasons).length) fail()
    for (const value of item.reasons) {
      const reason = object(value)
      if (!targets.has(key(reference(reason.from))) || !['before', 'after'].includes(reason.phase)) fail()
      if (reason.kind !== undefined && !['dependency', 'association'].includes(reason.kind)) fail()
      text(reason.relation)
    }
  }
  // Prove each item is reachable in one actual snapshot. Do not invent a path by
  // joining an old edge to a new edge that never existed at the same time.
  const distances = new Map<string, number>()
  for (const phase of ['before', 'after']) {
    const edges = new Map<string, Array<{ to: string; kind: 'dependency' | 'association' }>>()
    for (const item of affected) for (const reason of item.reasons) if (reason.phase === phase) {
      const from = key(reason.from), list = edges.get(from) || []
      list.push({ to: key(item.target), kind: reason.kind ?? 'dependency' }); edges.set(from, list)
    }
    const depth = new Map([...roots].map(id => [id, 0]))
    const expandable = new Map([...roots].map(id => [id, 0])), queue = [...roots]
    for (let index = 0; index < queue.length; index++) for (const edge of edges.get(queue[index]) || []) {
      const candidate = expandable.get(queue[index])! + 1
      depth.set(edge.to, Math.min(depth.get(edge.to) ?? Infinity, candidate))
      if (edge.kind === 'association') {
        continue
      }
      if (candidate < (expandable.get(edge.to) ?? Infinity)) {
        expandable.set(edge.to, candidate); queue.push(edge.to)
      }
    }
    for (const [id, n] of depth) distances.set(id, Math.min(distances.get(id) ?? Infinity, n))
  }
  for (const item of affected) if (distances.get(key(item.target)) !== item.depth) fail()
  const mentions = new Set<string>()
  for (const value of array(report.mentions)) {
    const item = object(value), ref = reference(item.chapter)
    if (ref.kind !== 'chapter' || mentions.has(ref.id) || !array(item.terms).length) fail()
    mentions.add(ref.id); item.terms.forEach(text)
  }
  const chapters = array(report.reviewChapterIds)
  chapters.forEach(text)
  if (new Set(chapters).size !== chapters.length) fail()
}
