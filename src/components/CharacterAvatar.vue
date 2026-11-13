<template>
  <span class="character-avatar" :style="{ width: `${size}px`, height: `${size}px`, backgroundColor: character.avatarColor || 'var(--dai)' }" role="img" :aria-label="`${character.name || '角色'}的头像`">
    <img v-if="avatar && !failed" :src="avatar.src" alt="" class="avatar-atlas" :style="{ left: `${-avatar.col * 100}%`, top: `${-avatar.row * 100}%` }" @error="failed = true" />
    <span v-else class="avatar-initial">{{ character.name?.trim().slice(0, 1) || '？' }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { resolveCharacterAvatar, type AvatarCharacter, type CharacterAvatarEra } from '@/data/characterAvatars'
const props = withDefaults(defineProps<{ character: AvatarCharacter; size?: number; era?: CharacterAvatarEra }>(), { size: 56 })
const avatar = computed(() => resolveCharacterAvatar(props.character, { era: props.era }))
const failed = ref(false)
watch(() => avatar.value.src, () => { failed.value = false })
</script>

<style scoped>
.character-avatar { position: relative; display: inline-flex; flex: 0 0 auto; overflow: hidden; border-radius: 14px; border: 1px solid var(--line); vertical-align: middle; }
.avatar-atlas { position: absolute; width: 400%; height: 400%; max-width: none; pointer-events: none; }
.avatar-initial { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: #fffdf8; font: 600 24px var(--f-serif); }
</style>
