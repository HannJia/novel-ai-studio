package com.novelai.studio.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.novelai.studio.entity.AiConfig;
import com.novelai.studio.mapper.AiConfigMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * AI配置服务
 */
@Service
public class AiConfigService extends ServiceImpl<AiConfigMapper, AiConfig> {

    /**
     * 获取所有配置列表
     */
    public List<AiConfig> getConfigList() {
        LambdaQueryWrapper<AiConfig> wrapper = new LambdaQueryWrapper<>();
        wrapper.orderByDesc(AiConfig::getIsDefault)
               .orderByDesc(AiConfig::getUpdatedAt);
        return list(wrapper);
    }

    /**
     * 获取默认配置
     */
    public AiConfig getDefaultConfig() {
        LambdaQueryWrapper<AiConfig> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(AiConfig::getIsDefault, true);
        return getOne(wrapper);
    }

    /**
     * 根据提供商获取配置列表
     */
    public List<AiConfig> getConfigsByProvider(String provider) {
        LambdaQueryWrapper<AiConfig> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(AiConfig::getProvider, provider)
               .orderByDesc(AiConfig::getIsDefault)
               .orderByDesc(AiConfig::getUpdatedAt);
        return list(wrapper);
    }

    /**
     * 创建配置
     */
    @Transactional
    public AiConfig createConfig(AiConfig config) {
        // 如果是第一个配置或设置为默认，需要处理默认状态
        if (Boolean.TRUE.equals(config.getIsDefault())) {
            clearDefaultFlag();
        } else if (count() == 0) {
            // 第一个配置自动设为默认
            config.setIsDefault(true);
        }

        // 设置默认值
        if (config.getMaxTokens() == null) {
            config.setMaxTokens(4096);
        }
        if (config.getTemperature() == null) {
            config.setTemperature(new java.math.BigDecimal("0.7"));
        }
        if (config.getTopP() == null) {
            config.setTopP(new java.math.BigDecimal("1.0"));
        }
        if (config.getUsageTasks() == null) {
            config.setUsageTasks(List.of("all"));
        }

        save(config);
        return config;
    }

    /**
     * 更新配置
     */
    @Transactional
    public AiConfig updateConfig(String id, AiConfig config) {
        config.setId(id);

        // 如果设置为默认，先清除其他默认
        if (Boolean.TRUE.equals(config.getIsDefault())) {
            clearDefaultFlag();
        }

        updateById(config);
        return getById(id);
    }

    /**
     * 设置默认配置
     */
    @Transactional
    public void setDefault(String id) {
        clearDefaultFlag();

        LambdaUpdateWrapper<AiConfig> wrapper = new LambdaUpdateWrapper<>();
        wrapper.eq(AiConfig::getId, id)
               .set(AiConfig::getIsDefault, true);
        update(wrapper);
    }

    /**
     * 删除配置
     */
    @Transactional
    public boolean deleteConfig(String id) {
        AiConfig config = getById(id);
        if (config == null) {
            return false;
        }

        boolean result = removeById(id);

        // 如果删除的是默认配置，将第一个配置设为默认
        if (result && Boolean.TRUE.equals(config.getIsDefault())) {
            LambdaQueryWrapper<AiConfig> wrapper = new LambdaQueryWrapper<>();
            wrapper.orderByAsc(AiConfig::getCreatedAt).last("LIMIT 1");
            AiConfig firstConfig = getOne(wrapper);
            if (firstConfig != null) {
                firstConfig.setIsDefault(true);
                updateById(firstConfig);
            }
        }

        return result;
    }

    /**
     * 清除所有配置的默认标记
     */
    private void clearDefaultFlag() {
        LambdaUpdateWrapper<AiConfig> wrapper = new LambdaUpdateWrapper<>();
        wrapper.set(AiConfig::getIsDefault, false);
        update(wrapper);
    }

    /**
     * 脱敏API Key（用于前端展示）
     */
    public String maskApiKey(String apiKey) {
        if (apiKey == null || apiKey.length() < 8) {
            return "****";
        }
        return apiKey.substring(0, 4) + "****" + apiKey.substring(apiKey.length() - 4);
    }
}
