# NovelAI Studio 开发规范文档

> 本文档供多AI协作开发使用，任何AI在参与开发前必须阅读此文档。

---

## 一、项目概述

### 1.1 项目简介

**项目名称**：NovelAI Studio
**项目类型**：Windows 桌面应用程序
**项目目标**：个人AI辅助小说创作工具，支持多书籍管理、多AI接入、智能创作与逻辑审查

### 1.2 核心功能

1. **书籍管理**：同时管理多本不同类型的书籍
2. **AI创作**：一键生成大纲、章节，支持续写/改写
3. **知识库**：按书籍隔离的文件知识库，支持语义检索
4. **记忆系统**：超百万字记忆，四层记忆架构
5. **伏笔追踪**：手动+AI识别伏笔，追踪回收状态
6. **逻辑审查**：自动检测剧情逻辑问题
7. **多AI支持**：接入OpenAI、Claude、国产模型、本地模型
8. **导出发布**：多格式导出，平台适配，敏感词检测

### 1.3 字数统计规则

**重要**：本项目所有字数统计不包含标点符号。

```
统计规则：
├── ✓ 计入
│   ├── 中文汉字（每字算1）
│   ├── 英文单词（每词算1，非字母数）
│   └── 数字（连续数字算1）
│
└── ✗ 不计入
    ├── 标点符号（，。！？；：""''【】（）等）
    ├── 空格、制表符、换行符
    └── 特殊符号（★☆●○※→等）
```

---

## 二、技术栈

### 2.1 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| Electron | ^28.0.0 | 桌面应用框架 |
| Vue | ^3.4.0 | 前端框架 |
| TypeScript | ^5.3.0 | 类型安全 |
| Vite | ^5.0.0 | 构建工具 |
| Pinia | ^2.1.0 | 状态管理 |
| Element Plus | ^2.5.0 | UI组件库 |
| Vue Router | ^4.2.0 | 路由管理 |
| Monaco Editor | ^0.45.0 | 代码/文本编辑器 |

### 2.2 后端服务（Java）

| 技术 | 版本 | 用途 |
|------|------|------|
| Java | 17+ | 后端运行环境 |
| Spring Boot | 3.2+ | 后端框架 |
| MySQL | 8.0+ | 关系型数据库 |
| MySQL Connector/J | 8.0+ | MySQL数据库连接 |
| MyBatis-Plus | 3.5+ | ORM框架 |
| Druid | 1.2+ | 数据库连接池 |
| Milvus/Qdrant | - | 向量数据库（可选本地部署） |

### 2.3 AI相关

| 技术 | 用途 |
|------|------|
| OpenAI Java SDK | GPT系列接入 |
| OkHttp | HTTP客户端（Claude/其他API） |
| Ollama API | 本地模型接入 |

---

## 三、目录结构

```
novel-ai-studio/
├── electron/                    # Electron 主进程
│   ├── main.ts                  # 主进程入口
│   ├── preload.ts               # 预加载脚本
│   └── ipc/                     # IPC通信处理
│       ├── database.ts          # 数据库IPC
│       ├── file.ts              # 文件操作IPC
│       └── ai.ts                # AI调用IPC
│
├── src/                         # Vue 前端源码
│   ├── main.ts                  # Vue入口
│   ├── App.vue                  # 根组件
│   │
│   ├── assets/                  # 静态资源
│   │   ├── icons/
│   │   └── images/
│   │
│   ├── styles/                  # 全局样式
│   │   ├── variables.scss       # 样式变量
│   │   ├── global.scss          # 全局样式
│   │   └── themes/              # 主题文件
│   │
│   ├── types/                   # TypeScript类型定义
│   │   ├── index.ts             # 类型导出
│   │   ├── book.ts              # 书籍相关类型
│   │   ├── chapter.ts           # 章节相关类型
│   │   ├── character.ts         # 角色相关类型
│   │   ├── knowledge.ts         # 知识库相关类型
│   │   ├── memory.ts            # 记忆系统类型
│   │   ├── ai.ts                # AI相关类型
│   │   └── common.ts            # 通用类型
│   │
│   ├── utils/                   # 工具函数
│   │   ├── wordCount.ts         # 字数统计
│   │   ├── format.ts            # 格式化工具
│   │   ├── storage.ts           # 本地存储
│   │   └── helpers.ts           # 通用辅助函数
│   │
│   ├── stores/                  # Pinia状态管理
│   │   ├── index.ts             # Store导出
│   │   ├── bookStore.ts         # 书籍状态
│   │   ├── chapterStore.ts      # 章节状态
│   │   ├── editorStore.ts       # 编辑器状态
│   │   ├── aiStore.ts           # AI配置状态
│   │   └── uiStore.ts           # UI状态
│   │
│   ├── services/                # 业务逻辑服务
│   │   ├── database/            # 数据库服务
│   │   │   ├── index.ts
│   │   │   ├── bookService.ts
│   │   │   ├── chapterService.ts
│   │   │   └── characterService.ts
│   │   ├── ai/                  # AI服务
│   │   │   ├── index.ts
│   │   │   ├── adapters/        # AI适配器
│   │   │   │   ├── base.ts      # 基础适配器接口
│   │   │   │   ├── openai.ts
│   │   │   │   ├── claude.ts
│   │   │   │   └── ollama.ts
│   │   │   ├── generator.ts     # 内容生成
│   │   │   └── reviewer.ts      # 逻辑审查
│   │   ├── knowledge/           # 知识库服务
│   │   │   ├── index.ts
│   │   │   ├── parser.ts        # 文件解析
│   │   │   └── retriever.ts     # 检索服务
│   │   └── memory/              # 记忆系统服务
│   │       ├── index.ts
│   │       ├── shortTerm.ts     # 短期记忆
│   │       ├── longTerm.ts      # 长期记忆
│   │       └── foreshadow.ts    # 伏笔追踪
│   │
│   ├── components/              # Vue组件
│   │   ├── common/              # 通用组件
│   │   │   ├── AppIcon.vue
│   │   │   ├── AppButton.vue
│   │   │   ├── AppDialog.vue
│   │   │   └── index.ts
│   │   ├── layout/              # 布局组件
│   │   │   ├── AppHeader.vue
│   │   │   ├── AppSidebar.vue
│   │   │   ├── AppContent.vue
│   │   │   ├── AppRightPanel.vue
│   │   │   └── AppStatusBar.vue
│   │   ├── book/                # 书籍相关组件
│   │   │   ├── BookList.vue
│   │   │   ├── BookCard.vue
│   │   │   ├── BookCreate.vue
│   │   │   └── BookSettings.vue
│   │   ├── chapter/             # 章节相关组件
│   │   │   ├── ChapterTree.vue
│   │   │   ├── ChapterItem.vue
│   │   │   └── ChapterCreate.vue
│   │   ├── editor/              # 编辑器相关组件
│   │   │   ├── MainEditor.vue
│   │   │   ├── EditorToolbar.vue
│   │   │   ├── OutlineEditor.vue
│   │   │   └── VersionHistory.vue
│   │   ├── character/           # 角色相关组件
│   │   │   ├── CharacterList.vue
│   │   │   ├── CharacterCard.vue
│   │   │   ├── CharacterEdit.vue
│   │   │   └── RelationshipGraph.vue
│   │   ├── knowledge/           # 知识库相关组件
│   │   │   ├── KnowledgePanel.vue
│   │   │   ├── FileUpload.vue
│   │   │   ├── FileList.vue
│   │   │   └── SearchResult.vue
│   │   ├── ai/                  # AI相关组件
│   │   │   ├── AiChat.vue
│   │   │   ├── AiConfigPanel.vue
│   │   │   ├── GenerateDialog.vue
│   │   │   └── TokenStats.vue
│   │   ├── review/              # 审查相关组件
│   │   │   ├── ReviewPanel.vue
│   │   │   ├── ReviewReport.vue
│   │   │   └── IssueItem.vue
│   │   └── foreshadow/          # 伏笔相关组件
│   │       ├── ForeshadowList.vue
│   │       ├── ForeshadowMark.vue
│   │       └── ForeshadowGraph.vue
│   │
│   ├── views/                   # 页面视图
│   │   ├── HomeView.vue         # 首页/书籍列表
│   │   ├── EditorView.vue       # 写作编辑页
│   │   ├── CharacterView.vue    # 角色管理页
│   │   ├── SettingsView.vue     # 设定百科页
│   │   ├── KnowledgeView.vue    # 知识库页
│   │   ├── ReviewView.vue       # 审查报告页
│   │   ├── ExportView.vue       # 导出页
│   │   └── ConfigView.vue       # 软件设置页
│   │
│   └── router/                  # 路由配置
│       └── index.ts
│
├── java-backend/                # Java后端服务
│   ├── pom.xml                  # Maven配置
│   ├── src/
│   │   └── main/
│   │       ├── java/com/novelai/studio/
│   │       │   ├── NovelAiApplication.java
│   │       │   ├── config/          # 配置类
│   │       │   ├── controller/      # REST控制器
│   │       │   ├── service/         # 业务服务
│   │       │   │   ├── ai/          # AI调用服务
│   │       │   │   │   ├── AIService.java
│   │       │   │   │   ├── adapter/
│   │       │   │   │   │   ├── AIAdapter.java
│   │       │   │   │   │   ├── OpenAIAdapter.java
│   │       │   │   │   │   ├── ClaudeAdapter.java
│   │       │   │   │   │   └── OllamaAdapter.java
│   │       │   │   │   └── generator/
│   │       │   │   ├── knowledge/   # 知识库服务
│   │       │   │   │   ├── VectorService.java
│   │       │   │   │   └── FileParserService.java
│   │       │   │   ├── memory/      # 记忆系统服务
│   │       │   │   └── review/      # 审查服务
│   │       │   ├── mapper/          # MyBatis Mapper
│   │       │   ├── entity/          # 实体类
│   │       │   ├── dto/             # 数据传输对象
│   │       │   └── util/            # 工具类
│   │       └── resources/
│   │           ├── application.yml
│   │           └── mapper/          # MyBatis XML
│   └── target/                  # 编译输出
│
├── database/                    # 数据库相关
│   ├── schema.sql               # 建表语句
│   └── migrations/              # 迁移脚本
│
├── resources/                   # 应用资源
│   ├── icons/                   # 应用图标
│   ├── templates/               # Prompt模板
│   └── dictionaries/            # 敏感词库等
│
├── tests/                       # 测试文件
│   ├── unit/
│   └── e2e/
│
├── .eslintrc.cjs                # ESLint配置
├── .prettierrc                  # Prettier配置
├── tsconfig.json                # TypeScript配置
├── vite.config.ts               # Vite配置
├── electron-builder.json        # 打包配置
├── package.json
├── DEVELOPMENT.md               # 本文档
└── README.md
```

