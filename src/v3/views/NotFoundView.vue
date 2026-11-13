<template>
  <Teleport defer to="#v3-crumb"><span class="crumb-b">页面不存在</span></Teleport>
  <section class="missing-page"><div class="m-panel"><h1>这个页面不存在</h1><p>请从书架选择作品，或使用左侧导航打开功能。</p><router-link class="m-btn zhu" to="/">回到书架</router-link></div></section>
</template>
<style scoped>
.missing-page { height: 100%; display: grid; place-items: center; padding: 24px; }.m-panel { width: min(480px, 100%); padding: 36px; text-align: center; }h1 { font: 600 24px var(--f-serif); }p { margin: 12px 0 22px; color: var(--ink-3); }
</style>
