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
| Axios | ^1.6.0 | HTTP客户端 |
| ECharts | ^5.4.0 | 图表库（角色关系图） |

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
│   │   │   ├── VersionHistory.vue
│   │   │   ├── EditorHeader.vue      # 顶部工具栏（含主题切换）
│   │   │   ├── EditorSidebar.vue     # 左侧故事结构面板
│   │   │   ├── EditorMain.vue        # 中间主编辑区
│   │   │   ├── EditorRightPanel.vue  # 右侧面板容器
│   │   │   ├── AIThinkingProcess.vue # AI思考过程实时显示
│   │   │   ├── CharacterPanel.vue    # 角色面板
│   │   │   └── KnowledgePanel.vue    # 知识库/视觉素材面板
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
- **编辑器UI重构**（2026-01-14完成）：
  - 三栏布局：左侧目录 | 中间编辑器 | 右侧功能面板
  - 主题切换：方案B(浅色Notion风格) ↔ 方案A(深色VS Code风格)
  - AI思考过程实时显示组件
  - 知识库面板（支持视觉素材管理和AI识别标签）
  - 角色面板
  - 专注模式优化

### 阶段三：世界观与知识库（P1.5）✅ 已完成

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| 3.1 | 角色管理服务（Java后端） | ✅ | 2.1 |
| 3.2 | 角色管理前端服务 | ✅ | 3.1 |
| 3.3 | 角色管理UI | ✅ | 3.2 |
| 3.4 | 角色关系图 | ✅ | 3.3 |
| 3.5 | 设定百科服务（Java后端） | ✅ | 2.1 |
| 3.6 | 设定百科UI | ✅ | 3.5 |
| 3.7 | 知识库文件上传（Java后端） | ✅ | 1.5, 1.7 |
| 3.8 | 向量数据库集成（Java） | ✅ | 1.6 |
| 3.9 | 文件向量化服务（Java） | ✅ | 3.7, 3.8 |
| 3.10 | 知识库检索服务 | ✅ | 3.9 |
| 3.11 | 知识库UI | ✅ | 3.10 |
| 3.12 | AI生成增强 | ✅ | 2.11, 3.3, 3.6, 3.10 |

**完成日期**：2026-01-16
**完成内容**：
- 角色管理系统（后端CRUD + 前端UI + 关系图谱可视化）
- 设定百科系统（世界观设定管理 + 分类管理）
- 知识库系统（文件上传 + 向量化 + 语义检索）
- AI上下文增强（自动注入角色/设定/知识库信息到AI生成）

### 阶段四：记忆系统（P2）✅ 已完成

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| 4.1 | L1即时记忆 | ✅ | 2.7 |
| 4.2 | L2章节摘要生成（Java） | ✅ | 2.11 |
| 4.3 | 摘要管理UI | ✅ | 4.2 |
| 4.4 | L3事件时间线（Java） | ✅ | 4.2 |
| 4.5 | L3角色状态追踪（Java） | ✅ | 3.1, 4.2 |
| 4.6 | 伏笔手动标记 | ✅ | 2.7 |
| 4.7 | 伏笔管理UI | ✅ | 4.6 |
| 4.8 | 伏笔提醒功能 | ✅ | 4.7 |
| 4.9 | 记忆检索整合 | ✅ | 4.1-4.8 |

**完成日期**：2026-01-16
**完成内容**：
- 数据库迁移：`chapter_summaries`、`story_events`、`character_state_changes`表
- 后端实体类：ChapterSummary、StoryEvent、CharacterStateChange、Foreshadow
- 后端Mapper：ChapterSummaryMapper、StoryEventMapper、CharacterStateChangeMapper、ForeshadowMapper
- 后端服务层：ChapterSummaryService（AI摘要生成）、StoryEventService（AI事件提取）、CharacterStateChangeService、ForeshadowService
- 后端控制器：ChapterSummaryController、StoryEventController、CharacterStateController、ForeshadowController
- 前端API服务：memoryApi.ts
- 前端类型定义：memory.ts扩展
- 前端Store：memoryStore.ts
- 前端UI组件：SummaryPanel、TimelinePanel、ForeshadowPanel
- 编辑器右侧面板：新增"记忆"标签页，包含伏笔/事件/摘要子面板
- AI上下文增强：整合所有记忆层级到AI生成上下文（buildFullMemoryContext、buildChapterGenerationContext、buildContinueContext）

### 阶段五：逻辑审查（P2.5）✅ 已完成

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| 5.1 | 规则引擎框架（Java） | ✅ | 1.6 |
| 5.2 | Level A规则实现（Java） | ✅ | 5.1, 4.5 |
| 5.3 | 审查报告UI | ✅ | 5.2 |
| 5.4 | Level B AI审查（Java） | ✅ | 5.1, 2.9 |
| 5.5 | Level C建议审查（Java） | ✅ | 5.4 |
| 5.6 | 实时审查提醒 | ✅ | 5.2 |

**阶段五完成说明：**

**后端架构（Java）：**
```
java-backend/src/main/java/com/novelai/studio/
├── entity/
│   └── ReviewIssue.java                    # 审查问题实体
├── mapper/
│   └── ReviewIssueMapper.java              # 审查问题Mapper
├── controller/
│   └── ReviewController.java               # 审查API控制器
└── service/review/
    ├── ReviewRule.java                     # 规则接口
    ├── ReviewContext.java                  # 规则上下文
    ├── ReviewLevel.java                    # 级别常量(error/warning/suggestion/info)
    ├── ReviewType.java                     # 类型常量(15种问题类型)
    ├── ReviewReport.java                   # 审查报告
    ├── RuleEngineService.java              # 规则引擎服务
    ├── RealtimeReviewService.java          # 实时审查服务
    └── rules/
        ├── AbstractReviewRule.java         # 规则基类
        ├── CharacterDeathConflictRule.java # Level A: 角色生死冲突
        ├── NameInconsistencyRule.java      # Level A: 称呼不一致
        ├── SettingConflictRule.java        # Level B: 设定冲突(AI辅助)
        ├── PersonalityDeviationRule.java   # Level B: 性格偏离(AI辅助)
        └── ForeshadowForgottenRule.java    # Level C: 伏笔遗忘检测
```