---

## 四、代码规范

### 4.1 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `book-service.ts` |
| Vue组件 | PascalCase | `BookCard.vue` |
| 类名 | PascalCase | `class BookService` |
| 函数/方法 | camelCase | `function getBookById()` |
| 变量 | camelCase | `const bookList` |
| 常量 | UPPER_SNAKE_CASE | `const MAX_TOKENS = 4096` |
| 类型/接口 | PascalCase | `interface Book` |
| 枚举 | PascalCase | `enum BookStatus` |
| CSS类名 | kebab-case | `.book-card` |

### 4.2 文件组织规范

```typescript
// 文件内代码顺序（Vue组件）
<script setup lang="ts">
// 1. 导入
import { ref, computed } from 'vue'
import type { Book } from '@/types'

// 2. Props/Emits定义
const props = defineProps<{
  bookId: string
}>()

const emit = defineEmits<{
  update: [book: Book]
}>()

// 3. 响应式状态
const loading = ref(false)
const book = ref<Book | null>(null)

// 4. 计算属性
const bookTitle = computed(() => book.value?.title ?? '')

// 5. 方法
function handleSave() {
  // ...
}

// 6. 生命周期钩子
onMounted(() => {
  // ...
})
</script>

<template>
  <!-- 模板内容 -->
</template>

<style scoped lang="scss">
/* 样式 */
</style>
```

### 4.3 TypeScript规范

```typescript
// 1. 优先使用 interface 定义对象类型
interface Book {
  id: string
  title: string
}

// 2. 使用 type 定义联合类型、交叉类型
type BookStatus = 'writing' | 'paused' | 'completed'

// 3. 避免使用 any，使用 unknown 代替
function parseData(data: unknown): Book {
  // 类型守卫
  if (isBook(data)) {
    return data
  }
  throw new Error('Invalid data')
}

// 4. 函数必须声明返回类型
function getBook(id: string): Promise<Book | null> {
  // ...
}

// 5. 使用可选链和空值合并
const title = book?.title ?? '未命名'
```

### 4.4 Vue组件规范

```vue
<script setup lang="ts">
// 1. 组件名通过文件名体现，无需显式声明

// 2. Props 使用 TypeScript 类型定义
const props = withDefaults(defineProps<{
  title: string
  count?: number
}>(), {
  count: 0
})

// 3. Emits 使用类型定义
const emit = defineEmits<{
  change: [value: string]
  submit: []
}>()

// 4. 暴露方法给父组件使用 defineExpose
defineExpose({
  reset
})
</script>

<template>
  <!-- 5. 模板中使用 kebab-case 的属性名 -->
  <div class="component-name">
    <child-component
      :prop-name="value"
      @event-name="handler"
    />
  </div>
</template>

<style scoped lang="scss">
// 6. 使用 scoped 避免样式污染
// 7. 使用 BEM 命名（可选）
.component-name {
  &__header {}
  &__body {}
  &--active {}
}
</style>
```

### 4.5 注释规范

```typescript
/**
 * 书籍服务类
 * 处理书籍的CRUD操作
 */
class BookService {
  /**
   * 根据ID获取书籍
   * @param id - 书籍ID
   * @returns 书籍对象，不存在时返回null
   */
  async getById(id: string): Promise<Book | null> {
    // 实现逻辑
  }
}

// 单行注释用于解释复杂逻辑
// 移除标点后再统计字数
const count = countWithoutPunctuation(text)
```

### 4.6 Java代码规范

