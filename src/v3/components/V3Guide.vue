<template>
  <div class="m-overlay" @click.self="emit('close')">
    <div class="m-modal guide" role="dialog" aria-modal="true" aria-labelledby="v3-guide-title">
      <div class="m-modal-h">
        <div><div class="eyebrow">使用说明 · {{ step + 1 }} / {{ STEPS.length }}</div><h3 id="v3-guide-title">{{ STEPS[step].title }}</h3></div>
        <button type="button" class="m-ibtn" aria-label="关闭" @click="emit('close')"><V3Icon name="x" /></button>
      </div>
      <div class="m-modal-b">
        <img class="art m-art" :src="STEPS[step].art" alt="">
        <p class="desc">{{ STEPS[step].desc }}</p>
        <ul class="pts"><li v-for="p in STEPS[step].points" :key="p">{{ p }}</li></ul>
      </div>
      <div class="m-modal-f">
        <span class="l dots"><i v-for="(_, i) in STEPS" :key="i" :class="{ on: i === step }" /></span>
        <button v-if="step" type="button" class="m-btn" @click="step--">上一步</button>
        <button type="button" class="m-btn" @click="STEPS[step].act()">{{ STEPS[step].actLabel }}</button>
        <button type="button" class="m-btn pri" @click="step < STEPS.length - 1 ? step++ : emit('close')">{{ step < STEPS.length - 1 ? '下一步' : '开始使用' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import V3Icon from './V3Icon.vue'
import step1 from '@/assets/v3/onboarding/step-1.webp'
import step2 from '@/assets/v3/onboarding/step-2.webp'
import step3 from '@/assets/v3/onboarding/step-3.webp'

const emit = defineEmits<{ close: [] }>()
const router = useRouter()
const step = ref(0)
const STEPS = [
  { title: '先配置 AI 模型', art: step1, actLabel: '打开设置', act: () => { emit('close'); void router.push('/settings') },
    desc: '墨笔生花不内置 AI 额度。在“设置 → 模型配置”填写接口地址、密钥和模型名称，测试连接，再为大纲、写作、审校和对话分配模型。',
    points: ['密钥由系统安全存储加密，不进入项目备份', '不配置模型也能手动写作，AI 功能会提示先配置'] },
  { title: '新建一部作品', art: step2, actLabel: '去新建', act: () => { emit('close'); router.push('/create') },
    desc: '从一句灵感、已有大纲文件或空白模板开始。设定按“作品契约 → 故事骨架 → 分卷 → 章节 → 场景”逐层确认。',
    points: ['对话只用来探索，确认后的卡片才成为正式设定', '每一层都可以手动修改，也可以请 AI 给出候选'] },
  { title: '你执笔，AI 写批注', art: step3, actLabel: '回到书架', act: () => { emit('close'); router.push('/') },
    desc: 'AI 的审校意见写在页边，改写和续写以浮签出现，标明“未入正文”。只有你采纳的内容才会进入正文和故事典籍。',
    points: ['定稿前检查阻塞问题、篇幅和待处理的故事变化', '按 Ctrl+K 随时搜索章节、人物和操作'] },
]
</script>

<style scoped>
.guide { width: min(560px, calc(100vw - 48px)); }
.eyebrow { font-size: 12px; letter-spacing: .2em; color: var(--zhu); font-weight: 600; margin-bottom: 2px; }
.art { display: block; width: 100%; max-width: 420px; margin: 0 auto 6px; }
.desc { margin: 0 0 8px; font-size: 14px; line-height: 1.8; color: var(--ink-2); }
.pts { margin: 0; padding-left: 18px; font-size: 12.5px; color: var(--ink-3); line-height: 1.9; }
.dots { display: flex; gap: 6px; }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--line-2); }
.dots i.on { background: var(--zhu); }
</style>