**前端架构（Vue）：**
```
src/
├── types/review.ts                         # 审查类型定义
├── services/api/reviewApi.ts               # 审查API服务
├── stores/reviewStore.ts                   # 审查状态管理
├── composables/useRealtimeReview.ts        # 实时审查Hook
├── views/ReviewView.vue                    # 审查报告页面
└── components/review/
    ├── ReviewPanel.vue                     # 审查面板组件
    ├── ReviewIssueItem.vue                 # 问题项组件
    └── ReviewNotification.vue              # 审查通知组件
```

**数据库：**
- `database/migrations/005_review_system.sql` - 审查系统表结构
- 表：`review_issues`（审查问题）、`review_history`（审查历史）

**API端点：**
- `GET /api/review/rules` - 获取所有规则
- `POST /api/review/chapter/{bookId}/{chapterId}` - 审查单章
- `POST /api/review/book/{bookId}` - 审查全书
- `POST /api/review/quick/{bookId}/{chapterId}` - 快速审查(仅错误)
- `GET /api/review/issues/book/{bookId}` - 获取书籍问题
- `GET /api/review/stats/{bookId}` - 获取统计信息
- `PUT /api/review/issues/{issueId}/status` - 更新问题状态
- `DELETE /api/review/issues/{issueId}` - 删除问题

**审查级别说明：**
- **Level A (error)**: 确定性错误 - 角色生死冲突、称呼不一致、时间线冲突、实力等级冲突、地理位置冲突
- **Level B (warning)**: AI高可信警告 - 性格偏离、能力超限、设定冲突、物品异常
- **Level C (suggestion)**: 建议 - 因果关系存疑、节奏问题、情感突兀、伏笔遗忘
- **Level D (info)**: 提示 - 视角漂移、文风不一致

### 阶段六：AI对话与多模型（P3）✅ 已完成

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| 6.1 | AI对话界面 | ✅ | 2.9 |
| 6.2 | 对话上下文注入 | ✅ | 6.1, 4.9 |
| 6.3 | Claude适配器（Java） | ✅ | 2.8 |
| 6.4 | 国产模型适配器（Java） | ✅ | 2.8 |
| 6.5 | Ollama适配器（Java） | ✅ | 2.8 |
| 6.6 | 多AI任务分配 | ✅ | 6.3-6.5 |

**完成日期**：2026-01-17
**完成内容**：
- Claude适配器（支持Claude 3.5 Sonnet等模型）
- Ollama本地模型适配器（支持Llama、Mistral、Qwen等）
- AI对话系统（会话管理、消息历史、流式响应）
- 对话上下文注入（自动注入书籍/角色/设定信息）
- 多AI任务分配服务（按任务类型分配不同AI）
- 数据库迁移脚本（chat_sessions、chat_messages、ai_task_assignments表）

**后端架构（Java）：**
```
java-backend/src/main/java/com/novelai/studio/
├── entity/
│   ├── ChatSession.java                    # 对话会话实体
│   ├── ChatMessage.java                    # 对话消息实体
│   └── AiTaskAssignment.java               # AI任务分配实体
├── mapper/
│   ├── ChatSessionMapper.java              # 会话Mapper
│   ├── ChatMessageMapper.java              # 消息Mapper
│   └── AiTaskAssignmentMapper.java         # 任务分配Mapper
├── controller/
│   └── AiChatController.java               # 对话API控制器
├── service/
│   ├── ChatHistoryService.java             # 对话历史服务
│   └── AiTaskDispatchService.java          # 任务分配服务
└── service/ai/adapter/
    ├── ClaudeAdapter.java                  # Claude适配器
    └── OllamaAdapter.java                  # Ollama适配器
```

**前端架构（Vue）：**
```
src/
├── types/chat.ts                           # 对话类型定义
├── services/api/chatApi.ts                 # 对话API服务
├── stores/chatStore.ts                     # 对话状态管理
└── components/ai/
    └── AiChat.vue                          # AI对话组件
```

**数据库：**
- `database/migrations/006_chat_system.sql` - 对话系统表结构
- 表：`chat_sessions`（对话会话）、`chat_messages`（对话消息）、`ai_task_assignments`（任务分配）

**API端点：**
- `POST /api/chat/sessions` - 创建会话
- `GET /api/chat/sessions` - 获取会话列表
- `GET /api/chat/sessions/{id}` - 获取会话详情
- `PUT /api/chat/sessions/{id}/title` - 更新会话标题
- `POST /api/chat/sessions/{id}/toggle-pin` - 切换置顶
- `DELETE /api/chat/sessions/{id}` - 删除会话
- `GET /api/chat/sessions/{id}/messages` - 获取消息
- `DELETE /api/chat/sessions/{id}/messages` - 清空消息
- `POST /api/chat/sessions/{id}/send` - 发送消息（非流式）
- `POST /api/chat/sessions/{id}/stream` - 发送消息（流式SSE）

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
| 1.1 | 2026-01-14 | 添加编辑器UI重构相关组件文档 |
| 1.2 | 2026-01-15 | AI辅助创建书籍向导、封面上传功能 |
| 1.3 | 2026-01-15 | 细纲系统实现（五步生成法） |
| 1.4 | 2026-01-15 | AI生成进度UI优化（步骤列表显示） |
| 1.5 | 2026-01-16 | 阶段三完成：角色管理、设定百科、知识库、AI上下文增强 |
| 1.6 | 2026-01-16 | 性能优化：AI上下文缓存机制、知识库检索相关度阈值过滤 |
| 1.7 | 2026-01-16 | 阶段四完成：记忆系统（L1-L3记忆层级、伏笔系统、AI上下文整合） |
| 1.8 | 2026-01-16 | 阶段五完成：逻辑审查系统（规则引擎、Level A-D审查、实时审查） |
| 1.9 | 2026-01-17 | 阶段六完成：AI对话系统、Claude/Ollama适配器、多AI任务分配 |
| 2.0 | 2026-01-18 | 大纲系统重构：三层大纲架构、分卷plotLine、记忆提取系统 |
| 2.1 | 2026-01-19 | 应用启动优化：自动加载AI配置，解决首次使用需进入设置的问题 |
| 2.2 | 2026-01-24 | 技术栈更新：添加Axios、ECharts依赖；文档完善：补充开发进度总结 |
| 2.3 | 2026-01-29 | UI重构：主题系统优化、AI对话窗口统一、编辑器布局调整 |