#### 4.6.1 命名规范（Java）

| 类型 | 规范 | 示例 |
|------|------|------|
| 包名 | 全小写 | `com.novelai.studio.service` |
| 类名 | PascalCase | `BookService` |
| 接口名 | PascalCase，可加I前缀 | `AIAdapter` 或 `IAIAdapter` |
| 方法名 | camelCase | `getBookById()` |
| 变量名 | camelCase | `bookList` |
| 常量 | UPPER_SNAKE_CASE | `MAX_TOKENS` |
| 枚举值 | UPPER_SNAKE_CASE | `WRITING`, `COMPLETED` |

#### 4.6.2 类文件组织

```java
package com.novelai.studio.service;

// 1. 导入（按顺序：java、javax、第三方、本项目）
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

import com.novelai.studio.entity.Book;
import com.novelai.studio.mapper.BookMapper;

/**
 * 书籍服务类
 * 处理书籍的CRUD操作
 *
 * @author NovelAI
 * @since 1.0
 */
@Service
public class BookService {

    // 2. 常量
    private static final int MAX_TITLE_LENGTH = 100;

    // 3. 成员变量（使用构造器注入）
    private final BookMapper bookMapper;

    // 4. 构造器
    @Autowired
    public BookService(BookMapper bookMapper) {
        this.bookMapper = bookMapper;
    }

    // 5. 公共方法
    /**
     * 根据ID获取书籍
     *
     * @param id 书籍ID
     * @return 书籍对象，不存在时返回Optional.empty()
     */
    public Optional<Book> getById(String id) {
        return Optional.ofNullable(bookMapper.selectById(id));
    }

    // 6. 私有方法
    private void validateBook(Book book) {
        // 验证逻辑
    }
}
```

#### 4.6.3 接口定义（AI适配器示例）

```java
package com.novelai.studio.service.ai.adapter;

/**
 * AI适配器接口
 * 所有AI服务提供商需实现此接口
 */
public interface AIAdapter {

    /**
     * 获取适配器名称
     */
    String getName();

    /**
     * 获取提供商类型
     */
    AIProvider getProvider();

    /**
     * 生成内容
     *
     * @param prompt 提示词
     * @param options 生成选项
     * @return 生成结果
     */
    GenerateResult generate(String prompt, GenerateOptions options);

    /**
     * 流式生成内容
     *
     * @param prompt 提示词
     * @param options 生成选项
     * @param consumer 内容消费者（逐块接收）
     * @return 生成结果
     */
    GenerateResult generateStream(String prompt, GenerateOptions options,
                                   Consumer<String> consumer);

    /**
     * 测试连接
     */
    boolean testConnection();

    /**
     * 获取可用模型列表
     */
    List<String> listModels();
}
```

#### 4.6.4 实体类规范

```java
package com.novelai.studio.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 书籍实体
 */
@Data
@TableName("books")
public class Book {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    private String title;

    private String author;

    @TableField("genre")
    private BookGenre genre;

    private BookStyle style;

    private String description;

    private String coverImage;

    private BookStatus status;

    /** 字数统计（不含标点） */
    private Integer wordCount;

    private Integer chapterCount;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
}
```

#### 4.6.5 REST控制器规范

```java
package com.novelai.studio.controller;

import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;

@RestController
@RequestMapping("/api/books")
public class BookController {

    private final BookService bookService;

    public BookController(BookService bookService) {
        this.bookService = bookService;
    }

    @GetMapping("/{id}")
    public ResponseEntity<Book> getBook(@PathVariable String id) {
        return bookService.getById(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<Book> createBook(@RequestBody @Valid CreateBookRequest request) {
        Book book = bookService.create(request);
        return ResponseEntity.ok(book);
    }

    @PutMapping("/{id}")
    public ResponseEntity<Book> updateBook(
            @PathVariable String id,
            @RequestBody @Valid UpdateBookRequest request) {
        return bookService.update(id, request)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteBook(@PathVariable String id) {
        bookService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
```

---

## 五、类型定义

### 5.1 书籍相关类型 (`src/types/book.ts`)

```typescript
/**
 * 书籍类型枚举
 */
export type BookGenre =
  | 'xuanhuan'    // 玄幻
  | 'xiuzhen'     // 修真
  | 'dushi'       // 都市
  | 'kehuan'      // 科幻
  | 'lishi'       // 历史
  | 'yanqing'     // 言情
  | 'xuanyi'      // 悬疑
  | 'qita'        // 其他

/**
 * 书籍风格枚举
 */
export type BookStyle =
  | 'qingsong'    // 轻松
  | 'yansu'       // 严肃
  | 'rexue'       // 热血
  | 'nuexin'      // 虐心
  | 'huaji'       // 搞笑
  | 'heian'       // 黑暗

/**
 * 书籍状态
 */
export type BookStatus = 'writing' | 'paused' | 'completed'

/**
 * 书籍接口
 */
export interface Book {
  id: string
  title: string
  author: string
  genre: BookGenre
  style: BookStyle
  description: string
  coverImage?: string
  status: BookStatus
  wordCount: number           // 不含标点的总字数
  chapterCount: number
  createdAt: string           // ISO日期字符串
  updatedAt: string
}

/**
 * 创建书籍的输入
 */
export interface CreateBookInput {
  title: string
  author?: string
  genre: BookGenre
  style: BookStyle
  description?: string
}

/**
 * 更新书籍的输入
 */
export interface UpdateBookInput {
  title?: string
  author?: string
  genre?: BookGenre
  style?: BookStyle
  description?: string
  status?: BookStatus
  coverImage?: string
}

/**
 * 卷接口
 */
export interface Volume {
  id: string
  bookId: string
  title: string
  order: number
  chapterCount: number
  wordCount: number
  createdAt: string
  updatedAt: string
}
```

### 5.2 章节相关类型 (`src/types/chapter.ts`)

```typescript
/**
 * 章节状态
 */
export type ChapterStatus = 'draft' | 'completed' | 'reviewing'

/**
 * 章节接口
 */
export interface Chapter {
  id: string
  bookId: string
  volumeId: string | null
  title: string
  content: string
  outline: string             // 章节大纲
  summary?: string            // AI生成的摘要（记忆系统用）
  wordCount: number           // 不含标点
  order: number
  status: ChapterStatus
  createdAt: string
  updatedAt: string
}

/**
 * 创建章节输入
 */
export interface CreateChapterInput {
  bookId: string
  volumeId?: string
  title: string
  outline?: string
  order?: number
}

/**
 * 更新章节输入
 */
export interface UpdateChapterInput {
  title?: string
  content?: string
  outline?: string
  summary?: string
  status?: ChapterStatus
}

/**
 * 章节树节点（用于侧边栏展示）
 */
export interface ChapterTreeNode {
  id: string
  title: string
  type: 'volume' | 'chapter'
  order: number
  wordCount: number
  status?: ChapterStatus
  children?: ChapterTreeNode[]
}
```

### 5.3 角色相关类型 (`src/types/character.ts`)

