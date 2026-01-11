import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/HomeView.vue'),
    meta: { title: '书籍列表' }
  },
  {
    path: '/editor/:bookId',
    name: 'Editor',
    component: () => import('@/views/EditorView.vue'),
    meta: { title: '写作编辑' }
  },
  {
    path: '/character/:bookId',
    name: 'Character',
    component: () => import('@/views/CharacterView.vue'),
    meta: { title: '角色管理' }
  },
  {
    path: '/settings/:bookId',
    name: 'Settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { title: '设定百科' }
  },
  {
    path: '/knowledge/:bookId',
    name: 'Knowledge',
    component: () => import('@/views/KnowledgeView.vue'),
    meta: { title: '知识库' }
  },
  {
    path: '/review/:bookId',
    name: 'Review',
    component: () => import('@/views/ReviewView.vue'),
    meta: { title: '审查报告' }
  },
  {
    path: '/export/:bookId',
    name: 'Export',
    component: () => import('@/views/ExportView.vue'),
    meta: { title: '导出' }
  },
  {
    path: '/config',
    name: 'Config',
    component: () => import('@/views/ConfigView.vue'),
    meta: { title: '软件设置' }
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 路由守卫 - 设置页面标题
router.beforeEach((to, _from, next) => {
  document.title = `${to.meta.title || 'NovelAI Studio'} - NovelAI Studio`
  next()
})

export default router
