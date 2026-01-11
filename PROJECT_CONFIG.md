# NovelAI Studio 项目配置文档

## 项目概述

NovelAI Studio 是一个个人AI辅助小说创作工具，采用前后端分离架构。

## 技术栈

### 前端
- **框架**: Vue 3 + TypeScript
- **构建工具**: Vite 5.x
- **UI框架**: Element Plus
- **状态管理**: Pinia
- **路由**: Vue Router 4
- **桌面应用**: Electron 28.x
- **样式**: SCSS

### 后端
- **框架**: Spring Boot 3.2.1
- **语言**: Java 17
- **ORM**: MyBatis-Plus 3.5.5
- **数据库**: MySQL 8.4
- **连接池**: Druid

## 环境配置

### Java 环境
- **版本**: Java 17 (Eclipse Adoptium)
- **路径**: `C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot`

### Maven
- **版本**: 3.9.6
- **路径**: `C:\Users\1\apache-maven-3.9.6`

### MySQL
- **版本**: 8.4.6
- **服务名称**: MySQL84
- **端口**: 3306
- **数据目录**: `C:\Users\1\mysql_data`
- **配置文件**: `C:\Users\1\mysql_data\my.ini`
- **用户名**: root
- **密码**: root
- **数据库名**: novel_ai_studio

## 启动命令

### 启动 MySQL 服务
```batch
net start MySQL84
```

### 启动后端
```batch
C:\Users\1\start-backend.bat
```
或手动执行：
```batch
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot"
set "PATH=%JAVA_HOME%\bin;C:\Users\1\apache-maven-3.9.6\bin;%PATH%"
cd /d E:\Cousor_work\novel-ai-studio\java-backend
mvn spring-boot:run
```

### 启动前端（Web模式）
```bash
cd E:\Cousor_work\novel-ai-studio
npm run dev:web
```

### 启动 Electron 桌面应用
```batch
E:\Cousor_work\novel-ai-studio\start-electron.bat
```

## 端口配置

| 服务 | 端口 |
|------|------|
| MySQL | 3306 |
| Spring Boot 后端 | 8080 |
| Vite 前端 | 5173 |

## 数据库表结构

数据库包含以下 11 张表：
- `ai_configs` - AI配置
- `books` - 书籍
- `chapter_versions` - 章节版本
- `chapters` - 章节
- `characters` - 角色
- `foreshadows` - 伏笔
- `outlines` - 大纲
- `token_usage` - Token使用记录
- `user_settings` - 用户设置
- `volumes` - 卷
- `world_settings` - 世界观设置

Schema文件位置: `E:\Cousor_work\novel-ai-studio\database\schema.sql`

## API 端点

### 书籍 API
- `GET /api/books` - 获取书籍列表
- `GET /api/books/{id}` - 获取书籍详情
- `POST /api/books` - 创建书籍
- `PUT /api/books/{id}` - 更新书籍
- `DELETE /api/books/{id}` - 删除书籍

### 章节 API
- `GET /api/chapters/book/{bookId}` - 获取书籍的章节列表
- `GET /api/chapters/{id}` - 获取章节详情
- `POST /api/chapters` - 创建章节
- `PUT /api/chapters/{id}` - 更新章节
- `DELETE /api/chapters/{id}` - 删除章节

## 项目结构

```
novel-ai-studio/
├── src/                      # 前端源码
│   ├── components/           # Vue组件
│   ├── views/               # 页面视图
│   ├── stores/              # Pinia状态管理
│   ├── services/            # API服务
│   ├── types/               # TypeScript类型
│   ├── styles/              # 全局样式
│   └── utils/               # 工具函数
├── electron/                 # Electron主进程
│   ├── main.ts              # 主进程入口
│   └── preload.ts           # 预加载脚本
├── java-backend/            # Spring Boot后端
│   └── src/main/
│       ├── java/com/novelai/studio/
│       │   ├── controller/  # 控制器
│       │   ├── service/     # 服务层
│       │   ├── mapper/      # MyBatis映射
│       │   └── entity/      # 实体类
│       └── resources/
│           └── application.yml  # 配置文件
├── database/                 # 数据库相关
│   └── schema.sql           # 数据库Schema
├── package.json             # 前端依赖配置
├── vite.config.ts           # Vite配置
└── start-electron.bat       # Electron启动脚本
```

## 已知问题及解决方案

### 1. MyBatis别名冲突
**问题**: `Character` 实体类与 `java.lang.Character` 冲突
**解决**: 在实体类上添加 `@Alias("NovelCharacter")` 注解

### 2. JDBC字符编码
**问题**: `characterEncoding=utf8mb4` 不被Java识别
**解决**: 改为 `characterEncoding=UTF-8`

### 3. Electron启动失败
**问题**: `ELECTRON_RUN_AS_NODE=1` 导致Electron以Node模式运行
**解决**: 使用 `start-electron.bat` 清除该环境变量后启动

## 主题配置

应用支持浅色和深色两种主题，通过 `uiStore` 管理：
- 浅色主题: `light`
- 深色主题: `dark`
- 跟随系统: `auto`

主题相关文件：
- `src/styles/variables.scss` - 主题变量
- `src/styles/global.scss` - 全局样式（包含暗色主题）
- `src/stores/uiStore.ts` - 主题状态管理

## 开发注意事项

1. 修改后端代码后需要重启 Spring Boot
2. 修改前端代码后 Vite 会自动热更新
3. 修改 Electron 主进程代码后需要重启应用
4. MySQL 服务配置为开机自启，无需手动启动