```typescript
/**
 * 角色类型
 */
export type CharacterType =
  | 'protagonist'   // 主角
  | 'supporting'    // 配角
  | 'antagonist'    // 反派
  | 'other'         // 其他

/**
 * 角色档案
 */
export interface CharacterProfile {
  gender: string
  age: string
  appearance: string          // 外貌描述
  personality: string         // 性格特点
  background: string          // 背景故事
  abilities: string           // 能力/技能
  goals: string               // 目标/动机
  extra: Record<string, string>  // 自定义字段
}

/**
 * 角色关系
 */
export interface CharacterRelationship {
  targetId: string            // 关系对象ID
  targetName: string          // 关系对象名称
  relation: string            // 关系描述（如：师父、宿敌、恋人）
  description?: string        // 详细描述
}

/**
 * 角色状态（可变状态）
 */
export interface CharacterState {
  isAlive: boolean
  location: string            // 当前位置
  powerLevel: string          // 当前实力等级
  relationships: CharacterRelationship[]
  items: string[]             // 持有物品
  lastUpdatedChapter: number  // 最后更新的章节序号
  stateHistory: CharacterStateChange[]
}

/**
 * 角色状态变更记录
 */
export interface CharacterStateChange {
  chapterId: string
  chapterOrder: number
  field: string               // 变更的字段
  oldValue: string
  newValue: string
  reason: string              // 变更原因
  timestamp: string
}

/**
 * 角色完整接口
 */
export interface Character {
  id: string
  bookId: string
  name: string
  aliases: string[]           // 别名/称呼列表
  type: CharacterType
  profile: CharacterProfile
  state: CharacterState
  createdAt: string
  updatedAt: string
}
```

### 5.4 知识库相关类型 (`src/types/knowledge.ts`)

```typescript
/**
 * 知识库文件类型
 */
export type KnowledgeFileType = 'txt' | 'pdf' | 'docx' | 'epub' | 'md'

/**
 * 知识库分类
 */
export interface KnowledgeCategory {
  id: string
  bookId: string | null       // null表示全局分类
  name: string
  parentId: string | null
  order: number
  createdAt: string
}

/**
 * 知识库文件
 */
export interface KnowledgeFile {
  id: string
  bookId: string | null       // null表示全局知识库
  categoryId: string | null
  filename: string
  originalName: string
  fileType: KnowledgeFileType
  fileSize: number
  filePath: string
  isIndexed: boolean          // 是否已向量化
  chunkCount: number          // 分块数量
  tags: string[]
  createdAt: string
  updatedAt: string
}

/**
 * 知识检索结果
 */
export interface KnowledgeSearchResult {
  fileId: string
  filename: string
  content: string             // 匹配的内容片段
  score: number               // 相关度分数
  metadata: Record<string, unknown>
}
```

### 5.5 记忆系统类型 (`src/types/memory.ts`)

```typescript
/**
 * 章节摘要（L2短期记忆）
 */
export interface ChapterSummary {
  chapterId: string
  chapterOrder: number
  summary: string             // 摘要正文（500-1000字）
  keyEvents: string[]         // 关键事件列表
  charactersAppeared: string[]// 出场角色ID列表
  emotionalTone: string       // 情感基调
  createdAt: string
  updatedAt: string
}

/**
 * 故事事件（L3长期记忆）
 */
export interface StoryEvent {
  id: string
  bookId: string
  chapterId: string
  chapterOrder: number
  title: string
  description: string
  eventType: 'major' | 'minor' | 'background'
  involvedCharacters: string[]
  location: string
  timelineOrder: number       // 故事内时间顺序
  impact: string              // 事件影响
  createdAt: string
}

/**
 * 伏笔类型
 */
export type ForeshadowType =
  | 'prophecy'     // 预言
  | 'item'         // 物品
  | 'character'    // 角色相关
  | 'event'        // 事件
  | 'hint'         // 暗示

/**
 * 伏笔重要性
 */
export type ForeshadowImportance = 'major' | 'minor' | 'subtle'

/**
 * 伏笔状态
 */
export type ForeshadowStatus =
  | 'planted'      // 已埋设
  | 'partial'      // 部分回收
  | 'resolved'     // 已回收
  | 'abandoned'    // 已废弃

/**
 * 伏笔
 */
export interface Foreshadow {
  id: string
  bookId: string
  title: string
  type: ForeshadowType
  importance: ForeshadowImportance
  status: ForeshadowStatus
  plantedChapter: number
  plantedChapterId: string
  plantedText: string         // 埋设伏笔的原文
  expectedResolve?: string    // 预期回收点描述
  relatedCharacters: string[] // 相关角色ID
  resolutionChapters: number[]// 回收章节序号
  resolutionNotes?: string    // 回收说明
  source: 'manual' | 'ai_detected'
  confidence?: number         // AI识别的置信度
  createdAt: string
  updatedAt: string
}
```

### 5.6 AI相关类型 (`src/types/ai.ts`)

```typescript
/**
 * AI提供商
 */
export type AIProvider =
  | 'openai'
  | 'claude'
  | 'qianwen'      // 通义千问
  | 'wenxin'       // 文心一言
  | 'zhipu'        // 智谱
  | 'ollama'       // 本地Ollama
  | 'custom'       // 自定义API

/**
 * AI配置
 */
export interface AIConfig {
  id: string
  name: string                // 配置名称（如：GPT-4创作）
  provider: AIProvider
  apiKey: string              // 加密存储
  baseUrl?: string            // API地址（支持代理）
  model: string               // 模型名称
  maxTokens: number
  temperature: number
  topP: number
  isDefault: boolean
  usageTask: AIUsageTask[]    // 用于哪些任务
  createdAt: string
  updatedAt: string
}

/**
 * AI使用任务类型
 */
export type AIUsageTask =
  | 'generate'      // 内容生成
  | 'review'        // 逻辑审查
  | 'summary'       // 摘要生成
  | 'chat'          // 对话
  | 'all'           // 全部

/**
 * AI生成选项
 */
export interface GenerateOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  topP?: number
  stopSequences?: string[]
}

/**
 * AI生成结果
 */
export interface GenerateResult {
  content: string
  tokensUsed: {
    prompt: number
    completion: number
    total: number
  }
  finishReason: 'stop' | 'length' | 'error'
  model: string
  duration: number            // 耗时（毫秒）
}

/**
 * AI适配器接口
 */
export interface AIAdapter {
  name: string
  provider: AIProvider

  /**
   * 生成内容
   */
  generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult>

  /**
   * 流式生成
   */
  generateStream(
    prompt: string,
    options?: GenerateOptions,
    onChunk?: (chunk: string) => void
  ): Promise<GenerateResult>

  /**
   * 测试连接
   */
  testConnection(): Promise<boolean>

  /**
   * 获取可用模型列表
   */
  listModels(): Promise<string[]>
}

/**
 * Token使用记录
 */
export interface TokenUsageRecord {
  id: string
  bookId?: string
  configId: string
  task: AIUsageTask
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost: number       // 估算费用（元）
  timestamp: string
}
```

### 5.7 审查相关类型 (`src/types/review.ts`)

