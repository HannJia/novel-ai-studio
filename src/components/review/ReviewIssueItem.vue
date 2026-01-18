<template>
  <div class="review-issue-item" :class="issue.level">
    <div class="issue-header">
      <el-tag :type="levelConfig.tagType" size="small" effect="dark">
        {{ levelConfig.label }}
      </el-tag>
      <span class="issue-title">{{ issue.title }}</span>
      <span class="issue-chapter" v-if="issue.chapterOrder">
        第{{ issue.chapterOrder }}章
      </span>
    </div>

    <div class="issue-body">
      <p class="issue-description">{{ issue.description }}</p>

      <div class="issue-location" v-if="issue.location?.originalText">
        <span class="label">原文：</span>
        <span class="text">"{{ issue.location.originalText }}"</span>
      </div>

      <div class="issue-suggestion" v-if="issue.suggestion">
        <span class="label">建议：</span>
        <span class="text">{{ issue.suggestion }}</span>
      </div>

      <div class="issue-confidence" v-if="issue.confidence">
        <span class="label">置信度：</span>
        <el-progress
          :percentage="Math.round(issue.confidence * 100)"
          :stroke-width="6"
          :show-text="true"
          style="width: 100px; display: inline-flex;"
        />
      </div>
    </div>

    <div class="issue-actions">
      <el-button
        type="success"
        size="small"
        text
        @click="emit('fix', issue)"
      >
        <el-icon><Check /></el-icon>
        已修复
      </el-button>
      <el-button
        type="info"
        size="small"
        text
        @click="emit('ignore', issue)"
      >
        <el-icon><Close /></el-icon>
        忽略
      </el-button>
      <el-button
        type="primary"
        size="small"
        text
        @click="emit('locate', issue)"
      >
        <el-icon><Position /></el-icon>
        定位
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Check, Close, Position } from '@element-plus/icons-vue'
import type { ReviewIssue } from '@/types/review'
import { REVIEW_LEVEL_CONFIG } from '@/types/review'

const props = defineProps<{
  issue: ReviewIssue
}>()

const emit = defineEmits<{
  fix: [issue: ReviewIssue]
  ignore: [issue: ReviewIssue]
  locate: [issue: ReviewIssue]
}>()

const levelConfig = computed(() => REVIEW_LEVEL_CONFIG[props.issue.level])
</script>

<style scoped lang="scss">
.review-issue-item {
  padding: 12px;
  margin-bottom: 8px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  border-left: 3px solid;
  transition: all 0.2s;

  &:hover {
    background: var(--el-fill-color);
  }

  &.error {
    border-left-color: #f56c6c;
  }

  &.warning {
    border-left-color: #e6a23c;
  }

  &.suggestion {
    border-left-color: #409eff;
  }

  &.info {
    border-left-color: #909399;
  }
}

.issue-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;

  .issue-title {
    font-weight: 500;
    flex: 1;
  }

  .issue-chapter {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}

.issue-body {
  font-size: 13px;
  color: var(--el-text-color-regular);

  .issue-description {
    margin: 0 0 8px 0;
    line-height: 1.5;
  }

  .issue-location,
  .issue-suggestion,
  .issue-confidence {
    margin-bottom: 6px;

    .label {
      color: var(--el-text-color-secondary);
      margin-right: 4px;
    }

    .text {
      color: var(--el-text-color-primary);
    }
  }

  .issue-location .text {
    font-style: italic;
    background: var(--el-fill-color-darker);
    padding: 2px 6px;
    border-radius: 3px;
  }
}

.issue-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}
</style>