---

## 十一、最新开发进展

### 2026-01-15 新增功能

#### 1. AI辅助新建小说流程

**功能概述**：三步骤向导，使用AI生成小说简介、大纲和角色设定

**后端实现**：
- `POST /api/ai/initialize-novel` - AI初始化小说接口
- `POST /api/ai/refine-novel` - AI修改小说设定接口
- 位置：`java-backend/src/main/java/com/novelai/studio/controller/AiGenerateController.java`

**前端实现**：
- 新增类型：`NovelInitInput`、`NovelInitResult`、`GeneratedCharacter`、`NovelRefineInput`
- 位置：`src/types/book.ts`
- 新增API方法：`initializeNovel()`、`refineNovel()`
- 位置：`src/services/api/aiApi.ts`
- 新增组件：`CreateBookWizard.vue`
- 位置：`src/components/book/CreateBookWizard.vue`
- 集成到 `HomeView.vue`，通过下拉菜单选择"AI辅助创建"或"快速创建"

**使用流程**：
1. 步骤1 - 基本信息：输入书名、类型、风格、主角设定、世界观关键词、核心冲突
2. 步骤2 - AI生成：AI根据输入生成简介、大纲、角色，支持修改要求重新生成
3. 步骤3 - 预览确认：确认生成内容后创建书籍

#### 2. 书籍封面上传

**功能概述**：支持上传、预览、删除书籍封面图片

**后端实现**：
- 新增控制器：`FileController.java`
- 位置：`java-backend/src/main/java/com/novelai/studio/controller/FileController.java`
- API接口：
  - `POST /api/files/cover` - 上传封面
  - `GET /api/files/cover/{filename}` - 获取封面
  - `DELETE /api/files/cover/{filename}` - 删除封面
- 配置：`application.yml` 添加文件上传配置

**前端实现**：
- 新增API服务：`fileApi.ts`
- 位置：`src/services/api/fileApi.ts`
- 新增组件：`CoverUploader.vue`
- 位置：`src/components/book/CoverUploader.vue`
- 功能：点击/拖拽上传、图片预览、更换、删除
- 更新 `CreateBookInput` 类型，添加 `coverImage` 字段
- 集成到 `HomeView.vue` 的快速创建对话框

**文件存储**：
- 默认路径：`${user.home}/.novel-ai-studio/uploads/covers`
- 限制：仅支持图片文件，最大5MB

---

**文档维护**：每完成一个阶段后更新任务状态

### 2026-01-15 细纲系统

#### 3. 章节细纲五步生成系统

**功能概述**：实现章节细纲的五步生成法，支持查看已完成章节细纲、AI推演生成下一章细纲、确认修改后生成章节内容。

**细纲五步结构**：
1. **场景铺设** - 设定本章的场景环境、时间地点
2. **角色出场** - 本章出场的角色及其状态、情绪
3. **冲突展开** - 本章的核心冲突或矛盾
4. **高潮推进** - 情节如何推向高潮
5. **本章收尾** - 本章如何结尾，留下什么悬念

**类型定义扩展**：

`src/types/chapter.ts` 新增：
```typescript
// 细纲步骤类型
export type DetailOutlineStepType = 'scene' | 'characters' | 'conflict' | 'climax' | 'ending'

// 细纲步骤配置
export const DETAIL_OUTLINE_STEPS: {...}[]

// 细纲单步内容
export interface DetailOutlineStep {
  type: DetailOutlineStepType
  content: string
  completed: boolean
}

// 章节细纲
export interface ChapterDetailOutline {
  chapterId: string
  steps: DetailOutlineStep[]
  status: 'draft' | 'confirmed' | 'generated'
  generatedAt?: string
  confirmedAt?: string
}
```

`src/types/book.ts` 新增：
```typescript
// 分卷大纲章节
export interface VolumeOutlineChapter {
  id: string
  title: string
  chapterId?: string
}

// 分卷大纲
export interface VolumeOutline {
  id: string
  title: string
  summary?: string
  chapters: VolumeOutlineChapter[]
}

// Book 接口新增 volumes 字段
volumes?: VolumeOutline[]
```

**Store 扩展**：

`src/stores/chapterStore.ts` 新增：
- 状态：`detailOutlineLoading`、`detailOutlineError`、`selectedChapterForOutline`、`pendingDetailOutline`
- 计算属性：`completedChapters`、`nextChapterNumber`
- 方法：
  - `getChapterDetailOutline(chapterId)` - 获取章节细纲
  - `getChapterSummary(chapterId)` - 获取章节摘要
  - `selectChapterForOutline(chapterId)` - 选择要查看的章节
  - `createEmptyDetailOutline(chapterId)` - 创建空白细纲模板
  - `setPendingDetailOutline(outline)` - 设置待确认细纲
  - `confirmDetailOutline(chapterId)` - 确认细纲
  - `saveDetailOutlineToChapter(chapterId, outline)` - 保存细纲到章节
  - `getPreviousChaptersContext(beforeOrder)` - 获取前面章节上下文