```typescript
/**
 * 审查问题级别
 */
export type ReviewLevel =
  | 'error'        // Level A：确定性错误
  | 'warning'      // Level B：高可信警告
  | 'suggestion'   // Level C：建议
  | 'info'         // Level D：提示

/**
 * 审查问题类型
 */
export type ReviewIssueType =
  // Level A
  | 'character_death_conflict'    // 角色生死冲突
  | 'name_inconsistency'          // 称呼不一致
  | 'timeline_conflict'           // 时间线冲突
  | 'power_level_conflict'        // 实力等级冲突
  | 'location_conflict'           // 地理位置冲突
  // Level B
  | 'personality_deviation'       // 性格偏离
  | 'ability_exceeded'            // 能力超限
  | 'setting_conflict'            // 设定冲突
  | 'item_anomaly'                // 物品异常
  // Level C
  | 'causality_doubt'             // 因果关系存疑
  | 'pacing_issue'                // 节奏问题
  | 'emotion_abrupt'              // 情感突兀
  | 'foreshadow_forgotten'        // 伏笔遗忘
  // Level D
  | 'viewpoint_drift'             // 视角漂移
  | 'style_inconsistency'         // 文风不一致

/**
 * 审查问题
 */
export interface ReviewIssue {
  id: string
  bookId: string
  chapterId: string
  chapterOrder: number
  level: ReviewLevel
  type: ReviewIssueType
  title: string
  description: string
  location: {
    paragraph: number
    startOffset?: number
    endOffset?: number
    originalText?: string
  }
  suggestion?: string         // 修改建议
  reference?: {               // 参考信息
    chapterId?: string
    chapterOrder?: number
    text?: string
  }
  confidence?: number         // 置信度（AI检测时）
  status: 'open' | 'fixed' | 'ignored'
  createdAt: string
  updatedAt: string
}

/**
 * 审查报告
 */
export interface ReviewReport {
  id: string
  bookId: string
  chapterIds: string[]        // 审查的章节
  totalIssues: number
  issuesByLevel: {
    error: number
    warning: number
    suggestion: number
    info: number
  }
  issues: ReviewIssue[]
  createdAt: string
}
```

### 5.8 通用类型 (`src/types/common.ts`)

```typescript
/**
 * 分页参数
 */
export interface PaginationParams {
  page: number
  pageSize: number
}

/**
 * 分页结果
 */
export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * 操作结果
 */
export interface Result<T = void> {
  success: boolean
  data?: T
  error?: string
}

/**
 * 树形节点
 */
export interface TreeNode<T = unknown> {
  id: string
  label: string
  data?: T
  children?: TreeNode<T>[]
}

/**
 * 排序参数
 */
export interface SortParams {
  field: string
  order: 'asc' | 'desc'
}

/**
 * 时间范围
 */
export interface TimeRange {
  start: string
  end: string
}
```

---

## 六、数据库设计

### 6.1 完整建表语句

