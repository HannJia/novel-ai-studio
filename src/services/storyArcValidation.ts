import type { Novel } from '@/types/novel'
const fail = (message: string): never => { throw new Error(message) }
const refs = (value: string[] | undefined, available: Set<string>, label: string, self?: string) => {
  if (!value) return
  if (!Array.isArray(value) || new Set(value).size !== value.length || value.some(id => typeof id !== 'string' || !available.has(id) || id === self)) {
    fail(label + '包含重复、自身或不存在的引用，请重新选择。')
  }
}
function acyclic(rows: Array<{ id: string; edges: string[] }>, label: string) {
  const remaining = new Map(rows.map(row => [row.id, row.edges.length])), dependents = new Map<string, string[]>()
  for (const row of rows) for (const parent of row.edges) {
    const list = dependents.get(parent) || []; list.push(row.id); dependents.set(parent, list)
  }
  const ready = rows.filter(row => !row.edges.length).map(row => row.id)
  for (let index = 0; index < ready.length; index++) for (const child of dependents.get(ready[index]) || []) {
    const count = remaining.get(child)! - 1; remaining.set(child, count)
    if (!count) ready.push(child)
  }
  if (ready.length !== rows.length) fail(label + '存在循环依赖，请调整前置条件。')
}

/** One authoritative graph, shared by author transactions and import validation. */
export function validateStoryArcGraph(novel: Novel): void {
  const arcs = novel.storyArcs || [], nodes = arcs.flatMap(arc => arc.nodes)
  const arcIds = new Set(arcs.map(arc => arc.id)), nodeIds = new Set(nodes.map(node => node.id))
  if (arcIds.size !== arcs.length || nodeIds.size !== nodes.length) fail('剧情线或节点编号重复。')
  const characterIds = new Set(novel.characters.map(item => item.id)), eventIds = new Set(novel.eventLog.map(item => item.id))
  for (const arc of arcs) {
    if (!arc.title.trim()) fail('剧情线名称不能为空。')
    if (!Number.isInteger(arc.importance) || arc.importance < 1 || arc.importance > 5) fail('剧情线重要度必须为 1–5。')
    refs(arc.characterIds, characterIds, '相关角色')
    refs(arc.dependencyArcIds, arcIds, '前置剧情线', arc.id)
    refs(arc.turningPointEventIds, eventIds, '人物转折事件')
    for (const node of arc.nodes) {
      if (!node.title.trim()) fail('里程碑名称不能为空。')
      if (!Number.isSafeInteger(node.targetChapter) || node.targetChapter < 0) fail('预计章节必须为正整数。')
      if (node.actualChapter !== undefined && (!Number.isSafeInteger(node.actualChapter) || node.actualChapter < 0)) fail('实际发生章节序号无效。')
      refs(node.prerequisiteNodeIds, nodeIds, '前置里程碑', node.id)
      refs(node.consequenceEventIds, eventIds, '后续事件')
    }
  }
  acyclic(arcs.map(arc => ({ id: arc.id, edges: arc.dependencyArcIds || [] })), '剧情线')
  acyclic(nodes.map(node => ({ id: node.id, edges: node.prerequisiteNodeIds || [] })), '里程碑')
}

