# Novel AI Studio 项目记忆

> 最后更新: 2026-01-17

## 项目概述

Novel AI Studio 是一个AI辅助小说创作工具，包含前端(Vue3)和后端(Spring Boot)。

---

## 后端架构

### 记忆提取系统

#### MemoryExtractionService.java
核心异步记忆提取服务：

```java
@Async
public void extractMemoryAsync(String chapterId)
// 异步提取：摘要(L2) + 事件(L3) + 角色状态变化

public MemoryExtractionResult extractMemorySync(String chapterId)
// 同步提取，返回完整结果

@Async
public void extractBookMemoryAsync(String bookId)
// 批量提取书籍所有章节
```

#### API端点
- `POST /api/memory/extract/chapter/{chapterId}` - 同步提取
- `POST /api/memory/extract/chapter/{chapterId}/async` - 异步提取
- `POST /api/memory/extract/book/{bookId}` - 批量异步提取

### 审查规则系统

#### TimelineConflictRule.java
- 检测时间描述与已发生事件的时间顺序矛盾
- Level: error, Priority: 95
- 触发词: 之前/以前/曾经/之后/随后/此后

#### LocationConflictRule.java
- 检测角色在短时间内出现在不合理的不同地点
- Level: error, Priority: 90
- 触发词: 到达/抵达/来到/进入/离开/同时/此时

### 配置更新

#### application.yml
```yaml
spring:
  servlet:
    multipart:
      max-file-size: 50MB
      max-request-size: 50MB

upload:
  path: ${user.home}/.novel-ai-studio/uploads
  cover-path: covers
  knowledge-path: knowledge
  max-cover-size: 5MB
  max-knowledge-size: 50MB
  allowed-cover-types: jpg,jpeg,png,gif,webp
  allowed-knowledge-types: txt,pdf,docx,doc,md,epub
```

### 实体重命名
- `ChatMessage.java` → `ChatMessageEntity.java`（避免与DTO冲突）
- 已更新: ChatMessageMapper, ChatHistoryService, AiChatController

### 新增服务/控制器
- `VolumeService.java` - 卷管理服务
- `VolumeController.java` - `/api/books/{bookId}/volumes`
- `MemoryExtractionService.java` - 记忆提取服务
- `MemoryExtractionController.java` - 记忆提取API

---

## 前端架构

### 工具函数

#### errorHandler.ts (src/utils/errorHandler.ts)
```typescript
showError(error, title?)      // 显示错误消息
showSuccess(message)          // 显示成功消息
showWarning(message)          // 显示警告消息
showInfo(message)             // 显示信息消息
confirm(message, title?, options?)  // 确认对话框
handleAsync<T>(operation, options?) // 异步操作包装器

enum ErrorType { NETWORK, API, VALIDATION, UNKNOWN }
```

#### memoryApi.ts 新增接口
```typescript
interface MemoryExtractionResult {
  success: boolean
  message: string
  summary?: ChapterSummary
  events?: StoryEvent[]
  stateChanges?: CharacterStateChange[]
}

extractChapterMemory(chapterId)      // 同步提取
extractChapterMemoryAsync(chapterId) // 异步提取
extractBookMemory(bookId)            // 批量提取
```

### 路由更新 (src/router/index.ts)
- `/ai-chat` - 独立AI对话
- `/ai-chat/:bookId` - 书籍关联AI对话

---

## 单元测试

已添加测试文件：
- `BookServiceTest.java`
- `ChapterSummaryServiceTest.java`
- `TimelineConflictRuleTest.java`
- `BookControllerTest.java`

---

## 待处理事项

- [ ] 知识库升级向量数据库（建议使用Milvus/Pinecone）