```sql
-- =============================================
-- NovelAI Studio 数据库表结构
-- 数据库：MySQL 8.0+
-- 字符集：utf8mb4
-- =============================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS novel_ai_studio
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE novel_ai_studio;

-- 书籍表
CREATE TABLE IF NOT EXISTS books (
    id VARCHAR(36) PRIMARY KEY COMMENT '书籍ID(UUID)',
    title VARCHAR(200) NOT NULL COMMENT '书名',
    author VARCHAR(100) DEFAULT '' COMMENT '作者',
    genre VARCHAR(50) NOT NULL COMMENT '类型：xuanhuan/dushi/kehuan等',
    style VARCHAR(50) NOT NULL COMMENT '风格：qingsong/yansu/rexue等',
    description TEXT COMMENT '简介',
    cover_image VARCHAR(500) COMMENT '封面图片路径',
    status VARCHAR(20) DEFAULT 'writing' COMMENT '状态：writing/paused/completed',
    word_count INT UNSIGNED DEFAULT 0 COMMENT '总字数（不含标点）',
    chapter_count INT UNSIGNED DEFAULT 0 COMMENT '章节数',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_status (status),
    INDEX idx_genre (genre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='书籍表';

-- 卷表
CREATE TABLE IF NOT EXISTS volumes (
    id VARCHAR(36) PRIMARY KEY COMMENT '卷ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    title VARCHAR(200) NOT NULL COMMENT '卷名',
    order_num INT NOT NULL COMMENT '排序序号',
    word_count INT UNSIGNED DEFAULT 0 COMMENT '字数',
    chapter_count INT UNSIGNED DEFAULT 0 COMMENT '章节数',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_order (book_id, order_num),
    CONSTRAINT fk_volumes_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='卷表';

-- 章节表
CREATE TABLE IF NOT EXISTS chapters (
    id VARCHAR(36) PRIMARY KEY COMMENT '章节ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    volume_id VARCHAR(36) COMMENT '所属卷ID',
    title VARCHAR(200) NOT NULL COMMENT '章节标题',
    content LONGTEXT COMMENT '章节正文',
    outline TEXT COMMENT '章节大纲',
    summary TEXT COMMENT 'AI生成的摘要',
    word_count INT UNSIGNED DEFAULT 0 COMMENT '字数（不含标点）',
    order_num INT NOT NULL COMMENT '排序序号',
    status VARCHAR(20) DEFAULT 'draft' COMMENT '状态：draft/completed/reviewing',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_book_order (book_id, order_num),
    INDEX idx_volume_id (volume_id),
    CONSTRAINT fk_chapters_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    CONSTRAINT fk_chapters_volume FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='章节表';

-- 章节版本历史表
CREATE TABLE IF NOT EXISTS chapter_versions (
    id VARCHAR(36) PRIMARY KEY COMMENT '版本ID(UUID)',
    chapter_id VARCHAR(36) NOT NULL COMMENT '章节ID',
    content LONGTEXT NOT NULL COMMENT '版本内容',
    word_count INT UNSIGNED DEFAULT 0 COMMENT '字数',
    version_num INT NOT NULL COMMENT '版本号',
    source VARCHAR(20) DEFAULT 'manual' COMMENT '来源：manual/ai_generated',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_chapter_id (chapter_id),
    INDEX idx_chapter_version (chapter_id, version_num),
    CONSTRAINT fk_versions_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='章节版本历史表';

-- 角色表
CREATE TABLE IF NOT EXISTS characters (
    id VARCHAR(36) PRIMARY KEY COMMENT '角色ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    name VARCHAR(100) NOT NULL COMMENT '角色名',
    aliases JSON COMMENT '别名列表',
    type VARCHAR(20) NOT NULL COMMENT '类型：protagonist/supporting/antagonist/other',
    profile JSON COMMENT '角色档案',
    state JSON COMMENT '角色状态',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_name (book_id, name),
    CONSTRAINT fk_characters_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色表';

-- 设定表
CREATE TABLE IF NOT EXISTS world_settings (
    id VARCHAR(36) PRIMARY KEY COMMENT '设定ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    category VARCHAR(50) NOT NULL COMMENT '分类：power_system/item/location/organization/other',
    name VARCHAR(200) NOT NULL COMMENT '设定名称',
    content TEXT COMMENT '设定内容',
    tags JSON COMMENT '标签列表',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_category (book_id, category),
    CONSTRAINT fk_settings_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='世界观设定表';

-- 大纲表
CREATE TABLE IF NOT EXISTS outlines (
    id VARCHAR(36) PRIMARY KEY COMMENT '大纲ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    type VARCHAR(20) NOT NULL COMMENT '类型：book/volume/chapter',
    reference_id VARCHAR(36) COMMENT '关联的卷ID或章节ID',
    content TEXT COMMENT '大纲内容',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_type (book_id, type),
    CONSTRAINT fk_outlines_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='大纲表';

-- 伏笔表
CREATE TABLE IF NOT EXISTS foreshadows (
    id VARCHAR(36) PRIMARY KEY COMMENT '伏笔ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    title VARCHAR(200) NOT NULL COMMENT '伏笔标题',
    type VARCHAR(20) NOT NULL COMMENT '类型：prophecy/item/character/event/hint',
    importance VARCHAR(20) DEFAULT 'minor' COMMENT '重要性：major/minor/subtle',
    status VARCHAR(20) DEFAULT 'planted' COMMENT '状态：planted/partial/resolved/abandoned',
    planted_chapter INT NOT NULL COMMENT '埋设章节序号',
    planted_chapter_id VARCHAR(36) NOT NULL COMMENT '埋设章节ID',
    planted_text TEXT COMMENT '埋设原文',
    expected_resolve VARCHAR(500) COMMENT '预期回收点',
    related_characters JSON COMMENT '相关角色ID列表',
    resolution_chapters JSON COMMENT '回收章节序号列表',
    resolution_notes TEXT COMMENT '回收说明',
    source VARCHAR(20) DEFAULT 'manual' COMMENT '来源：manual/ai_detected',
    confidence DECIMAL(5,4) COMMENT 'AI识别置信度',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_status (book_id, status),
    INDEX idx_importance (book_id, importance),
    CONSTRAINT fk_foreshadows_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='伏笔表';

-- 章节摘要表（短期记忆）
CREATE TABLE IF NOT EXISTS chapter_summaries (
    id VARCHAR(36) PRIMARY KEY COMMENT '摘要ID(UUID)',
    chapter_id VARCHAR(36) NOT NULL UNIQUE COMMENT '章节ID',
    chapter_order INT NOT NULL COMMENT '章节序号',
    summary TEXT NOT NULL COMMENT '摘要内容',
    key_events JSON COMMENT '关键事件列表',
    characters_appeared JSON COMMENT '出场角色ID列表',
    emotional_tone VARCHAR(50) COMMENT '情感基调',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_chapter_order (chapter_order),
    CONSTRAINT fk_summaries_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='章节摘要表';

-- 故事事件表（长期记忆）
CREATE TABLE IF NOT EXISTS story_events (
    id VARCHAR(36) PRIMARY KEY COMMENT '事件ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    chapter_id VARCHAR(36) NOT NULL COMMENT '所属章节ID',
    chapter_order INT NOT NULL COMMENT '章节序号',
    title VARCHAR(200) NOT NULL COMMENT '事件标题',
    description TEXT COMMENT '事件描述',
    event_type VARCHAR(20) DEFAULT 'minor' COMMENT '事件类型：major/minor/background',
    involved_characters JSON COMMENT '涉及角色ID列表',
    location VARCHAR(200) COMMENT '发生地点',
    timeline_order INT COMMENT '故事内时间顺序',
    impact TEXT COMMENT '事件影响',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_chapter_id (chapter_id),
    INDEX idx_timeline (book_id, timeline_order),
    CONSTRAINT fk_events_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='故事事件表';

-- 角色状态变更记录表
CREATE TABLE IF NOT EXISTS character_state_changes (
    id VARCHAR(36) PRIMARY KEY COMMENT '记录ID(UUID)',
    character_id VARCHAR(36) NOT NULL COMMENT '角色ID',
    chapter_id VARCHAR(36) NOT NULL COMMENT '章节ID',
    chapter_order INT NOT NULL COMMENT '章节序号',
    field VARCHAR(50) NOT NULL COMMENT '变更字段',
    old_value TEXT COMMENT '旧值',
    new_value TEXT COMMENT '新值',
    reason VARCHAR(500) COMMENT '变更原因',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_character_id (character_id),
    INDEX idx_chapter_order (character_id, chapter_order),
    CONSTRAINT fk_state_changes_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色状态变更记录表';

-- 知识库分类表
CREATE TABLE IF NOT EXISTS knowledge_categories (
    id VARCHAR(36) PRIMARY KEY COMMENT '分类ID(UUID)',
    book_id VARCHAR(36) COMMENT '所属书籍ID，NULL表示全局',
    name VARCHAR(100) NOT NULL COMMENT '分类名称',
    parent_id VARCHAR(36) COMMENT '父分类ID',
    order_num INT DEFAULT 0 COMMENT '排序序号',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_parent_id (parent_id),
    CONSTRAINT fk_categories_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库分类表';

-- 知识库文件表
CREATE TABLE IF NOT EXISTS knowledge_files (
    id VARCHAR(36) PRIMARY KEY COMMENT '文件ID(UUID)',
    book_id VARCHAR(36) COMMENT '所属书籍ID，NULL表示全局',
    category_id VARCHAR(36) COMMENT '所属分类ID',
    filename VARCHAR(255) NOT NULL COMMENT '存储文件名',
    original_name VARCHAR(255) NOT NULL COMMENT '原始文件名',
    file_type VARCHAR(20) NOT NULL COMMENT '文件类型：txt/pdf/docx/epub/md',
    file_size BIGINT UNSIGNED NOT NULL COMMENT '文件大小(字节)',
    file_path VARCHAR(500) NOT NULL COMMENT '文件存储路径',
    is_indexed TINYINT(1) DEFAULT 0 COMMENT '是否已向量化',
    chunk_count INT UNSIGNED DEFAULT 0 COMMENT '分块数量',
    tags JSON COMMENT '标签列表',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_category_id (category_id),
    INDEX idx_indexed (is_indexed),
    CONSTRAINT fk_files_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    CONSTRAINT fk_files_category FOREIGN KEY (category_id) REFERENCES knowledge_categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库文件表';

-- AI配置表
CREATE TABLE IF NOT EXISTS ai_configs (
    id VARCHAR(36) PRIMARY KEY COMMENT '配置ID(UUID)',
    name VARCHAR(100) NOT NULL COMMENT '配置名称',
    provider VARCHAR(50) NOT NULL COMMENT '提供商：openai/claude/qianwen/ollama等',
    api_key VARCHAR(500) NOT NULL COMMENT 'API密钥（加密存储）',
    base_url VARCHAR(500) COMMENT 'API地址',
    model VARCHAR(100) NOT NULL COMMENT '模型名称',
    max_tokens INT UNSIGNED DEFAULT 4096 COMMENT '最大Token数',
    temperature DECIMAL(3,2) DEFAULT 0.70 COMMENT '温度参数',
    top_p DECIMAL(3,2) DEFAULT 1.00 COMMENT 'Top-P参数',
    is_default TINYINT(1) DEFAULT 0 COMMENT '是否默认配置',
    usage_tasks JSON DEFAULT ('["all"]') COMMENT '适用任务列表',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_provider (provider),
    INDEX idx_default (is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI配置表';

-- Token使用记录表
CREATE TABLE IF NOT EXISTS token_usage (
    id VARCHAR(36) PRIMARY KEY COMMENT '记录ID(UUID)',
    book_id VARCHAR(36) COMMENT '关联书籍ID',
    config_id VARCHAR(36) NOT NULL COMMENT 'AI配置ID',
    task VARCHAR(50) NOT NULL COMMENT '任务类型：generate/review/summary/chat',
    prompt_tokens INT UNSIGNED NOT NULL COMMENT '提示Token数',
    completion_tokens INT UNSIGNED NOT NULL COMMENT '完成Token数',
    total_tokens INT UNSIGNED NOT NULL COMMENT '总Token数',
    estimated_cost DECIMAL(10,4) DEFAULT 0 COMMENT '估算费用(元)',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_config_id (config_id),
    INDEX idx_created_at (created_at),
    INDEX idx_task (task),
    CONSTRAINT fk_usage_config FOREIGN KEY (config_id) REFERENCES ai_configs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Token使用记录表';

-- 审查问题表
CREATE TABLE IF NOT EXISTS review_issues (
    id VARCHAR(36) PRIMARY KEY COMMENT '问题ID(UUID)',
    book_id VARCHAR(36) NOT NULL COMMENT '所属书籍ID',
    chapter_id VARCHAR(36) NOT NULL COMMENT '所属章节ID',
    chapter_order INT NOT NULL COMMENT '章节序号',
    level VARCHAR(20) NOT NULL COMMENT '级别：error/warning/suggestion/info',
    type VARCHAR(50) NOT NULL COMMENT '问题类型',
    title VARCHAR(200) NOT NULL COMMENT '问题标题',
    description TEXT COMMENT '问题描述',
    location JSON COMMENT '位置信息',
    suggestion TEXT COMMENT '修改建议',
    reference JSON COMMENT '参考信息',
    confidence DECIMAL(5,4) COMMENT '置信度',
    status VARCHAR(20) DEFAULT 'open' COMMENT '状态：open/fixed/ignored',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_book_id (book_id),
    INDEX idx_chapter_id (chapter_id),
    INDEX idx_level (level),
    INDEX idx_status (status),
    CONSTRAINT fk_issues_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审查问题表';

-- 敏感词库表
CREATE TABLE IF NOT EXISTS sensitive_words (
    id VARCHAR(36) PRIMARY KEY COMMENT '词条ID(UUID)',
    word VARCHAR(100) NOT NULL COMMENT '敏感词',
    category VARCHAR(50) NOT NULL COMMENT '分类：politics/violence/pornography/other',
    level VARCHAR(20) DEFAULT 'warning' COMMENT '级别：warning/forbidden',
    replacement VARCHAR(100) COMMENT '替换词',
    is_builtin TINYINT(1) DEFAULT 0 COMMENT '是否内置',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE INDEX idx_word (word),
    INDEX idx_category (category),
    INDEX idx_level (level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='敏感词库表';

-- 用户设置表
CREATE TABLE IF NOT EXISTS user_settings (
    setting_key VARCHAR(100) PRIMARY KEY COMMENT '设置键',
    setting_value TEXT NOT NULL COMMENT '设置值',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户设置表';

-- =============================================
-- 初始数据
-- =============================================

-- 插入默认AI配置示例（需要用户自行填写API Key）
INSERT INTO ai_configs (id, name, provider, api_key, base_url, model, max_tokens, temperature, is_default, usage_tasks)
VALUES
    (UUID(), 'OpenAI GPT-4', 'openai', '', 'https://api.openai.com/v1', 'gpt-4', 4096, 0.7, 1, '["all"]'),
    (UUID(), 'Claude 3', 'claude', '', 'https://api.anthropic.com', 'claude-3-sonnet-20240229', 4096, 0.7, 0, '["all"]');
```

