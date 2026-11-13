import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import type { ProjectBackup } from '@/services/projectBackup'
import type { ProjectKernelResponse } from '@/types/projectKernel'
import { buildV3DenseVisualFixture } from './v3DenseVisualFixture'

export async function seedV3DenseVisualState() {
  const novels = useNovelStore()
  const workspace = useReconstructionWorkspaceStore()
  const created = novels.addNovel({
    workingTitle: '深层页面合成验收',
    genre: 'urban',
    subGenre: 'mystery',
    tags: ['隔离视觉夹具'],
    targetWordCountMin: 10,
    targetWordCountMax: 100,
    writingStyle: novels.defaultWritingStyle(),
    settings: novels.defaultSettings(),
  })
  const fixture = buildV3DenseVisualFixture(created.id)
  Object.assign(created, fixture.novel)
  await novels.saveNovelNow(created.id)
  await workspace.hydrateFromPersistence(created.id)
  for (const record of fixture.records) workspace.recordCanonMutation(created.id, record)
  workspace.replaceCandidates(created.id, fixture.candidates)
  await workspace.persistToDatabase(created.id)
  await novels.flushPendingSaves()
  const persisted = await window.electronAPI?.projectRequest?.({ method: 'read' }) as
    ProjectKernelResponse<{ backup: ProjectBackup | null }> | undefined
  if (!persisted?.ok) throw new Error(persisted?.error?.message || '视觉合成夹具无法重读项目存储。')
  const savedNovel = persisted.value.backup?.novels.find(novel => novel.id === created.id)
  const savedWorkspace = persisted.value.backup?.reconstructionWorkspaces.find(item => item.novelId === created.id)
  if (savedNovel?.chapters.length !== 64 || savedWorkspace?.canonMutations?.length !== fixture.records.length
    || savedWorkspace?.candidates?.length !== fixture.candidates.length) {
    throw new Error('视觉合成夹具重读后的作品或工作区数据不完整。')
  }
  return {
    novelId: created.id,
    chapters: created.chapters.length,
    volumes: created.volumes.length,
    arcs: created.storyArcs?.length || 0,
    foreshadowings: created.eventLog.filter(event => event.type === '伏笔').length,
    staleChapterIds: fixture.staleChapterIds,
    persisted: true,
    modelRequests: 0,
  }
}
