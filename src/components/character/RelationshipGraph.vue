<template>
  <div ref="containerRef" class="relationship-graph">
    <!-- 工具栏 -->
    <div class="graph-toolbar">
      <el-button-group>
        <el-button :icon="ZoomIn" @click="zoomIn" />
        <el-button :icon="ZoomOut" @click="zoomOut" />
        <el-button :icon="RefreshRight" @click="resetZoom" />
      </el-button-group>
      <el-select
        v-model="layoutType"
        style="width: 120px; margin-left: 12px"
        @change="updateLayout"
      >
        <el-option label="力导向" value="force" />
        <el-option label="圆形" value="circular" />
        <el-option label="网格" value="grid" />
      </el-select>
    </div>

    <!-- 图例 -->
    <div class="graph-legend">
      <div class="legend-item">
        <span class="legend-color protagonist"></span>
        <span>主角</span>
      </div>
      <div class="legend-item">
        <span class="legend-color supporting"></span>
        <span>配角</span>
      </div>
      <div class="legend-item">
        <span class="legend-color antagonist"></span>
        <span>反派</span>
      </div>
      <div class="legend-item">
        <span class="legend-color other"></span>
        <span>其他</span>
      </div>
    </div>

    <!-- 画布 -->
    <svg ref="svgRef" class="graph-canvas">
      <defs>
        <!-- 箭头标记 -->
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="20"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#909399" />
        </marker>
      </defs>
      <g ref="graphGroup" class="graph-group">
        <!-- 连线 -->
        <g class="links">
          <g
            v-for="link in links"
            :key="`${link.source.id}-${link.target.id}`"
            class="link-group"
          >
            <line
              class="link-line"
              :x1="link.source.x"
              :y1="link.source.y"
              :x2="link.target.x"
              :y2="link.target.y"
              marker-end="url(#arrow)"
            />
            <text
              class="link-label"
              :x="(link.source.x + link.target.x) / 2"
              :y="(link.source.y + link.target.y) / 2 - 5"
            >
              {{ link.relation }}
            </text>
          </g>
        </g>
        <!-- 节点 -->
        <g class="nodes">
          <g
            v-for="node in nodes"
            :key="node.id"
            class="node-group"
            :transform="`translate(${node.x}, ${node.y})`"
            @click="handleNodeClick(node)"
            @mouseenter="handleNodeHover(node)"
            @mouseleave="handleNodeLeave"
          >
            <circle
              class="node-circle"
              :r="getNodeRadius(node)"
              :class="node.type"
            />
            <text class="node-label" dy="4" text-anchor="middle">
              {{ node.name.charAt(0) }}
            </text>
            <text class="node-name" :y="getNodeRadius(node) + 14" text-anchor="middle">
              {{ node.name }}
            </text>
          </g>
        </g>
      </g>
    </svg>

    <!-- 节点详情弹出 -->
    <div
      v-if="hoveredNode"
      class="node-tooltip"
      :style="tooltipStyle"
    >
      <h4>{{ hoveredNode.name }}</h4>
      <p v-if="hoveredNode.type">类型：{{ getTypeLabel(hoveredNode.type) }}</p>
      <p v-if="hoveredNode.relationCount">关系数：{{ hoveredNode.relationCount }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { ZoomIn, ZoomOut, RefreshRight } from '@element-plus/icons-vue'
import { useCharacterStore } from '@/stores/characterStore'
import type { Character, CharacterType } from '@/types'
import { CHARACTER_TYPE_MAP } from '@/types/character'

// Props
const props = defineProps<{
  bookId: string
}>()

// Emits
const emit = defineEmits<{
  selectNode: [character: Character]
}>()

// Store
const characterStore = useCharacterStore()

// Refs
const containerRef = ref<HTMLDivElement>()
const svgRef = ref<SVGSVGElement>()
const graphGroup = ref<SVGGElement>()

// 状态
const layoutType = ref('force')
const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const hoveredNode = ref<GraphNode | null>(null)
const tooltipPosition = ref({ x: 0, y: 0 })

// 类型定义
interface GraphNode {
  id: string
  name: string
  type: CharacterType
  x: number
  y: number
  vx: number
  vy: number
  relationCount: number
  character: Character
}

interface GraphLink {
  source: GraphNode
  target: GraphNode
  relation: string
}

// 节点和连线
const nodes = ref<GraphNode[]>([])
const links = ref<GraphLink[]>([])

// 计算属性
const tooltipStyle = computed(() => ({
  left: `${tooltipPosition.value.x + 10}px`,
  top: `${tooltipPosition.value.y + 10}px`
}))

// 方法
function buildGraph() {
  const characters = characterStore.characters
  if (characters.length === 0) return

  // 构建节点
  const nodeMap = new Map<string, GraphNode>()
  const width = containerRef.value?.clientWidth || 800
  const height = containerRef.value?.clientHeight || 600

  characters.forEach((char, index) => {
    const angle = (2 * Math.PI * index) / characters.length
    const radius = Math.min(width, height) / 3

    nodeMap.set(char.id, {
      id: char.id,
      name: char.name,
      type: char.type as CharacterType,
      x: width / 2 + radius * Math.cos(angle),
      y: height / 2 + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
      relationCount: char.state?.relationships?.length || 0,
      character: char
    })
  })

  nodes.value = Array.from(nodeMap.values())

  // 构建连线
  const newLinks: GraphLink[] = []
  characters.forEach(char => {
    const sourceNode = nodeMap.get(char.id)
    if (!sourceNode || !char.state?.relationships) return

    char.state.relationships.forEach(rel => {
      const targetNode = nodeMap.get(rel.targetId)
      if (targetNode) {
        newLinks.push({
          source: sourceNode,
          target: targetNode,
          relation: rel.relation
        })
      }
    })
  })

  links.value = newLinks

  // 应用布局
  updateLayout()
}

function updateLayout() {
  const width = containerRef.value?.clientWidth || 800
  const height = containerRef.value?.clientHeight || 600

  switch (layoutType.value) {
    case 'force':
      applyForceLayout(width, height)
      break
    case 'circular':
      applyCircularLayout(width, height)
      break
    case 'grid':
      applyGridLayout(width, height)
      break
  }
}

function applyForceLayout(width: number, height: number) {
  // 简化的力导向布局
  const iterations = 100
  const repulsion = 5000
  const attraction = 0.01

  for (let i = 0; i < iterations; i++) {
    // 斥力
    nodes.value.forEach(node1 => {
      nodes.value.forEach(node2 => {
        if (node1.id === node2.id) return
        const dx = node1.x - node2.x
        const dy = node1.y - node2.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = repulsion / (dist * dist)
        node1.vx += (dx / dist) * force * 0.1
        node1.vy += (dy / dist) * force * 0.1
      })
    })

    // 引力（连线）
    links.value.forEach(link => {
      const dx = link.target.x - link.source.x
      const dy = link.target.y - link.source.y
      link.source.vx += dx * attraction
      link.source.vy += dy * attraction
      link.target.vx -= dx * attraction
      link.target.vy -= dy * attraction
    })

    // 向中心的引力
    nodes.value.forEach(node => {
      node.vx += (width / 2 - node.x) * 0.001
      node.vy += (height / 2 - node.y) * 0.001
    })

    // 应用速度
    nodes.value.forEach(node => {
      node.x += node.vx
      node.y += node.vy
      node.vx *= 0.9
      node.vy *= 0.9

      // 边界约束
      const radius = getNodeRadius(node)
      node.x = Math.max(radius, Math.min(width - radius, node.x))
      node.y = Math.max(radius, Math.min(height - radius, node.y))
    })
  }
}

function applyCircularLayout(width: number, height: number) {
  const centerX = width / 2
  const centerY = height / 2
  const radius = Math.min(width, height) / 3

  nodes.value.forEach((node, index) => {
    const angle = (2 * Math.PI * index) / nodes.value.length - Math.PI / 2
    node.x = centerX + radius * Math.cos(angle)
    node.y = centerY + radius * Math.sin(angle)
  })
}

function applyGridLayout(width: number, height: number) {
  const cols = Math.ceil(Math.sqrt(nodes.value.length))
  const rows = Math.ceil(nodes.value.length / cols)
  const cellWidth = width / (cols + 1)
  const cellHeight = height / (rows + 1)

  nodes.value.forEach((node, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    node.x = (col + 1) * cellWidth
    node.y = (row + 1) * cellHeight
  })
}

function getNodeRadius(node: GraphNode): number {
  const baseRadius = 24
  const countBonus = Math.min(node.relationCount * 2, 12)
  return baseRadius + countBonus
}

function getTypeLabel(type: CharacterType): string {
  return CHARACTER_TYPE_MAP[type] || '其他'
}

function zoomIn() {
  scale.value = Math.min(scale.value * 1.2, 3)
  updateTransform()
}

function zoomOut() {
  scale.value = Math.max(scale.value / 1.2, 0.3)
  updateTransform()
}

function resetZoom() {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
  updateTransform()
}

function updateTransform() {
  if (graphGroup.value) {
    graphGroup.value.setAttribute(
      'transform',
      `translate(${translateX.value}, ${translateY.value}) scale(${scale.value})`
    )
  }
}

function handleNodeClick(node: GraphNode) {
  emit('selectNode', node.character)
}

function handleNodeHover(node: GraphNode) {
  hoveredNode.value = node
}

function handleNodeLeave() {
  hoveredNode.value = null
}

function handleMouseMove(event: MouseEvent) {
  tooltipPosition.value = {
    x: event.clientX - (containerRef.value?.getBoundingClientRect().left || 0),
    y: event.clientY - (containerRef.value?.getBoundingClientRect().top || 0)
  }
}

// 监听
watch(() => characterStore.characters, () => {
  buildGraph()
}, { deep: true })

watch(() => props.bookId, async () => {
  if (props.bookId) {
    await characterStore.fetchCharacters(props.bookId)
    buildGraph()
  }
}, { immediate: true })

// 生命周期
onMounted(() => {
  if (containerRef.value) {
    containerRef.value.addEventListener('mousemove', handleMouseMove)
  }
  buildGraph()
})

onUnmounted(() => {
  if (containerRef.value) {
    containerRef.value.removeEventListener('mousemove', handleMouseMove)
  }
})
</script>

<style scoped lang="scss">
.relationship-graph {
  width: 100%;
  height: 100%;
  position: relative;
  background: var(--el-bg-color);
  overflow: hidden;
}

.graph-toolbar {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 10;
  display: flex;
  align-items: center;
}

.graph-legend {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  .legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .legend-color {
    width: 16px;
    height: 16px;
    border-radius: 50%;

    &.protagonist {
      background: linear-gradient(135deg, #f56c6c, #e6a23c);
    }

    &.supporting {
      background: linear-gradient(135deg, #e6a23c, #67c23a);
    }

    &.antagonist {
      background: linear-gradient(135deg, #909399, #303133);
    }

    &.other {
      background: linear-gradient(135deg, #409eff, #67c23a);
    }
  }
}

.graph-canvas {
  width: 100%;
  height: 100%;
}

.link-line {
  stroke: #c0c4cc;
  stroke-width: 1.5;
  fill: none;
}

.link-label {
  font-size: 11px;
  fill: var(--el-text-color-secondary);
  text-anchor: middle;
}

.node-circle {
  cursor: pointer;
  transition: all 0.2s ease;

  &.protagonist {
    fill: url(#protagonist-gradient);
    fill: #f56c6c;
  }

  &.supporting {
    fill: #e6a23c;
  }

  &.antagonist {
    fill: #606266;
  }

  &.other {
    fill: #409eff;
  }

  &:hover {
    stroke: var(--el-color-primary);
    stroke-width: 3;
    filter: brightness(1.1);
  }
}

.node-label {
  fill: white;
  font-size: 14px;
  font-weight: bold;
  pointer-events: none;
}

.node-name {
  fill: var(--el-text-color-primary);
  font-size: 12px;
  pointer-events: none;
}

.node-tooltip {
  position: absolute;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  z-index: 100;
  pointer-events: none;

  h4 {
    margin: 0 0 8px;
    font-size: 14px;
  }

  p {
    margin: 4px 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}
</style>
