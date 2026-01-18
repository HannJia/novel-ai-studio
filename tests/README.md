# NovelAI Studio 测试指南

## 目录结构

```
tests/
├── unit/                  # 单元测试
│   ├── wordCount.test.ts  # 字数统计测试
│   └── format.test.ts     # 格式化工具测试
├── e2e/                   # 端到端测试
│   └── app.spec.ts        # 应用 E2E 测试
├── setup.ts               # 测试环境配置
└── README.md              # 本文件
```

## 运行测试

### 单元测试

```bash
# 运行所有单元测试
npm run test

# 运行特定测试文件
npm run test -- tests/unit/wordCount.test.ts

# 监听模式
npm run test -- --watch

# 查看覆盖率
npm run test -- --coverage
```

### E2E 测试

E2E 测试需要额外配置 Playwright 或 Cypress。

```bash
# 安装 Playwright（如果需要）
npm install -D @playwright/test playwright

# 运行 E2E 测试
npx playwright test
```

## 编写测试

### 单元测试示例

```typescript
import { describe, it, expect } from 'vitest'
import { myFunction } from '@/utils/myModule'

describe('myModule', () => {
  describe('myFunction', () => {
    it('should do something', () => {
      expect(myFunction('input')).toBe('expected output')
    })
  })
})
```

### 测试命名规范

- 测试文件以 `.test.ts` 或 `.spec.ts` 结尾
- 使用中文描述测试用例，便于理解
- `describe` 块描述被测试的模块/函数
- `it` 块描述具体的测试场景

## 测试覆盖目标

- 工具函数: 100% 覆盖
- 服务层: 80% 覆盖
- 组件: 关键交互测试
