#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GLM-4.7 CLI 工具 - 专注于技术分析
用于与 Claude Code 配合使用，GLM 负责分析，Claude 负责执行
"""
import sys
import os
import io
import argparse

# 修复 Windows 控制台编码问题
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from zhipuai import ZhipuAI


def main():
    parser = argparse.ArgumentParser(description='GLM-4.7 分析工具')
    parser.add_argument('-p', '--prompt', type=str, help='分析提示词')
    parser.add_argument('-m', '--model', type=str, default='glm-4-flash',
                        help='模型选择 (默认: glm-4-flash)')
    parser.add_argument('-t', '--temperature', type=float, default=0.7,
                        help='温度参数 (默认: 0.7)')
    parser.add_argument('--no-system', action='store_true',
                        help='不使用系统提示词')

    args, unknown = parser.parse_known_args()

    # 获取提示词：优先使用 -p 参数，否则合并所有未知参数
    prompt = args.prompt if args.prompt else ' '.join(unknown)

    if not prompt:
        print("用法: python glm-cli.py -p 'your prompt'")
        print("  或: python glm-cli.py 'your prompt'")
        sys.exit(1)

    # 获取 API Key（优先从环境变量，否则使用默认值）
    api_key = os.getenv("ZHIPUAI_API_KEY", "00a817c2512e42f98a3eb13822d0b183.63e2s8cS8GUVGgVJ")
    if not api_key:
        print("错误：请设置 ZHIPUAI_API_KEY 环境变量")
        print("Windows: set ZHIPUAI_API_KEY=your_api_key")
        print("或在系统环境变量中永久设置")
        sys.exit(1)

    client = ZhipuAI(api_key=api_key)

    # 系统提示词 - 专注于分析
    system_prompt = """你是一个专业的技术分析师。你的职责是：
1. 分析需求和问题
2. 制定详细的行动计划
3. 指出技术要点和注意事项
4. 提供架构设计建议

重要原则：
- 你只负责分析和规划，不要直接编写完整代码
- 可以给出代码片段示例来说明思路
- 分析要全面、结构化、可执行
- 关注安全性、性能、可维护性

输出格式建议：
## 需求分析
## 技术要点
## 行动计划
## 注意事项"""

    try:
        messages = []
        if not args.no_system:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        response = client.chat.completions.create(
            model=args.model,
            messages=messages,
            temperature=args.temperature,
        )
        print(response.choices[0].message.content)

    except Exception as e:
        print(f"错误：{e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