**UI 实现**：

`src/components/editor/EditorSidebar.vue` 细纲面板重构：
- **模式切换**：查看已完成 / 生成下一章
- **查看模式**：
  - 已完成章节列表（可选择查看）
  - 选中章节显示摘要和五步细纲内容
  - 每步可折叠展开显示具体内容
- **生成模式**：
  - 显示下一章信息
  - "AI推演生成细纲"按钮
  - AI根据总大纲+分卷大纲+前面章节内容生成五步细纲
  - 生成后可"重新生成"、"修改"、"确认细纲"
  - 确认后显示"根据细纲生成章节"按钮
  - 生成章节后自动创建新章节并保存细纲

**使用流程**：
1. 点击"细纲"标签进入细纲面板
2. 选择"生成下一章"模式
3. 点击"AI推演生成细纲"
4. AI根据总大纲、分卷大纲、已完成章节内容生成五步细纲
5. 查看细纲内容，可点击"修改"进行编辑
6. 满意后点击"确认细纲"
7. 点击"根据细纲生成章节"生成完整章节内容
8. 章节生成后自动保存并切换到编辑器

#### 4. 章节生成字数控制优化

**问题背景**：AI生成章节时经常忽略字数限制，导致生成内容远超目标字数（如目标2000-4000字，实际生成7000+字）。

**解决方案**：采用分段生成策略，将章节拆分为4个部分分别生成，每部分严格控制token数量。

**实现细节**：

`src/components/editor/EditorSidebar.vue` 重构 `generateChapterContent` 函数：

```typescript
// 分段生成章节内容：每个部分单独生成，严格控制字数
async function generateChapterContent() {
  // 分配每个部分的字数（4个部分）
  const partDistribution = [
    { part: '开篇', ratio: 0.2 },   // 20% - 场景铺设
    { part: '发展', ratio: 0.3 },   // 30% - 情节推进
    { part: '高潮', ratio: 0.3 },   // 30% - 冲突高潮
    { part: '收尾', ratio: 0.2 }    // 20% - 自然结束
  ]

  // 逐段生成，每段严格限制token
  for (const section of sections) {
    const maxTokens = Math.ceil(section.targetWords * 0.75)
    // 生成当前段落...
  }

  // 合并所有部分
  const finalContent = generatedParts.join('\n\n')
}
```

**核心改进**：
1. **分段生成**：将章节拆分为开篇(20%)、发展(30%)、高潮(30%)、收尾(20%)四个部分
2. **严格token限制**：每段使用 `targetWords * 0.75` 作为maxTokens上限
3. **上下文传递**：后续段落接收前面已生成内容，保证连贯性
4. **章节完整性**：最后一段明确要求自然收尾，不会戛然而止

**默认字数配置**：

`src/views/EditorView.vue` 修改默认值：
```typescript
const generateConfig = reactive({
  chapterWordMin: 2000,
  chapterWordMax: 3000,  // 从4000改为3000
  continueWordMin: 300,
  continueWordMax: 800,
  temperature: 0.7
})
```

#### 5. 右侧生成面板修复

**问题**：右侧"生成"标签页点击无反应，配置无法修改。

**原因**：模板中使用了未定义的 `generateConfig` 对象，应该使用计算属性。

**修复**：

`src/components/editor/EditorRightPanel.vue` 修改模板绑定：
```vue
<!-- 修复前 -->
<el-input-number v-model="generateConfig.chapterWordMin" ... />

<!-- 修复后 -->
<el-input-number v-model="chapterWordMinValue" ... />
```

涉及字段：
- `generateConfig.chapterWordMin` → `chapterWordMinValue`
- `generateConfig.chapterWordMax` → `chapterWordMaxValue`
- `generateConfig.continueWordMin` → `continueWordMinValue`
- `generateConfig.continueWordMax` → `continueWordMaxValue`
- `generateConfig.temperature` → `temperatureValue`

#### 6. 后端章节字数自动计算

**问题**：创建章节时字数显示为0，未根据内容自动计算。

**修复位置**：`java-backend/src/main/java/com/novelai/studio/service/ChapterService.java`

**createChapter 方法修改**：
```java
// 自动计算字数（如果有内容）
if (chapter.getContent() != null && !chapter.getContent().isEmpty()) {
    // 去除空白字符后计算中文字数
    String contentWithoutSpaces = chapter.getContent().replaceAll("\\s+", "");
    chapter.setWordCount(contentWithoutSpaces.length());
} else if (chapter.getWordCount() == null) {
    chapter.setWordCount(0);
}
```

**updateChapter 方法修改**：
```java
// 如果内容有变化，自动重新计算字数
if (chapter.getContent() != null && !chapter.getContent().isEmpty()) {
    String contentWithoutSpaces = chapter.getContent().replaceAll("\\s+", "");
    chapter.setWordCount(contentWithoutSpaces.length());
}
```

**注意**：修改后端代码后需要重启Java服务才能生效。

---

### 2026-01-16 阶段三完成

#### 7. 角色管理系统

**功能概述**：完整的角色CRUD管理，支持角色档案、状态追踪、关系图谱

**后端实现**：
- 实体类：`Character.java`
- Mapper：`CharacterMapper.java`
- 服务层：`CharacterService.java`
- 控制器：`CharacterController.java`
- API接口：
  - `GET /api/characters/book/{bookId}` - 获取书籍角色列表
  - `GET /api/characters/{id}` - 获取角色详情
  - `POST /api/characters` - 创建角色
  - `PUT /api/characters/{id}` - 更新角色
  - `DELETE /api/characters/{id}` - 删除角色

**前端实现**：
- API服务：`src/services/api/characterApi.ts`
- 类型定义：`src/types/character.ts`
- 角色管理组件集成到编辑器右侧面板

#### 8. 角色关系图谱

**功能概述**：可视化角色之间的关系网络

