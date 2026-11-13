import type { Character, Novel } from '@/types/novel'
import type { CanonMutationRecord, EvidenceRef } from '@/types/reconstruction'
import { projectCanonicalEntities } from './entityProvenance'
import { sourceNovel } from './effectiveStory'
import { getCharacterStateSnapshot } from './reconstructionCharacterState'
import { relationshipDimension, relationshipDimensionLabel, relationshipIdentity } from './characterMemoryIdentity'
import type { MemoryRelationshipState } from '@/types/characterMemory'

export interface RelationshipProjectionEdge {
  source: Character
  target: Character
  relation: string
  dimension: string
  dimensionLabel: string
  description: string
  origin: 'author' | 'chapter'
  chapterId?: string
  evidence: EvidenceRef[]
}

export interface RelationshipProjectionInvalid {
  record: CanonMutationRecord
  issue: string
}

export interface RelationshipProjection {
  edges: RelationshipProjectionEdge[]
  invalid: RelationshipProjectionInvalid[]
}

type BaseRelationship = Character['relationships'][number] & { description?: unknown }

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
const normalized = (value: string): string => value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()

function cloneEvidence(evidence: EvidenceRef[] | undefined): EvidenceRef[] {
  return Array.isArray(evidence) ? evidence.map(item => ({ ...item })) : []
}

function directionKey(sourceId: string, targetId: string, dimension?: string): string {
  return relationshipIdentity(sourceId, targetId, dimension)
}

function characterNames(character: Character): string[] {
  return [character.name, ...(character.aliases || [])]
    .map(name => clean(name))
    .filter(Boolean)
}

function resolveBaseTarget(relation: BaseRelationship, characters: Character[]): Character | undefined {
  const targetId = clean(relation.targetId)
  if (targetId) return characters.find(character => character.id === targetId)

  const targetName = normalized(clean(relation.targetName))
  if (!targetName) return undefined
  const matches = characters.filter(character => characterNames(character)
    .some(name => normalized(name) === targetName))
  return matches.length === 1 ? matches[0] : undefined
}

function visibleCharacters(characters: Character[], chapterIndex: number | undefined, boundary: 'before' | 'through'): Character[] {
  if (chapterIndex === undefined) return characters
  return characters.filter(character => boundary === 'before'
    ? character.firstAppearChapter < chapterIndex
    : character.firstAppearChapter <= chapterIndex)
}

function maxChapterIndex(novel: Novel): number {
  return novel.chapters.reduce((maximum, chapter) => Math.max(maximum, chapter.chapterIndex), -1)
}

function stateBoundaryIndex(novel: Novel, chapterIndex: number | undefined): number {
  return chapterIndex ?? maxChapterIndex(novel)
}

function entityProjectionBoundary(chapterIndex: number | undefined, boundary: 'before' | 'through'): number | undefined {
  if (chapterIndex === undefined) return undefined
  return boundary === 'before' ? chapterIndex : chapterIndex + 1
}

export function getRelationshipProjection(
  novel: Novel,
  records: CanonMutationRecord[],
  chapterIndex?: number,
  boundary: 'before' | 'through' = 'through',
): RelationshipProjection {
  const source = sourceNovel(novel)
  const projected = projectCanonicalEntities(source, entityProjectionBoundary(chapterIndex, boundary))
  const characters = visibleCharacters(projected.characters, chapterIndex, boundary)
  const charactersById = new Map(characters.map(character => [character.id, character]))

  const authorEdges: RelationshipProjectionEdge[] = []
  for (const sourceCharacter of characters) {
    for (const relation of sourceCharacter.relationships || []) {
      const target = resolveBaseTarget(relation as BaseRelationship, characters)
      if (!target || target.id === sourceCharacter.id) continue
      const relationText = typeof relation.relation === 'string' ? relation.relation : ''
      const dimension = relationshipDimension((relation as BaseRelationship & { dimension?: string }).dimension)
      const description = typeof (relation as BaseRelationship).description === 'string'
        ? (relation as BaseRelationship).description as string
        : ''
      authorEdges.push({
        source: sourceCharacter,
        target,
        relation: relationText,
        dimension, dimensionLabel: relationshipDimensionLabel(dimension),
        description,
        origin: 'author',
        evidence: [],
      })
    }
  }

  const snapshot = getCharacterStateSnapshot(source, records, stateBoundaryIndex(source, chapterIndex), boundary)
  const invalid = snapshot.invalid
    .filter(item => item.record.characterState?.kind === 'relationship')
    .map(item => ({ record: item.record, issue: item.issue }))

  const overriddenDirections = new Set<string>()
  const chapterEdges: RelationshipProjectionEdge[] = []
  for (const change of snapshot.relationships) {
    if (change.characterId === change.targetCharacterId) continue
    const key = directionKey(change.characterId, change.targetCharacterId, change.dimension)
    overriddenDirections.add(key)
    const sourceCharacter = charactersById.get(change.characterId)
    const target = charactersById.get(change.targetCharacterId)
    if (!sourceCharacter || !target) continue
    chapterEdges.push({
      source: sourceCharacter,
      target,
      relation: typeof change.relation === 'string' ? change.relation : '',
      dimension: relationshipDimension(change.dimension), dimensionLabel: relationshipDimensionLabel(change.dimension),
      description: typeof change.description === 'string' ? change.description : '',
      origin: 'chapter',
      chapterId: records.find(record => record.characterState?.kind === 'relationship'
        && record.characterState.after.id === change.id)?.chapterId,
      evidence: cloneEvidence(change.evidence),
    })
  }

  const invalidDirections = new Set<string>()
  for (const item of invalid) {
    const change = item.record.characterState
    if (change?.kind === 'relationship' && change.after.characterId !== change.after.targetCharacterId) {
      invalidDirections.add(directionKey(change.after.characterId, change.after.targetCharacterId, (change.after as MemoryRelationshipState).dimension))
    }
  }

  return {
    edges: [
      ...authorEdges.filter(edge => {
        const key = directionKey(edge.source.id, edge.target.id, edge.dimension)
        return !overriddenDirections.has(key) && !invalidDirections.has(key)
      }),
      ...chapterEdges,
    ].sort((a,b) => directionKey(a.source.id,a.target.id,a.dimension).localeCompare(directionKey(b.source.id,b.target.id,b.dimension)) || a.relation.localeCompare(b.relation)),
    invalid,
  }
}
