/**
 * 知识库文件类型
 */
export type KnowledgeFileType = 'txt' | 'pdf' | 'docx' | 'epub' | 'md'

/**
 * 知识库分类
 */
export interface KnowledgeCategory {
  id: string
  bookId: string | null       // null表示全局分类
  name: string
  parentId: string | null
  order: number
  createdAt: string
}

/**
 * 知识库文件
 */
export interface KnowledgeFile {
  id: string
  bookId: string | null       // null表示全局知识库
  categoryId: string | null
  filename: string
  originalName: string
  fileType: KnowledgeFileType
  fileSize: number
  filePath: string
  isIndexed: boolean          // 是否已向量化
  chunkCount: number          // 分块数量
  tags: string[]
  createdAt: string
  updatedAt: string
}

/**
 * 知识检索结果
 */
export interface KnowledgeSearchResult {
  fileId: string
  filename: string
  content: string             // 匹配的内容片段
  score: number               // 相关度分数
  metadata: Record<string, unknown>
}
