import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    /** 产品页面统一由 V3 外壳渲染。 */
    shell?: 'v3'
    /** 新界面中所属的图标栏区域，用于高亮。 */
    area?: 'shelf' | 'create' | 'write' | 'plan' | 'codex' | 'review' | 'auto' | 'knowledge'
    /** 复用编辑工具，使用统一 V3 导航与主题。 */
    bookTool?: 'characters' | 'data' | 'inspiration' | 'chapters' | 'outline'
  }
}
