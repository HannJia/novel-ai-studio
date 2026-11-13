import { createRouter, createWebHashHistory } from 'vue-router'
import { rememberBook } from '@/v3/shell'

const router = createRouter({
  // 使用 hash 模式，兼容 Electron 文件协议
  history: createWebHashHistory(),
  routes: [
    // 所有产品页面均为 V3；退役版本没有路由或参数适配。
    {
      path: '/',
      name: 'NovelList',
      component: () => import('@/v3/views/ShelfView.vue'),
      meta: { title: '我的书架', shell: 'v3', area: 'shelf' },
    },

    {
      path: '/create',
      name: 'CreateWizard',
      component: () => import('@/v3/views/CreateView.vue'),
      meta: { title: '创建新书', shell: 'v3', area: 'create' },
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
      component: () => import('@/v3/knowledge/KnowledgeLibrary.vue'),
      meta: { title: '知识库', shell: 'v3', area: 'knowledge' },
    },
    {
      path: '/characters/:novelId',
      name: 'V3Characters',
      component: () => import('@/v3/characters/CharacterManager.vue'),
      meta: { title: '人物资料', shell: 'v3', area: 'codex', bookTool: 'characters' },
    },
    {
      path: '/data/:novelId',
      name: 'V3Data',
      component: () => import('@/v3/data/DataManager.vue'),
      meta: { title: '数据面板', shell: 'v3', area: 'codex', bookTool: 'data' },
    },
    {
      path: '/inspiration/:novelId',
      name: 'V3Inspiration',
      component: () => import('@/v3/create/InspirationArchive.vue'),
      meta: { title: '灵感记录', shell: 'v3', area: 'codex', bookTool: 'inspiration' },
    },
    {
      path: '/chapters/:novelId',
      name: 'V3Chapters',
      component: () => import('@/v3/chapters/ChapterManager.vue'),
      meta: { title: '章节管理', shell: 'v3', area: 'write', bookTool: 'chapters' },
    },
    {
      path: '/outline/:novelId',
      name: 'V3Outline',
      component: () => import('@/v3/planning/OutlineEditor.vue'),
      meta: { title: '总纲修订', shell: 'v3', area: 'plan', bookTool: 'outline' },
    },
    {
      path: '/generate/:novelId',
      name: 'V3CreateFlow',
      component: () => import('@/v3/views/CreateFlowView.vue'),
      meta: { title: '作品创建流程', shell: 'v3', area: 'create' },
    },

    { path: '/:pathMatch(.*)*', name: 'V3NotFound', component: () => import('@/v3/views/NotFoundView.vue'), meta: { title: '页面不存在', shell: 'v3' } },
  ],
})

router.afterEach(to => { if (typeof to.params.novelId === 'string') rememberBook(to.params.novelId) })

export default router
