import { createRouter, createWebHashHistory } from 'vue-router'
import { readShellPref, rememberBook, writeShellPref } from '@/v3/shell'

const router = createRouter({
  // 使用 hash 模式，兼容 Electron 文件协议
  history: createWebHashHistory(),
  routes: [
    // 新界面（V3）。每个地址只由一套界面负责；新界面完成一个区域就在这里接管对应地址。
    {
      path: '/',
      name: 'NovelList',
      component: () => import('@/v3/views/ShelfView.vue'),
      meta: { title: '我的书架', shell: 'v3', area: 'shelf', legacyPath: '/legacy' },
    },
    {
      path: '/legacy',
      name: 'LegacyNovelList',
      component: () => import('@/views/NovelList.vue'),
      meta: { title: '我的书架（旧界面）' },
    },
    {
      path: '/create',
      name: 'CreateWizard',
      component: () => import('@/v3/views/CreateView.vue'),
      meta: { title: '创建新书', shell: 'v3', area: 'create', legacyPath: '/legacy-create' },
    },
    {
      path: '/legacy-create',
      name: 'LegacyCreateWizard',
      component: () => import('@/views/CreateWizard.vue'),
      meta: { title: '创建新书（旧界面）', v3Path: '/create' },
    },
    {
      path: '/settings',
      name: 'Settings',
      component: () => import('@/v3/views/SettingsView.vue'),
      meta: { title: '设置', shell: 'v3' },
    },
    {
      path: '/write/:novelId/:chapterId?',
      name: 'V3Write',
      component: () => import('@/v3/write/WriteView.vue'),
      meta: { title: '写作台', shell: 'v3', area: 'write' },
    },
    {
      path: '/review/:novelId',
      name: 'V3Review',
      component: () => import('@/v3/views/ReviewView.vue'),
      meta: { title: '审校中心', shell: 'v3', area: 'review' },
    },
    {
      path: '/codex/:novelId',
      name: 'V3Codex',
      component: () => import('@/v3/views/CodexView.vue'),
      meta: { title: '典籍', shell: 'v3', area: 'codex' },
    },
    {
      path: '/plan/:novelId',
      name: 'V3Plan',
      component: () => import('@/v3/views/PlanView.vue'),
      meta: { title: '结构与规划', shell: 'v3', area: 'plan' },
    },
    {
      path: '/auto/:novelId',
      name: 'V3Auto',
      component: () => import('@/v3/views/AutoView.vue'),
      meta: { title: '自动写作', shell: 'v3', area: 'auto' },
    },
    {
      path: '/knowledge/:novelId?',
      name: 'KnowledgeLibrary',
      component: () => import('@/views/workspace/KnowledgeBase.vue'),
      meta: { title: '知识库', shell: 'v3', area: 'knowledge' },
    },
    {
      path: '/workspace/:novelId',
      component: () => import('@/views/Workspace.vue'),
      meta: { title: '工作台' },
      children: [
        {
          path: '',
          redirect: (to) => `/workspace/${to.params.novelId}/chapters`,
        },
        {
          path: 'outline',
          name: 'WorkspaceOutline',
          component: () => import('@/views/workspace/OutlineView.vue'),
          meta: { title: '大纲' },
        },
        {
          path: 'volumes',
          name: 'WorkspaceVolumes',
          redirect: (to) => ({
            path: `/workspace/${to.params.novelId}/planning`,
            query: { tab: 'volumes' },
          }),
          meta: { title: '分卷规划' },
        },
        {
          path: 'chapters',
          name: 'WorkspaceChapters',
          component: () => import('@/views/workspace/ChapterList.vue'),
          meta: { title: '章节列表' },
        },
        {
          path: 'inspiration',
          name: 'WorkspaceInspiration',
          component: () => import('@/views/workspace/InspirationArchive.vue'),
          meta: { title: '灵感记录' },
        },
        {
          path: 'characters',
          name: 'WorkspaceCharacters',
          component: () => import('@/views/workspace/CharacterLibrary.vue'),
          meta: { title: '角色库' },
        },
        {
          path: 'knowledge',
          name: 'WorkspaceKnowledge',
          redirect: to => ({ name: 'KnowledgeLibrary', params: { novelId: String(to.params.novelId) }, query: to.query, hash: to.hash }),
          meta: { title: '知识库' },
        },
        {
          path: 'planning',
          name: 'WorkspacePlanning',
          component: () => import('@/views/workspace/StoryPlanner.vue'),
          meta: { title: '剧情规划' },
        },
        {
          path: 'data',
          name: 'WorkspaceDataPanel',
          component: () => import('@/views/workspace/DataPanelWorkspace.vue'),
          meta: { title: '数据面板' },
        },
        {
          path: 'editor/:chapterId',
          name: 'WorkspaceEditor',
          redirect: to => ({ path: `/write/${String(to.params.novelId)}/${String(to.params.chapterId)}`, query: to.query, hash: to.hash }),
          meta: { title: '写作' },
        },
      ],
    },
    {
      path: '/generate/:novelId',
      name: 'V3CreateFlow',
      component: () => import('@/v3/views/CreateFlowView.vue'),
      meta: { title: '作品创建流程', shell: 'v3', area: 'create', legacyPath: '/legacy-generate/:novelId' },
    },
    {
      path: '/legacy-generate/:novelId',
      name: 'LegacyGenerateOutline',
      component: () => import('@/views/GenerateOutline.vue'),
      meta: { title: '生成大纲（旧界面）', v3Path: '/generate/:novelId' },
    },
  ],
})

// ?ui=legacy / ?ui=v3 切换界面偏好；偏好为旧界面时，已被新界面接管的地址改走旧界面的对应页面。
router.beforeEach(to => {
  const ui = to.query.ui
  if (ui === 'legacy' || ui === 'v3') {
    writeShellPref(ui)
    const query = { ...to.query }
    delete query.ui
    const routeTarget = ui === 'legacy' ? to.meta.legacyPath : to.meta.v3Path
    const path = typeof routeTarget === 'string'
      ? routeTarget.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_match, key: string) => encodeURIComponent(String(to.params[key] || '')))
      : to.path
    return { path, query, hash: to.hash, replace: true }
  }
  const routeTarget = readShellPref() === 'legacy' ? to.meta.legacyPath : to.meta.v3Path
  if (typeof routeTarget === 'string') {
    const path = routeTarget.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_match, key: string) => encodeURIComponent(String(to.params[key] || '')))
    return { path, query: to.query, hash: to.hash, replace: true }
  }
})
router.afterEach(to => { if (typeof to.params.novelId === 'string') rememberBook(to.params.novelId) })

export default router
