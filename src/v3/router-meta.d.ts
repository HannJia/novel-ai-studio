import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    /** 'v3' 表示该地址由新界面外壳渲染；缺省为旧界面。 */
    shell?: 'v3'
    /** 新界面中所属的图标栏区域，用于高亮。 */
    area?: 'shelf' | 'create' | 'write' | 'plan' | 'codex' | 'review' | 'auto' | 'knowledge'
    /** 用户选择旧界面时改走的地址。 */
    legacyPath?: string
    /** 用户选择新界面时改走的地址。 */
    v3Path?: string
  }
}
