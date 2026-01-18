package com.novelai.studio.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.novelai.studio.common.PageResult;
import com.novelai.studio.entity.WorldSetting;
import com.novelai.studio.mapper.WorldSettingMapper;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * 世界观设定服务
 */
@Service
public class WorldSettingService extends ServiceImpl<WorldSettingMapper, WorldSetting> {

    /**
     * 设定分类常量
     */
    public static final String CATEGORY_POWER_SYSTEM = "power_system";  // 力量体系
    public static final String CATEGORY_ITEM = "item";                   // 物品道具
    public static final String CATEGORY_LOCATION = "location";           // 地点场景
    public static final String CATEGORY_ORGANIZATION = "organization";   // 组织势力
    public static final String CATEGORY_OTHER = "other";                 // 其他

    /**
     * 获取书籍的所有设定
     */
    public List<WorldSetting> getSettingsByBook(String bookId) {
        LambdaQueryWrapper<WorldSetting> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(WorldSetting::getBookId, bookId);
        wrapper.orderByAsc(WorldSetting::getCategory);
        wrapper.orderByAsc(WorldSetting::getCreatedAt);
        return list(wrapper);
    }

    /**
     * 按分类获取书籍设定
     */
    public List<WorldSetting> getSettingsByCategory(String bookId, String category) {
        LambdaQueryWrapper<WorldSetting> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(WorldSetting::getBookId, bookId);
        wrapper.eq(WorldSetting::getCategory, category);
        wrapper.orderByAsc(WorldSetting::getCreatedAt);
        return list(wrapper);
    }

    /**
     * 分页获取书籍设定
     */
    public PageResult<WorldSetting> getSettingPage(String bookId, int page, int pageSize, String category) {
        LambdaQueryWrapper<WorldSetting> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(WorldSetting::getBookId, bookId);

        if (category != null && !category.isEmpty()) {
            wrapper.eq(WorldSetting::getCategory, category);
        }

        wrapper.orderByAsc(WorldSetting::getCategory);
        wrapper.orderByAsc(WorldSetting::getCreatedAt);

        Page<WorldSetting> pageResult = page(new Page<>(page, pageSize), wrapper);
        return PageResult.of(
                pageResult.getRecords(),
                pageResult.getTotal(),
                page,
                pageSize
        );
    }

    /**
     * 创建设定
     */
    public WorldSetting createSetting(WorldSetting setting) {
        if (setting.getCategory() == null || setting.getCategory().isEmpty()) {
            setting.setCategory(CATEGORY_OTHER);
        }
        if (setting.getTags() == null) {
            setting.setTags(new ArrayList<>());
        }
        save(setting);
        return setting;
    }

    /**
     * 更新设定
     */
    public WorldSetting updateSetting(String id, WorldSetting setting) {
        setting.setId(id);
        updateById(setting);
        return getById(id);
    }

    /**
     * 搜索设定
     */
    public List<WorldSetting> searchSettings(String bookId, String keyword) {
        LambdaQueryWrapper<WorldSetting> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(WorldSetting::getBookId, bookId);
        wrapper.and(w -> w
                .like(WorldSetting::getName, keyword)
                .or()
                .like(WorldSetting::getContent, keyword)
        );
        return list(wrapper);
    }

    /**
     * 按标签搜索设定
     */
    public List<WorldSetting> getSettingsByTag(String bookId, String tag) {
        LambdaQueryWrapper<WorldSetting> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(WorldSetting::getBookId, bookId);
        wrapper.apply("JSON_CONTAINS(tags, CONCAT('\"', {0}, '\"'))", tag);
        return list(wrapper);
    }

    /**
     * 添加标签
     */
    public WorldSetting addTag(String id, String tag) {
        WorldSetting setting = getById(id);
        if (setting != null) {
            List<String> tags = setting.getTags();
            if (tags == null) {
                tags = new ArrayList<>();
            }
            if (!tags.contains(tag)) {
                tags.add(tag);
                setting.setTags(tags);
                updateById(setting);
            }
        }
        return setting;
    }

    /**
     * 移除标签
     */
    public WorldSetting removeTag(String id, String tag) {
        WorldSetting setting = getById(id);
        if (setting != null) {
            List<String> tags = setting.getTags();
            if (tags != null) {
                tags.remove(tag);
                setting.setTags(tags);
                updateById(setting);
            }
        }
        return setting;
    }

    /**
     * 统计各分类数量
     */
    public Map<String, Long> countByCategory(String bookId) {
        List<WorldSetting> settings = getSettingsByBook(bookId);
        Map<String, Long> counts = new HashMap<>();
        counts.put(CATEGORY_POWER_SYSTEM, 0L);
        counts.put(CATEGORY_ITEM, 0L);
        counts.put(CATEGORY_LOCATION, 0L);
        counts.put(CATEGORY_ORGANIZATION, 0L);
        counts.put(CATEGORY_OTHER, 0L);

        for (WorldSetting setting : settings) {
            String category = setting.getCategory();
            counts.put(category, counts.getOrDefault(category, 0L) + 1);
        }
        counts.put("total", (long) settings.size());

        return counts;
    }

    /**
     * 获取书籍的所有标签
     */
    public Set<String> getAllTags(String bookId) {
        List<WorldSetting> settings = getSettingsByBook(bookId);
        Set<String> allTags = new HashSet<>();
        for (WorldSetting setting : settings) {
            if (setting.getTags() != null) {
                allTags.addAll(setting.getTags());
            }
        }
        return allTags;
    }

    /**
     * 批量删除设定
     */
    public void deleteByIds(List<String> ids) {
        removeByIds(ids);
    }
}
