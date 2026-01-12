package com.novelai.studio.service.ai.adapter;

import com.novelai.studio.service.ai.dto.*;

import java.util.List;
import java.util.function.Consumer;

/**
 * AI 适配器接口
 * 所有 AI 服务提供商需实现此接口
 */
public interface AIAdapter {

    /**
     * 获取适配器名称
     *
     * @return 适配器名称
     */
    String getName();

    /**
     * 获取 AI 提供商类型
     *
     * @return 提供商枚举
     */
    AIProvider getProvider();

    /**
     * 生成内容（单轮对话）
     *
     * @param prompt  用户提示词
     * @param options 生成选项
     * @return 生成结果
     */
    GenerateResult generate(String prompt, GenerateOptions options);

    /**
     * 多轮对话生成
     *
     * @param messages 消息历史
     * @param options  生成选项
     * @return 生成结果
     */
    GenerateResult chat(List<ChatMessage> messages, GenerateOptions options);

    /**
     * 流式生成内容
     *
     * @param prompt   用户提示词
     * @param options  生成选项
     * @param consumer 内容消费者（逐块接收生成内容）
     * @return 最终生成结果
     */
    GenerateResult generateStream(String prompt, GenerateOptions options, Consumer<String> consumer);

    /**
     * 流式多轮对话
     *
     * @param messages 消息历史
     * @param options  生成选项
     * @param consumer 内容消费者
     * @return 最终生成结果
     */
    GenerateResult chatStream(List<ChatMessage> messages, GenerateOptions options, Consumer<String> consumer);

    /**
     * 测试连接是否正常
     *
     * @return true 表示连接正常
     */
    boolean testConnection();

    /**
     * 获取可用模型列表
     *
     * @return 模型名称列表
     */
    List<String> listModels();

    /**
     * 获取默认模型
     *
     * @return 默认模型名称
     */
    String getDefaultModel();
}