### 6.2 数据库配置（application.yml）

```yaml
spring:
  datasource:
    driver-class-name: com.mysql.cj.jdbc.Driver
    url: jdbc:mysql://localhost:3306/novel_ai_studio?useUnicode=true&characterEncoding=utf8mb4&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true
    username: root
    password: your_password
    type: com.alibaba.druid.pool.DruidDataSource
    # Druid连接池配置
    druid:
      initial-size: 5
      min-idle: 5
      max-active: 20
      max-wait: 60000
      time-between-eviction-runs-millis: 60000
      min-evictable-idle-time-millis: 300000

mybatis-plus:
  mapper-locations: classpath:mapper/**/*.xml
  type-aliases-package: com.novelai.studio.entity
  configuration:
    map-underscore-to-camel-case: true
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl
  global-config:
    db-config:
      id-type: assign_uuid
      logic-delete-field: deleted
      logic-delete-value: 1
      logic-not-delete-value: 0
```

---

## 七、任务清单

### 阶段一：基础架构（P0）✅ 已完成

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| 1.1 | 前端项目框架初始化（Electron+Vue） | ✅ | - |
| 1.2 | 字数统计工具 | ✅ | 1.1 |
| 1.3 | 主界面布局 | ✅ | 1.1 |
| 1.4 | 文件系统封装 | ✅ | 1.1 |
| 1.5 | Java后端项目初始化（Spring Boot） | ✅ | - |
| 1.6 | MySQL数据库初始化 | ✅ | 1.5 |
| 1.7 | MyBatis-Plus配置 | ✅ | 1.6 |
| 1.8 | 前后端通信接口设计 | ✅ | 1.1, 1.5 |

**完成日期**：2026-01-07
**额外完成**：
- 书籍/章节 CRUD API 前后端连接
- 暗色主题支持
- MySQL 配置为 Windows 服务
- 新建书籍/章节功能

### 阶段二：核心MVP（P1）✅ 已完成

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| 2.1 | 书籍CRUD服务（Java后端） | ✅ | 1.7 |
| 2.2 | 书籍CRUD前端服务 | ✅ | 2.1 |
| 2.3 | 书籍列表UI | ✅ | 1.3, 2.2 |
| 2.4 | 章节管理服务（Java后端） | ✅ | 2.1 |
| 2.5 | 章节管理前端服务 | ✅ | 2.4 |
| 2.6 | 章节树组件 | ✅ | 2.5 |
| 2.7 | 正文编辑器 | ✅ | 2.6 |
| 2.8 | AI适配器基类（Java） | ✅ | 1.5 |
| 2.9 | OpenAI适配器（Java） | ✅ | 2.8 |
| 2.10 | AI配置界面 | ✅ | 2.9 |
| 2.11 | 基础生成功能 | ✅ | 2.7, 2.9 |
| 2.12 | 大纲系统 | ✅ | 2.5 |

**完成日期**：2026-01-12
**完成内容**：
- AI适配器基类和OpenAI适配器（支持流式生成）
- AI配置管理（后端Controller/Service，前端Store和界面）
- AI续写功能（编辑器工具栏一键续写）
- 大纲系统（全书大纲和章节大纲管理）
- 编辑器增强（专注模式、全屏模式）
- 大纲AI生成功能

