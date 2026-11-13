#!/usr/bin/env node

const fs = require('node:fs')
const fsp = fs.promises
const os = require('node:os')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

const { createProjectKernel } = require('../app-main/projectKernel.cjs')
const { validateBackup } = require('../app-main/projectKernelRpc.cjs')

const DEFAULT_CHAPTERS = 200
const DEFAULT_CHARACTERS = 1_000_000
const REPEATS = 5
const MUTATIONS = ['甲乙丙', '丁戊己', '庚辛壬', '癸子丑', '寅卯辰']

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--${name} 必须是正整数`)
  return value
}

function isoDate() {
  return '2026-01-01T00:00:00.000Z'
}

function repeatedChinese(length) {
  const seed = '星河照过旧城，远山与潮声在纸上缓慢交汇。'
  return seed.repeat(Math.ceil(length / seed.length)).slice(0, length)
}

function chapterContent(length, chapterIndex) {
  const content = repeatedChinese(length)
  const marker = `章节${String(chapterIndex + 1).padStart(3, '0')}`
  return marker.length <= length ? marker + content.slice(marker.length) : content
}

function makeNovel(chapterCount, totalCharacters) {
  const baseLength = Math.floor(totalCharacters / chapterCount)
  const remainder = totalCharacters % chapterCount
  const chapters = Array.from({ length: chapterCount }, (_, index) => {
    const length = baseLength + (index < remainder ? 1 : 0)
    const chapterId = `benchmark-chapter-${String(index + 1).padStart(3, '0')}`
    return {
      id: chapterId,
      volumeIndex: 0,
      chapterIndex: index,
      title: `第${index + 1}章 临界线`,
      content: chapterContent(length, index),
      summary: '合成基准章节，不包含真实书稿内容。',
      wordCount: length,
      status: 'completed',
      createdAt: isoDate(),
      updatedAt: isoDate(),
    }
  })

  return {
    id: 'benchmark-project',
    title: '合成持久化基准项目',
    genre: 'fantasy',
    subGenre: 'synthetic',
    genreLabel: '合成测试',
    subGenreLabel: '持久化基准',
    tags: ['benchmark'],
    targetWordCountMin: 100,
    targetWordCountMax: 200,
    currentWordCount: totalCharacters,
    writingStyle: {
      narrativePov: '第三人称',
      toneStyle: '克制',
      descriptionDensity: '中',
      dialogueStyle: '简洁',
      combatStyle: '无',
      pacingControl: '稳定',
      emotionExpression: '克制',
    },
    writingMode: 'manual',
    chatWebSearchEnabled: false,
    settings: {
      protagonist: {
        name: '基准主角',
        gender: '未设定',
        age: '未设定',
        background: '合成数据',
        personality: ['观察'],
        initialPower: '无',
        cheatDescription: '无',
        romanceTendency: '无',
      },
      supportingCharacters: [],
      worldBuilding: { worldType: '合成世界', worldScale: '单场景', socialStructure: '无', techLevel: '无', specialRules: '无' },
      powerSystem: { systemName: '无', levelHierarchy: '无', combatStyleDesc: '无', auxiliarySystems: '无' },
      coreConflict: { mainConflict: '无', mainVillain: '无', factionConflicts: '无', coreSuspense: '无' },
      romance: { romanceType: '无', developmentPace: '无', toneChanges: '无', emotionalConflict: '无' },
      payoff: { faceSlapFrequency: '无', levelUpPace: '无', patterns: [] },
      structure: { foreshadowingDensity: '低' },
      otherSettings: '仅用于存储基准。',
    },
    outline: '合成基准数据大纲。',
    synopsis: '合成基准数据简介。',
    volumes: [{
      id: 'benchmark-volume-001',
      volumeIndex: 0,
      title: '第一卷',
      theme: '基准',
      summary: '合成数据',
      keyTurningPoints: '无',
      characterChanges: '无',
      estimatedChapters: chapterCount,
      estimatedWordCount: totalCharacters,
    }],
    chapters,
    characters: [],
    chatHistory: [],
    inspirationHistory: [],
    knowledgeBaseIds: [],
    eventLog: [],
    storyArcs: [],
    chapterPlans: [],
    storyStateProposals: [],
    dataPanels: [],
    dataPanelChanges: [],
    status: 'writing',
    createdAt: isoDate(),
    updatedAt: isoDate(),
    chapterLengthPolicy: { minWords: 100, targetWords: Math.max(100, Math.min(20_000, Math.floor(totalCharacters / chapterCount))), maxWords: 20_000 },
  }
}

function makeBackup(chapterCount, totalCharacters) {
  const novel = makeNovel(chapterCount, totalCharacters)
  return {
    format: 'ai-novel-writer-backup',
    version: 2,
    exportedAt: isoDate(),
    novels: [novel],
    knowledgeBases: [],
    chapterRevisions: [],
    inspirationSessions: [],
    reconstructionWorkspaces: [{ novelId: novel.id, candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [] }],
  }
}

async function directoryStats(root) {
  let bytes = 0
  let files = 0
  async function visit(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile()) {
        files += 1
        bytes += (await fsp.stat(absolute)).size
      }
    }
  }
  await visit(root)
  return { bytes, files }
}

function elapsed(start) {
  return Number((performance.now() - start).toFixed(3))
}

async function removeOwnedTemporaryDirectory(root, tempDirectory) {
  if (!root || root !== tempDirectory) throw new Error('拒绝删除非本次创建的临时目录')
  const absoluteRoot = path.resolve(root)
  const absoluteTemp = path.resolve(os.tmpdir())
  const relative = path.relative(absoluteTemp, absoluteRoot)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('拒绝删除临时目录之外的路径')
  await fsp.rm(absoluteRoot, { recursive: true, force: true })
}

async function main() {
  const chapterCount = argument('chapters', DEFAULT_CHAPTERS)
  const totalCharacters = argument('characters', DEFAULT_CHARACTERS)
  if (chapterCount > totalCharacters) throw new Error('--chapters 不能大于 --characters')

  const backup = makeBackup(chapterCount, totalCharacters)
  validateBackup(backup)

  const tempDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mojian-project-kernel-benchmark-'))
  let ownedDirectory = tempDirectory
  try {
    const records = []
    let baseRevision = null
    let currentBackup = backup
    let previousStats = await directoryStats(tempDirectory)

    for (let iteration = 0; iteration <= REPEATS; iteration += 1) {
      if (iteration > 0) {
        const chapterIndex = (iteration - 1) % chapterCount
        const mutationIndex = Math.floor((iteration - 1) / chapterCount)
        const chapter = currentBackup.novels[0].chapters[chapterIndex]
        chapter.content = chapter.content.slice(0, -3) + MUTATIONS[mutationIndex]
        chapter.updatedAt = isoDate()
        currentBackup.novels[0].updatedAt = isoDate()
        validateBackup(currentBackup)
      }

      const kernel = await createProjectKernel({ root: tempDirectory, validateBackup })
      const commitStart = performance.now()
      const committed = await kernel.commit({ baseRevision, backup: currentBackup })
      const commitMs = elapsed(commitStart)
      baseRevision = committed.revision
      const stats = await directoryStats(tempDirectory)

      const restartStart = performance.now()
      const reopened = await createProjectKernel({ root: tempDirectory, validateBackup })
      const restored = await reopened.read()
      const restartReadMs = elapsed(restartStart)
      if (restored.revision !== baseRevision || restored.backup.novels[0].chapters.length !== chapterCount) {
        throw new Error('重启读取后的基准数据校验失败')
      }

      records.push({
        commit: iteration,
        commitMs,
        restartReadMs,
        directoryBytes: stats.bytes,
        directoryFiles: stats.files,
        bytesGrowth: stats.bytes - previousStats.bytes,
        filesGrowth: stats.files - previousStats.files,
        bytesGrowthFromFirstCommit: iteration === 0 ? 0 : stats.bytes - records[0].directoryBytes,
        filesGrowthFromFirstCommit: iteration === 0 ? 0 : stats.files - records[0].directoryFiles,
      })
      previousStats = stats
    }

    const actualCharacters = currentBackup.novels[0].chapters.reduce((sum, chapter) => sum + chapter.content.length, 0)
    process.stdout.write(JSON.stringify({
      benchmark: 'project-kernel-full-snapshot',
      chapters: chapterCount,
      totalCharacters: actualCharacters,
      requestedCharacters: totalCharacters,
      repeats: REPEATS,
      commits: records,
    }) + '\n')
  } finally {
    await removeOwnedTemporaryDirectory(ownedDirectory, tempDirectory)
    ownedDirectory = null
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})
