<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUiStore, useBookStore } from '@/stores'

const route = useRoute()
const router = useRouter()
const uiStore = useUiStore()
const bookStore = useBookStore()

const collapsed = computed(() => uiStore.sidebarCollapsed)
const currentBook = computed(() => bookStore.currentBook)

interface MenuItem {
  name: string
  path: string
  icon: string
  requiresBook: boolean
}

const menuItems: MenuItem[] = [
  { name: '书籍列表', path: '/', icon: 'House', requiresBook: false },
  { name: '写作编辑', path: '/editor', icon: 'Edit', requiresBook: true },
  { name: '角色管理', path: '/character', icon: 'User', requiresBook: true },
  { name: '设定百科', path: '/settings', icon: 'Collection', requiresBook: true },
  { name: '知识库', path: '/knowledge', icon: 'Files', requiresBook: true },
  { name: '审查报告', path: '/review', icon: 'DocumentChecked', requiresBook: true },
  { name: '导出', path: '/export', icon: 'Download', requiresBook: true }
]

const visibleMenuItems = computed(() => {
  if (!currentBook.value) {
    return menuItems.filter(item => !item.requiresBook)
  }
  return menuItems
})

function getFullPath(item: MenuItem): string {
  if (item.requiresBook && currentBook.value) {
    return `${item.path}/${currentBook.value.id}`
  }
  return item.path
}

function isActive(item: MenuItem): boolean {
  if (item.path === '/') {
    return route.path === '/'
  }
  return route.path.startsWith(item.path)
}

function navigateTo(item: MenuItem): void {
  router.push(getFullPath(item))
}

function goToConfig(): void {
  router.push('/config')
}
</script>

<template>
  <aside class="app-sidebar" :class="{ collapsed }">
    <div class="sidebar-logo">
      <span v-if="!collapsed" class="logo-text">NovelAI</span>
      <span v-else class="logo-icon">N</span>
    </div>

    <nav class="sidebar-nav">
      <div
        v-for="item in visibleMenuItems"
        :key="item.path"
        class="nav-item"
        :class="{ active: isActive(item) }"
        @click="navigateTo(item)"
      >
        <el-icon class="nav-icon">
          <component :is="item.icon" />
        </el-icon>
        <span v-if="!collapsed" class="nav-text">{{ item.name }}</span>
      </div>
    </nav>

    <div class="sidebar-footer">
      <div class="nav-item" @click="goToConfig">
        <el-icon class="nav-icon"><Setting /></el-icon>
        <span v-if="!collapsed" class="nav-text">设置</span>
      </div>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.app-sidebar {
  width: $sidebar-width;
  height: 100%;
  background-color: $bg-sidebar;
  display: flex;
  flex-direction: column;
  transition: width $transition-duration $transition-ease;
  z-index: $z-sidebar;

  &.collapsed {
    width: $sidebar-collapsed-width;

    .logo-text,
    .nav-text {
      display: none;
    }
  }
}

.sidebar-logo {
  height: $header-height;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);

  .logo-text {
    font-size: 18px;
    font-weight: 700;
    color: #fff;
  }

  .logo-icon {
    font-size: 20px;
    font-weight: 700;
    color: #fff;
  }
}

.sidebar-nav {
  flex: 1;
  padding: 12px 8px;
  overflow-y: auto;
}

.sidebar-footer {
  padding: 12px 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  margin-bottom: 4px;
  border-radius: $border-radius-base;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all $transition-duration $transition-ease;

  &:hover {
    background-color: $bg-sidebar-light;
    color: #fff;
  }

  &.active {
    background-color: $primary-color;
    color: #fff;
  }
}

.nav-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.nav-text {
  font-size: 14px;
  white-space: nowrap;
}
</style>