### 阶段三：世界观与知识库（P1.5）

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| 3.1 | 角色管理服务（Java后端） | ⬜ | 2.1 |
| 3.2 | 角色管理前端服务 | ⬜ | 3.1 |
| 3.3 | 角色管理UI | ⬜ | 3.2 |
| 3.4 | 角色关系图 | ⬜ | 3.3 |
| 3.5 | 设定百科服务（Java后端） | ⬜ | 2.1 |
| 3.6 | 设定百科UI | ⬜ | 3.5 |
| 3.7 | 知识库文件上传（Java后端） | ⬜ | 1.5, 1.7 |
| 3.8 | 向量数据库集成（Java） | ⬜ | 1.6 |
| 3.9 | 文件向量化服务（Java） | ⬜ | 3.7, 3.8 |
| 3.10 | 知识库检索服务 | ⬜ | 3.9 |
| 3.11 | 知识库UI | ⬜ | 3.10 |
| 3.12 | AI生成增强 | ⬜ | 2.11, 3.3, 3.6, 3.10 |

### 阶段四：记忆系统（P2）

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| 4.1 | L1即时记忆 | ⬜ | 2.7 |
| 4.2 | L2章节摘要生成（Java） | ⬜ | 2.11 |
| 4.3 | 摘要管理UI | ⬜ | 4.2 |
| 4.4 | L3事件时间线（Java） | ⬜ | 4.2 |
| 4.5 | L3角色状态追踪（Java） | ⬜ | 3.1, 4.2 |
| 4.6 | 伏笔手动标记 | ⬜ | 2.7 |
| 4.7 | 伏笔管理UI | ⬜ | 4.6 |
| 4.8 | 伏笔提醒功能 | ⬜ | 4.7 |
| 4.9 | 记忆检索整合 | ⬜ | 4.1-4.8 |

### 阶段五：逻辑审查（P2.5）

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| 5.1 | 规则引擎框架（Java） | ⬜ | 1.6 |
| 5.2 | Level A规则实现（Java） | ⬜ | 5.1, 4.5 |
| 5.3 | 审查报告UI | ⬜ | 5.2 |
| 5.4 | Level B AI审查（Java） | ⬜ | 5.1, 2.9 |
| 5.5 | Level C建议审查（Java） | ⬜ | 5.4 |
| 5.6 | 实时审查提醒 | ⬜ | 5.2 |

### 阶段六：AI对话与多模型（P3）

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| 6.1 | AI对话界面 | ⬜ | 2.9 |
| 6.2 | 对话上下文注入 | ⬜ | 6.1, 4.9 |
| 6.3 | Claude适配器（Java） | ⬜ | 2.8 |
| 6.4 | 国产模型适配器（Java） | ⬜ | 2.8 |
| 6.5 | Ollama适配器（Java） | ⬜ | 2.8 |
| 6.6 | 多AI任务分配 | ⬜ | 6.3-6.5 |

### 阶段七：导出与发布（P3）

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| 7.1 | TXT导出（Java） | ⬜ | 2.4 |
| 7.2 | DOCX导出（Java） | ⬜ | 2.4 |
| 7.3 | EPUB导出（Java） | ⬜ | 2.4 |
| 7.4 | 敏感词库管理（Java） | ⬜ | 1.7 |
| 7.5 | 敏感词检测（Java） | ⬜ | 7.4 |
| 7.6 | 平台适配-起点 | ⬜ | 7.1, 1.2 |
| 7.7 | 智能分章（Java） | ⬜ | 7.6 |
| 7.8 | 定时发布计划 | ⬜ | 7.1-7.3 |
| 7.9 | 导出向导UI | ⬜ | 7.1-7.8 |

### 阶段八：成本控制（P3.5）

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| 8.1 | Token统计服务（Java） | ⬜ | 2.9 |
| 8.2 | 费用计算（Java） | ⬜ | 8.1 |
| 8.3 | 统计界面 | ⬜ | 8.2 |
| 8.4 | 预算设置 | ⬜ | 8.2 |
| 8.5 | 智能降级（Java） | ⬜ | 8.4, 6.6 |

### 阶段九：Prompt模板（P3.5）

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| 9.1 | 模板数据结构 | ⬜ | 1.7 |
| 9.2 | 可视化编辑器 | ⬜ | 9.1 |
| 9.3 | 内置模板库 | ⬜ | 9.1 |
| 9.4 | 模板导入导出 | ⬜ | 9.1 |

### 阶段十：性能优化（P4）

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| 10.1 | 增量索引（Java） | ⬜ | 3.9 |
| 10.2 | 多级缓存（Java+前端） | ⬜ | 1.1, 1.6 |
| 10.3 | 分批处理（Java） | ⬜ | 5.3, 7.9 |
| 10.4 | 数据库优化 | ⬜ | 1.7 |

---

## 八、多AI协作指南

### 8.1 切换AI前的准备

1. **保存当前工作**：确保所有文件已保存
2. **记录进度**：更新任务清单中的状态
3. **描述当前状态**：记录当前任务进行到哪一步

### 8.2 交接信息模板

切换AI时，复制以下模板并填写后发送给新AI：

```markdown
# NovelAI Studio 开发交接

## 项目位置
E:\Cousor_work\novel-ai-studio

## 项目说明
请先阅读 DEVELOPMENT.md 了解项目规范。

## 当前进度
- 已完成任务：[列出ID，如 1.1, 1.2, 1.3]
- 当前任务：[任务ID和名称]
- 下一个任务：[任务ID和名称]

## 当前任务详情
任务 [ID] 进行中，已完成部分：
- [x] 已完成的子项
- [ ] 未完成的子项（从这里继续）

## 遇到的问题（如有）
[描述问题和可能的解决方向]

## 请继续
请继续完成任务 [ID]，从 [具体位置] 开始。
```

### 8.3 代码提交规范

每完成一个任务，建议提交代码并写清晰的commit信息：

```bash
# 提交格式
git commit -m "[任务ID] 任务名称

- 完成的具体内容1
- 完成的具体内容2"

# 示例
git commit -m "[1.2] 字数统计工具

- 实现countWords函数，排除标点符号
- 实现countWordsDetailed函数，返回详细统计
- 添加单元测试"
```

### 8.4 文件修改记录

每次开发完成后，记录修改的文件列表：

```markdown
## 本次修改的文件

### 新增文件
- src/utils/wordCount.ts
- tests/unit/wordCount.test.ts

### 修改文件
- src/main.ts（添加了xxx）

### 删除文件
- 无
```

---

## 九、常见问题

### Q1: 如何判断任务是否完成？

每个任务都有明确的验收标准，完成所有验收项即为完成。

### Q2: 遇到依赖任务未完成怎么办？

按照任务ID顺序开发，确保依赖任务先完成。如果需要跳过，在交接时说明。

### Q3: 代码风格与规范不一致怎么办？

以本文档为准，如有冲突，优先遵守本文档的规范。

### Q4: 需要添加新功能怎么办？

1. 先完成已规划的任务
2. 新功能添加到任务清单末尾
3. 在交接时说明新增内容

---

## 十、版本历史

| 版本 | 日期 | 修改内容 |
|------|------|----------|
| 1.0 | 2024-01-XX | 初始版本 |

---

**文档维护**：每完成一个阶段后更新任务状态