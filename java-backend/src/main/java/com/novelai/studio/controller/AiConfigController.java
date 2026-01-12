package com.novelai.studio.controller;

import com.novelai.studio.common.Result;
import com.novelai.studio.entity.AiConfig;
import com.novelai.studio.service.AiConfigService;
import com.novelai.studio.service.ai.AIService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * AI配置控制器
 */
@RestController
@RequestMapping("/api/ai-configs")
public class AiConfigController {

    @Autowired
    private AiConfigService aiConfigService;

    @Autowired
    private AIService aiService;

    /**
     * 获取所有AI配置列表
     */
    @GetMapping
    public Result<List<AiConfig>> getConfigs() {
        List<AiConfig> configs = aiConfigService.getConfigList();
        // 对API Key进行脱敏处理
        configs.forEach(config -> {
            if (config.getApiKey() != null) {
                config.setApiKey(aiConfigService.maskApiKey(config.getApiKey()));
            }
        });
        return Result.success(configs);
    }

    /**
     * 获取配置详情
     */
    @GetMapping("/{id}")
    public Result<AiConfig> getConfig(@PathVariable String id) {
        AiConfig config = aiConfigService.getById(id);
        if (config == null) {
            return Result.notFound("配置不存在");
        }
        // 脱敏API Key
        if (config.getApiKey() != null) {
            config.setApiKey(aiConfigService.maskApiKey(config.getApiKey()));
        }
        return Result.success(config);
    }

    /**
     * 获取默认配置
     */
    @GetMapping("/default")
    public Result<AiConfig> getDefaultConfig() {
        AiConfig config = aiConfigService.getDefaultConfig();
        if (config == null) {
            return Result.notFound("没有默认配置");
        }
        // 脱敏API Key
        if (config.getApiKey() != null) {
            config.setApiKey(aiConfigService.maskApiKey(config.getApiKey()));
        }
        return Result.success(config);
    }

    /**
     * 创建配置
     */
    @PostMapping
    public Result<AiConfig> createConfig(@RequestBody AiConfig config) {
        if (config.getName() == null || config.getName().isEmpty()) {
            return Result.badRequest("配置名称不能为空");
        }
        if (config.getProvider() == null || config.getProvider().isEmpty()) {
            return Result.badRequest("提供商不能为空");
        }
        if (config.getApiKey() == null || config.getApiKey().isEmpty()) {
            return Result.badRequest("API Key不能为空");
        }
        if (config.getModel() == null || config.getModel().isEmpty()) {
            return Result.badRequest("模型不能为空");
        }

        AiConfig created = aiConfigService.createConfig(config);
        // 脱敏返回
        created.setApiKey(aiConfigService.maskApiKey(created.getApiKey()));
        return Result.success(created);
    }

    /**
     * 更新配置
     */
    @PutMapping("/{id}")
    public Result<AiConfig> updateConfig(@PathVariable String id, @RequestBody AiConfig config) {
        AiConfig existing = aiConfigService.getById(id);
        if (existing == null) {
            return Result.notFound("配置不存在");
        }

        // 如果前端传来的是脱敏后的API Key（包含****），则保留原API Key
        if (config.getApiKey() != null && config.getApiKey().contains("****")) {
            config.setApiKey(existing.getApiKey());
        }

        AiConfig updated = aiConfigService.updateConfig(id, config);

        // 清除适配器缓存，使新配置生效
        aiService.clearAdapterCache(id);

        // 脱敏返回
        updated.setApiKey(aiConfigService.maskApiKey(updated.getApiKey()));
        return Result.success(updated);
    }

    /**
     * 删除配置
     */
    @DeleteMapping("/{id}")
    public Result<Void> deleteConfig(@PathVariable String id) {
        AiConfig existing = aiConfigService.getById(id);
        if (existing == null) {
            return Result.notFound("配置不存在");
        }

        boolean result = aiConfigService.deleteConfig(id);
        if (result) {
            aiService.clearAdapterCache(id);
            return Result.success();
        } else {
            return Result.error("删除失败");
        }
    }

    /**
     * 设置默认配置
     */
    @PostMapping("/{id}/set-default")
    public Result<Void> setDefault(@PathVariable String id) {
        AiConfig existing = aiConfigService.getById(id);
        if (existing == null) {
            return Result.notFound("配置不存在");
        }

        aiConfigService.setDefault(id);
        return Result.success();
    }

    /**
     * 测试配置连接
     */
    @PostMapping("/{id}/test")
    public Result<Boolean> testConnection(@PathVariable String id) {
        AiConfig existing = aiConfigService.getById(id);
        if (existing == null) {
            return Result.notFound("配置不存在");
        }

        boolean connected = aiService.testConnection(id);
        return Result.success(connected);
    }

    /**
     * 获取可用模型列表
     */
    @GetMapping("/{id}/models")
    public Result<List<String>> getModels(@PathVariable String id) {
        AiConfig existing = aiConfigService.getById(id);
        if (existing == null) {
            return Result.notFound("配置不存在");
        }

        List<String> models = aiService.listModels(id);
        return Result.success(models);
    }
}
