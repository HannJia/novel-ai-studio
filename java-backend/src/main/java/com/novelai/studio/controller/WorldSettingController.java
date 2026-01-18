package com.novelai.studio.controller;

import com.novelai.studio.common.PageResult;
import com.novelai.studio.common.Result;
import com.novelai.studio.entity.WorldSetting;
import com.novelai.studio.service.WorldSettingService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 世界观设定控制器
 */
@RestController
@RequestMapping("/api/world-settings")
public class WorldSettingController {

    @Autowired
    private WorldSettingService worldSettingService;

    /**
     * 获取书籍的所有设定
     */
    @GetMapping("/book/{bookId}")
    public Result<List<WorldSetting>> getSettingsByBook(@PathVariable String bookId) {
        List<WorldSetting> settings = worldSettingService.getSettingsByBook(bookId);
        return Result.success(settings);
    }

    /**
     * 按分类获取书籍设定
     */
    @GetMapping("/book/{bookId}/category/{category}")
    public Result<List<WorldSetting>> getSettingsByCategory(
            @PathVariable String bookId,
            @PathVariable String category) {
        List<WorldSetting> settings = worldSettingService.getSettingsByCategory(bookId, category);
        return Result.success(settings);
    }

    /**
     * 分页获取书籍设定
     */
    @GetMapping("/book/{bookId}/page")
    public Result<PageResult<WorldSetting>> getSettingPage(
            @PathVariable String bookId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int pageSize,
            @RequestParam(required = false) String category) {
        PageResult<WorldSetting> result = worldSettingService.getSettingPage(bookId, page, pageSize, category);
        return Result.success(result);
    }

    /**
     * 获取设定详情
     */
    @GetMapping("/{id}")
    public Result<WorldSetting> getSetting(@PathVariable String id) {
        WorldSetting setting = worldSettingService.getById(id);
        if (setting == null) {
            return Result.notFound("设定不存在");
        }
        return Result.success(setting);
    }

    /**
     * 创建设定
     */
    @PostMapping
    public Result<WorldSetting> createSetting(@RequestBody WorldSetting setting) {
        if (setting.getBookId() == null || setting.getBookId().isEmpty()) {
            return Result.badRequest("书籍ID不能为空");
        }
        if (setting.getName() == null || setting.getName().isEmpty()) {
            return Result.badRequest("设定名称不能为空");
        }

        WorldSetting created = worldSettingService.createSetting(setting);
        return Result.success(created);
    }

    /**
     * 更新设定
     */
    @PutMapping("/{id}")
    public Result<WorldSetting> updateSetting(@PathVariable String id, @RequestBody WorldSetting setting) {
        WorldSetting existing = worldSettingService.getById(id);
        if (existing == null) {
            return Result.notFound("设定不存在");
        }

        WorldSetting updated = worldSettingService.updateSetting(id, setting);
        return Result.success(updated);
    }

    /**
     * 删除设定
     */
    @DeleteMapping("/{id}")
    public Result<Void> deleteSetting(@PathVariable String id) {
        WorldSetting existing = worldSettingService.getById(id);
        if (existing == null) {
            return Result.notFound("设定不存在");
        }

        worldSettingService.removeById(id);
        return Result.success();
    }

    /**
     * 批量删除设定
     */
    @DeleteMapping("/batch")
    public Result<Void> deleteSettings(@RequestBody List<String> ids) {
        worldSettingService.deleteByIds(ids);
        return Result.success();
    }

    /**
     * 搜索设定
     */
    @GetMapping("/book/{bookId}/search")
    public Result<List<WorldSetting>> searchSettings(
            @PathVariable String bookId,
            @RequestParam String keyword) {
        List<WorldSetting> settings = worldSettingService.searchSettings(bookId, keyword);
        return Result.success(settings);
    }

    /**
     * 按标签搜索设定
     */
    @GetMapping("/book/{bookId}/tag/{tag}")
    public Result<List<WorldSetting>> getSettingsByTag(
            @PathVariable String bookId,
            @PathVariable String tag) {
        List<WorldSetting> settings = worldSettingService.getSettingsByTag(bookId, tag);
        return Result.success(settings);
    }

    /**
     * 添加标签
     */
    @PostMapping("/{id}/tag")
    public Result<WorldSetting> addTag(
            @PathVariable String id,
            @RequestBody Map<String, String> request) {
        WorldSetting existing = worldSettingService.getById(id);
        if (existing == null) {
            return Result.notFound("设定不存在");
        }

        String tag = request.get("tag");
        if (tag == null || tag.isEmpty()) {
            return Result.badRequest("标签不能为空");
        }

        WorldSetting updated = worldSettingService.addTag(id, tag);
        return Result.success(updated);
    }

    /**
     * 移除标签
     */
    @DeleteMapping("/{id}/tag/{tag}")
    public Result<WorldSetting> removeTag(
            @PathVariable String id,
            @PathVariable String tag) {
        WorldSetting existing = worldSettingService.getById(id);
        if (existing == null) {
            return Result.notFound("设定不存在");
        }

        WorldSetting updated = worldSettingService.removeTag(id, tag);
        return Result.success(updated);
    }

    /**
     * 获取设定统计
     */
    @GetMapping("/book/{bookId}/stats")
    public Result<Map<String, Long>> getSettingStats(@PathVariable String bookId) {
        Map<String, Long> stats = worldSettingService.countByCategory(bookId);
        return Result.success(stats);
    }

    /**
     * 获取书籍所有标签
     */
    @GetMapping("/book/{bookId}/tags")
    public Result<Set<String>> getAllTags(@PathVariable String bookId) {
        Set<String> tags = worldSettingService.getAllTags(bookId);
        return Result.success(tags);
    }
}