**实现方式**：使用 ECharts 图形库实现力导向图
- 节点：角色（不同类型不同颜色）
- 边：角色关系（带标签）
- 支持拖拽、缩放、高亮

#### 9. 设定百科系统

**功能概述**：世界观设定管理，支持分类（力量体系、物品、地点、组织等）

**后端实现**：
- 实体类：`WorldSetting.java`
- Mapper：`WorldSettingMapper.java`
- 服务层：`WorldSettingService.java`
- 控制器：`WorldSettingController.java`
- API接口：
  - `GET /api/world-settings/book/{bookId}` - 获取书籍设定列表
  - `GET /api/world-settings/book/{bookId}/category/{category}` - 按分类获取
  - `POST /api/world-settings` - 创建设定
  - `PUT /api/world-settings/{id}` - 更新设定
  - `DELETE /api/world-settings/{id}` - 删除设定

**前端实现**：
- API服务：`src/services/api/worldSettingApi.ts`
- 类型定义：`src/types/worldSetting.ts`
- 设定百科页面：`src/views/SettingsView.vue`

#### 10. 知识库系统

**功能概述**：文件上传、向量化存储、语义检索

**后端实现**：

知识库文件管理：
- 实体类：`KnowledgeFile.java`
- 控制器：`KnowledgeController.java`
- 服务层：`KnowledgeFileService.java`
- 支持文件类型：txt、pdf、docx、epub、md

向量数据库集成：
- 配置类：`VectorDBConfig.java`
- 服务层：`VectorStoreService.java`
- 使用内存向量存储（可扩展为Milvus/Qdrant）

文件向量化：
- 服务层：`DocumentVectorService.java`
- 文档分块、向量化、存储

知识检索：
- 服务层：`KnowledgeSearchService.java`
- 语义检索、相关度排序、结果格式化

**前端实现**：
- API服务：`src/services/api/knowledgeApi.ts`
- 类型定义：`src/types/knowledge.ts`
- 知识库页面：`src/views/KnowledgeView.vue`
- 文件上传组件：`src/components/knowledge/FileUpload.vue`

#### 11. AI上下文增强

**功能概述**：AI生成时自动注入角色、设定和知识库信息

**后端实现**：
- 服务层：`AIContextEnhancer.java`
- 控制器：`AIContextController.java`
- API接口：
  - `GET /api/ai/context/enhanced/{bookId}` - 获取增强上下文
  - `GET /api/ai/context/characters/{bookId}` - 获取角色上下文
  - `GET /api/ai/context/settings/{bookId}` - 获取设定上下文
  - `POST /api/ai/context/chapter/{bookId}` - 获取章节生成上下文

**上下文构建逻辑**：
1. 角色上下文：按类型分组（主角、配角、反派），包含档案和状态信息
2. 设定上下文：按分类分组（力量体系、物品、地点等）
3. 知识库上下文：基于查询的语义检索结果
4. 章节上下文：综合以上 + 前文内容摘要

**前端实现**：
- API方法：`src/services/api/aiApi.ts` 新增：
  - `getEnhancedContext()` - 获取增强上下文
  - `getCharacterContext()` - 获取角色上下文
  - `getSettingContext()` - 获取设定上下文
  - `getChapterContext()` - 获取章节生成上下文

---

### 2026-01-16 性能优化

#### 12. AI上下文缓存机制

**功能概述**：为AI上下文增强服务添加缓存机制，避免重复构建相同的上下文

**实现位置**：`java-backend/src/main/java/com/novelai/studio/service/ai/AIContextEnhancer.java`

**核心实现**：
```java
// 缓存结构
private final Map<String, CacheEntry> contextCache = new ConcurrentHashMap<>();

// 缓存条目（包含内容和创建时间）
private static class CacheEntry {
    final String content;
    final Instant createdAt;
    boolean isExpired(int ttlSeconds) {...}
}

// 带缓存的上下文构建
public String buildCharacterContextCached(String bookId) {...}
public String buildSettingContextCached(String bookId) {...}

// 缓存管理
public void invalidateCache(String bookId) {...}
public void clearAllCache() {...}
```

**配置项**（application.yml）：
```yaml
ai:
  context:
    cache:
      ttl: 300  # 缓存过期时间（秒），默认5分钟
```

**特性**：
- 线程安全：使用 `ConcurrentHashMap`
- 自动过期：TTL机制，默认5分钟
- 容量限制：最大100条缓存
- 手动失效：支持按书籍ID失效缓存

**使用场景**：
- 角色和设定上下文会被缓存（数据变化频率低）
- 知识库检索结果不缓存（每次查询不同）

#### 13. 知识库检索相关度阈值过滤

**功能概述**：为知识库检索添加相关度阈值过滤，过滤掉低相关度的结果

**实现位置**：
- `java-backend/src/main/java/com/novelai/studio/service/knowledge/KnowledgeSearchService.java`
- `java-backend/src/main/java/com/novelai/studio/controller/KnowledgeSearchController.java`

**核心实现**：
```java
// 可配置的相关度阈值
@Value("${knowledge.search.relevance-threshold:0.1}")
private float relevanceThreshold;

// 支持自定义阈值的搜索
public List<SearchResult> search(String bookId, String query, int topK, float minRelevance) {
    // ...
    if (score >= minRelevance) {
        results.add(...);
    }
}

// 阈值管理
public void setRelevanceThreshold(float threshold) {...}
public float getRelevanceThreshold() {...}
```

**配置项**（application.yml）：
```yaml
knowledge:
  search:
    relevance-threshold: 0.1  # 相关度阈值，0-1之间
```

**新增API**：
- `GET /api/knowledge/search/threshold` - 获取当前阈值
- `PUT /api/knowledge/search/threshold` - 设置阈值（body: `{"threshold": 0.15}`）
- 搜索API新增可选参数：`minRelevance`

