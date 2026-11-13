export interface ChapterSourceBinding {
  chapterId: string
  sourceVersionId: string
  derivedValue: string
  createdAt: string
  origin: 'ai' | 'author'
}

