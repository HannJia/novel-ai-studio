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
// ==========================================
// 侧边栏样式 - Gemini 3 Pro 设计方案
// ==========================================

.app-sidebar {
  width: $sidebar-width;
  height: 100%;
  background-color: var(--sidebar-bg, $dark-bg-surface);
  border-right: 1px solid var(--border-base, $dark-border-base);
  display: flex;
  flex-direction: column;
  transition: width $transition-duration $transition-timing;
  z-index: $z-sidebar;
  flex-shrink: 0;

  &.collapsed {
    width: $sidebar-collapsed-width;

    .logo-text,
    .nav-text {
      display: none;
    }

    .nav-item {
      justify-content: center;
      padding: $spacing-md;
    }
  }
}

// ==========================================
// Logo 区域
// ==========================================
.sidebar-logo {
  height: $header-height;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid var(--border-base, $dark-border-base);
  flex-shrink: 0;

  .logo-text {
    font-size: $font-size-large;
    font-weight: 700;
    background: linear-gradient(135deg, $primary-color, $primary-light);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .logo-icon {
    font-size: $font-size-extra-large;
    font-weight: 700;
    background: linear-gradient(135deg, $primary-color, $primary-light);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
}

// ==========================================
// 导航区域
// ==========================================
.sidebar-nav {
  flex: 1;
  padding: $spacing-md $spacing-sm;
  overflow-y: auto;
  overflow-x: hidden;
}

.sidebar-footer {
  padding: $spacing-md $spacing-sm;
  border-top: 1px solid var(--border-base, $dark-border-base);
  flex-shrink: 0;
}

// ==========================================
// 导航项
// ==========================================
.nav-item {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-md $spacing-base;
  margin-bottom: $spacing-xs;
  border-radius: $border-radius-md;
  color: var(--text-secondary, $dark-text-secondary);
  cursor: pointer;
  transition: all $transition-duration-fast $transition-timing;
  position: relative;

  &:hover {
    background-color: var(--sidebar-item-hover, $dark-bg-hover);
    color: var(--text-primary, $dark-text-primary);
  }

  &.active {
    background-color: var(--sidebar-item-active, rgba($primary-color, 0.15));
    color: $primary-color;

    // 左侧指示条
    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 60%;
      background-color: $primary-color;
      border-radius: 0 2px 2px 0;
    }

    .nav-icon {
      color: $primary-color;
    }
  }
}

.nav-icon {
  font-size: 20px;
  flex-shrink: 0;
  transition: color $transition-duration-fast $transition-timing;
}

.nav-text {
  font-size: $font-size-base;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