**使用示例**：
```
# 使用默认阈值搜索
GET /api/knowledge/search/book/{bookId}?query=关键词&topK=5

# 指定自定义阈值
GET /api/knowledge/search/book/{bookId}?query=关键词&topK=5&minRelevance=0.2

# 动态调整全局阈值
PUT /api/knowledge/search/threshold
{"threshold": 0.15}
```

---

**文档维护**：每完成一个阶段后更新任务状态

### 2026-01-16 阶段四完成：记忆系统

#### 14. 四层记忆架构

**功能概述**：实现完整的记忆系统，支持从即时记忆到长期记忆的多层级信息管理

**记忆层级设计**：
- **L0 永久记忆**：角色档案、世界观设定（带缓存，TTL 5分钟）
- **L1 即时记忆**：当前章节内容（最近3000字）
- **L2 短期记忆**：章节摘要（最近10章的AI生成摘要）
- **L3 长期记忆**：事件时间线 + 角色状态追踪

**数据库迁移**：`database/migrations/004_memory_system.sql`
- `chapter_summaries` - 章节摘要表
- `story_events` - 故事事件表
- `character_state_changes` - 角色状态变更表
- `foreshadows` - 伏笔表

#### 15. 章节摘要系统（L2）

**后端实现**：
- 实体类：`ChapterSummary.java`
- Mapper：`ChapterSummaryMapper.java`
- 服务层：`ChapterSummaryService.java`
  - `generateSummary(chapterId)` - AI生成章节摘要
  - `buildPreviousContext(bookId, chapterOrder, maxChapters)` - 构建前文摘要上下文
- 控制器：`ChapterSummaryController.java`
- API接口：
  - `GET /api/summaries/chapter/{chapterId}` - 获取章节摘要
  - `GET /api/summaries/book/{bookId}` - 获取书籍所有摘要
  - `POST /api/summaries/generate/{chapterId}` - AI生成摘要
  - `GET /api/summaries/context/{bookId}/{chapterOrder}` - 构建上下文

**前端实现**：
- API服务：`src/services/api/memoryApi.ts`
- UI组件：`src/components/editor/panels/SummaryPanel.vue`
- 功能：查看摘要、AI生成、手动编辑

#### 16. 事件时间线系统（L3）

**后端实现**：
- 实体类：`StoryEvent.java`
- Mapper：`StoryEventMapper.java`
- 服务层：`StoryEventService.java`
  - `extractEventsFromChapter(chapterId)` - AI从章节提取事件
  - `buildTimelineContext(bookId, chapterOrder)` - 构建时间线上下文
- 控制器：`StoryEventController.java`
- API接口：
  - `GET /api/events/book/{bookId}` - 获取书籍事件
  - `POST /api/events/extract/{chapterId}` - AI提取章节事件
  - `GET /api/events/context/{bookId}/{chapterOrder}` - 构建上下文

**前端实现**：
- UI组件：`src/components/editor/panels/TimelinePanel.vue`
- 功能：事件时间线显示、AI提取、手动添加、筛选（重大/次要/背景）

#### 17. 角色状态追踪（L3）

**后端实现**：
- 实体类：`CharacterStateChange.java`
- Mapper：`CharacterStateChangeMapper.java`
- 服务层：`CharacterStateChangeService.java`
  - `recordStateChange()` - 记录状态变更
  - `buildCharacterStateContext(bookId, chapterOrder)` - 构建角色状态上下文
  - `getCharacterStateAtChapter(characterId, chapterOrder)` - 获取角色在指定章节的状态
- 控制器：`CharacterStateController.java`
- API接口：
  - `GET /api/character-states/character/{characterId}` - 获取角色状态变更历史
  - `POST /api/character-states` - 记录状态变更
  - `GET /api/character-states/character/{characterId}/at-chapter/{chapterOrder}` - 获取指定章节状态

#### 18. 伏笔管理系统

**后端实现**：
- 实体类：`Foreshadow.java`
- Mapper：`ForeshadowMapper.java`
- 服务层：`ForeshadowService.java`
  - `buildForeshadowReminder(bookId, chapterOrder)` - 构建伏笔提醒上下文
  - `getForeshadowReminders(bookId, currentChapter, minChaptersAgo)` - 获取需要提醒的伏笔
- 控制器：`ForeshadowController.java`
- API接口：
  - `GET /api/foreshadows/book/{bookId}` - 获取书籍伏笔
  - `GET /api/foreshadows/book/{bookId}/unresolved` - 获取未回收伏笔
  - `POST /api/foreshadows` - 创建伏笔
  - `PUT /api/foreshadows/{id}/status` - 更新伏笔状态
  - `POST /api/foreshadows/{id}/resolve` - 标记为已回收
  - `GET /api/foreshadows/context/{bookId}/{chapterOrder}` - 构建伏笔上下文

**前端实现**：
- 类型定义：`src/types/memory.ts`
  - `ForeshadowType`: prophecy | item | character | event | hint
  - `ForeshadowImportance`: major | minor | subtle
  - `ForeshadowStatus`: planted | partial | resolved | abandoned
- UI组件：`src/components/editor/panels/ForeshadowPanel.vue`
- 功能：伏笔列表、统计、筛选、创建、状态管理、详情查看

#### 19. 记忆系统整合

**AI上下文增强服务**：`AIContextEnhancer.java`

核心方法：
```java
// 构建完整记忆上下文（包含所有层级）
public String buildFullMemoryContext(String bookId, int currentChapterOrder, String query) {
    // L0: 角色和设定信息（带缓存）
    // L2: 前文章节摘要
    // L3: 重要事件时间线
    // L3: 角色当前状态
    // 伏笔提醒
    // 知识库检索
}

// 构建章节生成上下文
public String buildChapterGenerationContext(String bookId, int currentChapterOrder,
                                             String chapterTitle, String previousContent) {
    // 记忆系统上下文 + L1即时记忆
}

// 构建续写上下文
public String buildContinueContext(String bookId, int chapterOrder, String currentContent) {
    // 精简角色上下文 + 伏笔提醒 + 当前内容
}
```

