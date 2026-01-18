package com.novelai.studio.controller;

import com.novelai.studio.common.Result;
import com.novelai.studio.entity.CharacterStateChange;
import com.novelai.studio.service.CharacterStateChangeService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 角色状态变更控制器
 */
@RestController
@RequestMapping("/api/character-states")
public class CharacterStateController {

    @Autowired
    private CharacterStateChangeService characterStateChangeService;

    /**
     * 获取角色的所有状态变更记录
     */
    @GetMapping("/character/{characterId}")
    public Result<List<CharacterStateChange>> getByCharacterId(@PathVariable String characterId) {
        List<CharacterStateChange> changes = characterStateChangeService.getByCharacterId(characterId);
        return Result.success(changes);
    }

    /**
     * 获取书籍的所有状态变更记录
     */
    @GetMapping("/book/{bookId}")
    public Result<List<CharacterStateChange>> getByBookId(@PathVariable String bookId) {
        List<CharacterStateChange> changes = characterStateChangeService.getByBookId(bookId);
        return Result.success(changes);
    }

    /**
     * 获取章节中的所有状态变更
     */
    @GetMapping("/chapter/{chapterId}")
    public Result<List<CharacterStateChange>> getByChapterId(@PathVariable String chapterId) {
        List<CharacterStateChange> changes = characterStateChangeService.getByChapterId(chapterId);
        return Result.success(changes);
    }

    /**
     * 获取角色在指定章节的状态
     */
    @GetMapping("/character/{characterId}/at-chapter/{chapterOrder}")
    public Result<Map<String, String>> getStateAtChapter(
            @PathVariable String characterId,
            @PathVariable int chapterOrder) {
        Map<String, String> state = characterStateChangeService.getCharacterStateAtChapter(characterId, chapterOrder);
        return Result.success(state);
    }

    /**
     * 获取角色的最新状态
     */
    @GetMapping("/character/{characterId}/latest")
    public Result<Map<String, String>> getLatestState(@PathVariable String characterId) {
        Map<String, String> state = characterStateChangeService.getLatestState(characterId);
        return Result.success(state);
    }

    /**
     * 记录状态变更
     */
    @PostMapping
    public Result<CharacterStateChange> recordChange(@RequestBody CharacterStateChange change) {
        CharacterStateChange created = characterStateChangeService.recordChange(
                change.getCharacterId(),
                change.getBookId(),
                change.getChapterId(),
                change.getChapterOrder(),
                change.getField(),
                change.getOldValue(),
                change.getNewValue(),
                change.getReason()
        );
        return Result.success(created);
    }

    /**
     * 批量记录状态变更
     */
    @PostMapping("/batch")
    public Result<List<CharacterStateChange>> recordChanges(@RequestBody List<CharacterStateChange> changes) {
        List<CharacterStateChange> created = characterStateChangeService.recordChanges(changes);
        return Result.success(created);
    }

    /**
     * 更新状态变更记录
     */
    @PutMapping("/{id}")
    public Result<CharacterStateChange> updateChange(@PathVariable String id, @RequestBody CharacterStateChange change) {
        change.setId(id);
        characterStateChangeService.updateById(change);
        return Result.success(change);
    }

    /**
     * 删除状态变更记录
     */
    @DeleteMapping("/{id}")
    public Result<Void> deleteChange(@PathVariable String id) {
        characterStateChangeService.removeById(id);
        return Result.success(null);
    }

    /**
     * 删除章节的所有状态变更记录
     */
    @DeleteMapping("/chapter/{chapterId}")
    public Result<Void> deleteByChapterId(@PathVariable String chapterId) {
        characterStateChangeService.deleteByChapterId(chapterId);
        return Result.success(null);
    }

    /**
     * 获取角色状态变更历史（按章节分组）
     */
    @GetMapping("/character/{characterId}/history")
    public Result<Map<Integer, List<CharacterStateChange>>> getChangeHistory(@PathVariable String characterId) {
        Map<Integer, List<CharacterStateChange>> history = characterStateChangeService.getChangeHistoryByChapter(characterId);
        return Result.success(history);
    }

    /**
     * 构建角色状态上下文
     */
    @GetMapping("/context/{bookId}/{chapterOrder}")
    public Result<String> buildStateContext(
            @PathVariable String bookId,
            @PathVariable int chapterOrder) {
        String context = characterStateChangeService.buildCharacterStateContext(bookId, chapterOrder);
        return Result.success(context);
    }
}
