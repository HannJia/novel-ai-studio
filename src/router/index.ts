import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  // 使用 hash 模式，兼容 Electron 文件协议
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'NovelList',
      component: () => import('@/views/NovelList.vue'),
      meta: { title: '我的书架' },
    },
    {
      path: '/create',
      name: 'CreateWizard',
      component: () => import('@/views/CreateWizard.vue'),
      meta: { title: '创建新书' },
    },
    {
      path: '/settings',
      name: 'Settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { title: '设置' },
    },
    {
      path: '/knowledge',
      name: 'KnowledgeLibrary',
      component: () => import('@/views/workspace/KnowledgeBase.vue'),
      meta: { title: '知识库' },
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
          component: () => import('@/views/workspace/KnowledgeBase.vue'),
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
          component: () => import('@/views/workspace/ChapterEditor.vue'),
          meta: { title: '写作' },
        },
      ],
    },
    {
      path: '/generate/:novelId',
      name: 'GenerateOutline',
      component: () => import('@/views/GenerateOutline.vue'),
      meta: { title: '生成大纲' },
    },
  ],
})

export default router