**前端Store**：`src/stores/memoryStore.ts`
- 统一管理摘要、事件、伏笔、状态变更数据
- 提供计算属性：`unresolvedForeshadows`, `majorEvents`, `foreshadowStats`
- 支持一键加载书籍全部记忆数据

#### 20. 编辑器右侧面板集成

**新增"记忆"标签页**，包含三个子面板：
- 伏笔面板：伏笔统计、列表、创建、状态管理
- 事件面板：时间线展示、AI提取、筛选
- 摘要面板：章节摘要查看、AI生成

**使用流程**：
1. 打开书籍后自动加载记忆数据
2. AI生成时自动注入相关记忆上下文
3. 伏笔系统会在写作时提醒未回收的重要伏笔
4. 事件和摘要支持AI自动提取，减少手动维护工作

---

### 2026-01-16 阶段五完成：逻辑审查系统

#### 21. 规则引擎框架

**功能概述**：可扩展的审查规则引擎，支持多级别审查规则

**后端架构**：
```
java-backend/src/main/java/com/novelai/studio/service/review/
├── ReviewRule.java                     # 规则接口
├── ReviewContext.java                  # 规则上下文
├── ReviewLevel.java                    # 级别常量(error/warning/suggestion/info)
├── ReviewType.java                     # 类型常量(15种问题类型)
├── ReviewReport.java                   # 审查报告
├── RuleEngineService.java              # 规则引擎服务
├── RealtimeReviewService.java          # 实时审查服务
└── rules/
    ├── AbstractReviewRule.java         # 规则基类
    ├── CharacterDeathConflictRule.java # Level A: 角色生死冲突
    ├── NameInconsistencyRule.java      # Level A: 称呼不一致
    ├── TimelineConflictRule.java       # Level A: 时间线冲突
    ├── LocationConflictRule.java       # Level A: 地理位置冲突
    ├── SettingConflictRule.java        # Level B: 设定冲突(AI辅助)
    ├── PersonalityDeviationRule.java   # Level B: 性格偏离(AI辅助)
    └── ForeshadowForgottenRule.java    # Level C: 伏笔遗忘检测
```

**审查级别**：
- **Level A (error)**: 确定性错误 - 角色生死冲突、称呼不一致、时间线冲突、实力等级冲突、地理位置冲突
- **Level B (warning)**: AI高可信警告 - 性格偏离、能力超限、设定冲突、物品异常
- **Level C (suggestion)**: 建议 - 因果关系存疑、节奏问题、情感突兀、伏笔遗忘
- **Level D (info)**: 提示 - 视角漂移、文风不一致

**API端点**：
- `GET /api/review/rules` - 获取所有规则
- `POST /api/review/chapter/{bookId}/{chapterId}` - 审查单章
- `POST /api/review/book/{bookId}` - 审查全书
- `POST /api/review/quick/{bookId}/{chapterId}` - 快速审查(仅错误)
- `GET /api/review/issues/book/{bookId}` - 获取书籍问题
- `GET /api/review/stats/{bookId}` - 获取统计信息
- `PUT /api/review/issues/{issueId}/status` - 更新问题状态

**前端架构**：
```
src/
├── types/review.ts                     # 审查类型定义
├── services/api/reviewApi.ts           # 审查API服务
├── stores/reviewStore.ts               # 审查状态管理
├── composables/useRealtimeReview.ts    # 实时审查Hook
├── views/ReviewView.vue                # 审查报告页面
└── components/review/
    ├── ReviewPanel.vue                 # 审查面板组件
    ├── ReviewIssueItem.vue             # 问题项组件
    └── ReviewNotification.vue          # 审查通知组件
```

---

### 2026-01-17 阶段六完成：AI对话与多模型

#### 22. AI对话系统

**功能概述**：完整的AI对话功能，支持会话管理、消息历史、流式响应

**数据库**：`database/migrations/006_chat_system.sql`
- `chat_sessions` - 对话会话表
- `chat_messages` - 对话消息表
- `ai_task_assignments` - AI任务分配配置表

**后端架构**：
```
java-backend/src/main/java/com/novelai/studio/
├── entity/
│   ├── ChatSession.java                # 对话会话实体
│   ├── ChatMessageEntity.java          # 对话消息实体
│   └── AiTaskAssignment.java           # AI任务分配实体
├── mapper/
│   ├── ChatSessionMapper.java          # 会话Mapper
│   ├── ChatMessageMapper.java          # 消息Mapper
│   └── AiTaskAssignmentMapper.java     # 任务分配Mapper
├── controller/
│   └── AiChatController.java           # 对话API控制器
└── service/
    ├── ChatHistoryService.java         # 对话历史服务
    └── AiTaskDispatchService.java      # 任务分配服务
```

**API端点**：
- `POST /api/chat/sessions` - 创建会话
- `GET /api/chat/sessions` - 获取会话列表
- `GET /api/chat/sessions/{id}` - 获取会话详情
- `PUT /api/chat/sessions/{id}/title` - 更新会话标题
- `POST /api/chat/sessions/{id}/toggle-pin` - 切换置顶
- `DELETE /api/chat/sessions/{id}` - 删除会话
- `GET /api/chat/sessions/{id}/messages` - 获取消息
- `POST /api/chat/sessions/{id}/send` - 发送消息（非流式）
- `POST /api/chat/sessions/{id}/stream` - 发送消息（流式SSE）

#### 23. 多AI适配器

**Claude适配器**：`ClaudeAdapter.java`
- 支持 Claude 3.5 Sonnet、Claude 3 Opus 等模型
- 流式响应支持

**Ollama适配器**：`OllamaAdapter.java`
- 支持本地模型：Llama、Mistral、Qwen 等
- 自动模型发现

