package com.novelai.studio.controller;

import com.novelai.studio.common.Result;
import com.novelai.studio.entity.Foreshadow;
import com.novelai.studio.service.ForeshadowService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 伏笔控制器
 */
@RestController
@RequestMapping("/api/foreshadows")
public class ForeshadowController {

    @Autowired
    private ForeshadowService foreshadowService;

    /**
     * 获取书籍的所有伏笔
     */
    @GetMapping("/book/{bookId}")
    public Result<List<Foreshadow>> getByBookId(@PathVariable String bookId) {
        List<Foreshadow> foreshadows = foreshadowService.getByBookId(bookId);
        return Result.success(foreshadows);
    }

    /**
     * 按状态获取书籍的伏笔
     */
    @GetMapping("/book/{bookId}/status/{status}")
    public Result<List<Foreshadow>> getByBookIdAndStatus(
            @PathVariable String bookId,
            @PathVariable String status) {
        List<Foreshadow> foreshadows = foreshadowService.getByBookIdAndStatus(bookId, status);
        return Result.success(foreshadows);
    }

    /**
     * 获取未回收的伏笔
     */
    @GetMapping("/book/{bookId}/unresolved")
    public Result<List<Foreshadow>> getUnresolved(@PathVariable String bookId) {
        List<Foreshadow> foreshadows = foreshadowService.getUnresolved(bookId);
        return Result.success(foreshadows);
    }

    /**
     * 获取重要的未回收伏笔
     */
    @GetMapping("/book/{bookId}/major-unresolved")
    public Result<List<Foreshadow>> getMajorUnresolved(@PathVariable String bookId) {
        List<Foreshadow> foreshadows = foreshadowService.getMajorUnresolved(bookId);
        return Result.success(foreshadows);
    }

    /**
     * 获取章节中埋设的伏笔
     */
    @GetMapping("/chapter/{chapterId}")
    public Result<List<Foreshadow>> getByPlantedChapter(@PathVariable String chapterId) {
        List<Foreshadow> foreshadows = foreshadowService.getByPlantedChapter(chapterId);
        return Result.success(foreshadows);
    }

    /**
     * 获取与角色相关的伏笔
     */
    @GetMapping("/book/{bookId}/character/{characterId}")
    public Result<List<Foreshadow>> getByCharacter(
            @PathVariable String bookId,
            @PathVariable String characterId) {
        List<Foreshadow> foreshadows = foreshadowService.getByCharacter(bookId, characterId);
        return Result.success(foreshadows);
    }

    /**
     * 获取伏笔详情
     */
    @GetMapping("/{id}")
    public Result<Foreshadow> getById(@PathVariable String id) {
        Foreshadow foreshadow = foreshadowService.getById(id);
        return Result.success(foreshadow);
    }

    /**
     * 创建伏笔
     */
    @PostMapping
    public Result<Foreshadow> createForeshadow(@RequestBody Foreshadow foreshadow) {
        Foreshadow created = foreshadowService.createForeshadow(foreshadow);
        return Result.success(created);
    }

    /**
     * 更新伏笔
     */
    @PutMapping("/{id}")
    public Result<Foreshadow> updateForeshadow(@PathVariable String id, @RequestBody Foreshadow foreshadow) {
        foreshadow.setId(id);
        foreshadowService.updateById(foreshadow);
        return Result.success(foreshadow);
    }

    /**
     * 更新伏笔状态
     */
    @PutMapping("/{id}/status")
    public Result<Foreshadow> updateStatus(
            @PathVariable String id,
            @RequestParam String status,
            @RequestParam(required = false) String notes) {
        Foreshadow foreshadow = foreshadowService.updateStatus(id, status, notes);
        if (foreshadow == null) {
            return Result.error("伏笔不存在");
        }
        return Result.success(foreshadow);
    }

    /**
     * 添加回收章节
     */
    @PostMapping("/{id}/resolution-chapter")
    public Result<Foreshadow> addResolutionChapter(
            @PathVariable String id,
            @RequestParam int chapterOrder) {
        Foreshadow foreshadow = foreshadowService.addResolutionChapter(id, chapterOrder);
        if (foreshadow == null) {
            return Result.error("伏笔不存在");
        }
        return Result.success(foreshadow);
    }

    /**
     * 标记为完全回收
     */
    @PostMapping("/{id}/resolve")
    public Result<Foreshadow> markAsResolved(
            @PathVariable String id,
            @RequestParam(required = false) String notes) {
        Foreshadow foreshadow = foreshadowService.markAsResolved(id, notes);
        if (foreshadow == null) {
            return Result.error("伏笔不存在");
        }
        return Result.success(foreshadow);
    }

    /**
     * 标记为废弃
     */
    @PostMapping("/{id}/abandon")
    public Result<Foreshadow> markAsAbandoned(
            @PathVariable String id,
            @RequestParam(required = false) String reason) {
        Foreshadow foreshadow = foreshadowService.markAsAbandoned(id, reason);
        if (foreshadow == null) {
            return Result.error("伏笔不存在");
        }
        return Result.success(foreshadow);
    }

    /**
     * 删除伏笔
     */
    @DeleteMapping("/{id}")
    public Result<Void> deleteForeshadow(@PathVariable String id) {
        foreshadowService.removeById(id);
        return Result.success(null);
    }

    /**
     * 统计各状态的伏笔数量
     */
    @GetMapping("/book/{bookId}/stats")
    public Result<Map<String, Long>> countByStatus(@PathVariable String bookId) {
        Map<String, Long> stats = foreshadowService.countByStatus(bookId);
        return Result.success(stats);
    }

    /**
     * 获取需要提醒的伏笔
     */
    @GetMapping("/book/{bookId}/reminders")
    public Result<List<Foreshadow>> getReminders(
            @PathVariable String bookId,
            @RequestParam int currentChapter,
            @RequestParam(defaultValue = "5") int minChaptersAgo) {
        List<Foreshadow> foreshadows = foreshadowService.getForeshadowsNeedReminder(bookId, currentChapter, minChaptersAgo);
        return Result.success(foreshadows);
    }

    /**
     * 构建伏笔提醒上下文
     */
    @GetMapping("/context/{bookId}/{chapterOrder}")
    public Result<String> buildReminderContext(
            @PathVariable String bookId,
            @PathVariable int chapterOrder) {
        String context = foreshadowService.buildForeshadowReminder(bookId, chapterOrder);
        return Result.success(context);
    }
}