**Gemini适配器**：通过 custom 提供商和 OpenAI 兼容 API 接入
- 推荐使用 gemini-2.0-flash 模型
- 支持 Gemini 3 Pro 等推理模型

#### 24. 多AI任务分配

**功能概述**：根据任务类型自动分配最合适的AI模型

**任务类型**：
- `generate` - 内容生成
- `review` - 逻辑审查
- `summary` - 摘要生成
- `chat` - 对话
- `outline` - 大纲生成

**配置表**：`ai_task_assignments`
- 支持按任务类型配置不同AI
- 支持优先级排序
- 支持启用/禁用

---

### 2026-01-17~18 大纲系统重构

#### 25. 三层大纲架构

**功能概述**：重新设计大纲系统，支持总大纲、分卷大纲、章节细纲三层结构

**总大纲**（Book.outline）：
- 全书整体规划
- 核心主题和走向
- 主要矛盾和解决路径

**分卷大纲**（Book.volumes）：
```typescript
interface VolumeOutline {
  id: string
  title: string           // 卷名，如"第一卷 起源"
  summary: string         // 本卷概要
  plotLine: string        // 核心剧情线（详细版）
  chapterCount: number    // 预计章节数
  startChapter: number    // 起始章节号
  endChapter: number      // 结束章节号
  wordCountTarget: number // 目标字数
  chapters: {             // 章节列表
    title: string
    brief: string         // 章节简介
  }[]
}
```

**章节细纲**（Chapter.detailOutline）：
```typescript
interface ChapterDetailOutline {
  chapterId: string
  steps: DetailOutlineStep[]  // 五步细纲
  status: 'draft' | 'confirmed' | 'generated'
  generatedAt?: string
  confirmedAt?: string
}

// 五步细纲结构
type DetailOutlineStepType = 'scene' | 'characters' | 'plot' | 'climax' | 'ending'

const DETAIL_OUTLINE_STEPS = [
  { type: 'scene', label: '场景铺设', description: '设定本章的场景环境、时间地点' },
  { type: 'characters', label: '角色出场', description: '本章出场的角色及其状态' },
  { type: 'plot', label: '剧情展开', description: '本章的核心剧情发展' },
  { type: 'climax', label: '高潮推进', description: '情节的高潮部分' },
  { type: 'ending', label: '本章收尾', description: '本章的结尾和留白' },
]
```

#### 26. AI辅助创建书籍向导升级

**字数规划**：
- 支持选择目标字数区间（30-36万到300万+）
- 自动计算分卷数量和章节数
- 每卷约100-120章，每章约3000字

**生成流程**：
1. 步骤1：输入书名、类型、风格、主角、世界观、核心冲突
2. 步骤2：AI生成总大纲 + 分卷大纲（含 plotLine 剧情线）+ 角色设定
3. 步骤3：预览确认后创建书籍

**分卷大纲显示优化**：
- 默认只显示剧情线（plotLine）
- 支持展开/折叠查看详细章节列表

#### 27. 细纲生成与章节生成

**细纲生成**：
- 基于总大纲 + 分卷大纲（优先使用 plotLine）+ 前文内容
- AI自动生成五步细纲
- 支持手动修改和确认

**章节生成**（四段式）：
```typescript
const partDistribution = [
  { part: '开篇', ratio: 0.2 },   // 20% - 场景铺设
  { part: '发展', ratio: 0.3 },   // 30% - 情节推进
  { part: '高潮', ratio: 0.3 },   // 30% - 冲突高潮
  { part: '收尾', ratio: 0.2 }    // 20% - 自然结束
]
```

**推理模型适配**：
- 针对 Gemini 3 Pro 等推理模型设置 32000 maxTokens 上限
- 采用 1.5 倍膨胀系数动态调整字数控制
- 对目标字数打折以控制实际输出长度

#### 28. 记忆提取系统

**功能概述**：AI自动从章节内容提取记忆信息

**提取内容**：
- L2 摘要：章节概要、关键事件、情感基调
- L3 事件：故事时间线上的重要事件
- 角色状态变化：位置、状态、情感、关系变化

**API端点**：
- `POST /api/memory/extract/{chapterId}` - 提取单章记忆
- `POST /api/memory/extract/book/{bookId}` - 批量提取整书
- `POST /api/memory/extract/{chapterId}/async` - 异步提取

#### 29. 应用启动时自动加载AI配置（2026-01-19）

**问题描述**：
每次重新启动软件后，必须先点击书架的设置页面才能使用 AI 功能（如创建书籍），否则会提示"请先在设置中配置 AI"。

**问题原因**：
- `CreateBookWizard.vue` 检查 `aiStore.hasConfig` 来判断是否可以使用 AI 功能
- 但 `aiStore.configs` 数组只有在调用 `fetchConfigs()` 后才会被填充
- 原来只有设置页面 (`ConfigView.vue`) 会调用 `fetchConfigs()`
- 导致应用启动时 AI 配置未加载，`hasConfig` 为 false

**解决方案**：
在 `App.vue` 的 `onMounted` 中添加 `aiStore.fetchConfigs()` 调用：

```vue
// src/App.vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useUiStore, useAiStore } from '@/stores'

const uiStore = useUiStore()
const aiStore = useAiStore()

onMounted(() => {
  uiStore.loadSettings()
  // 应用启动时自动加载 AI 配置，确保创建书籍等功能可用
  aiStore.fetchConfigs()
})
</script>
```

**修改文件**：
- `src/App.vue` - 添加 AI 配置初始化

**效果**：
1. 应用启动时自动加载 AI 配置列表
2. 如果没有配置，会自动创建默认的 Gemini 3 Pro 配置
3. 创建书籍时 `aiStore.hasConfig` 为 true，可以直接使用 AI 功能

---

**文档维护**：每完成一个阶段后更新任务状态