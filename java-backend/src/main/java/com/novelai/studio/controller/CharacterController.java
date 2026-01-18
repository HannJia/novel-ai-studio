package com.novelai.studio.controller;

import com.novelai.studio.common.PageResult;
import com.novelai.studio.common.Result;
import com.novelai.studio.entity.Character;
import com.novelai.studio.service.CharacterService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 角色控制器
 */
@RestController
@RequestMapping("/api/characters")
public class CharacterController {

    @Autowired
    private CharacterService characterService;

    /**
     * 获取书籍的所有角色
     */
    @GetMapping("/book/{bookId}")
    public Result<List<Character>> getCharactersByBook(@PathVariable String bookId) {
        List<Character> characters = characterService.getCharactersByBook(bookId);
        return Result.success(characters);
    }

    /**
     * 按类型获取书籍角色
     */
    @GetMapping("/book/{bookId}/type/{type}")
    public Result<List<Character>> getCharactersByType(
            @PathVariable String bookId,
            @PathVariable String type) {
        List<Character> characters = characterService.getCharactersByBookAndType(bookId, type);
        return Result.success(characters);
    }

    /**
     * 分页获取书籍角色
     */
    @GetMapping("/book/{bookId}/page")
    public Result<PageResult<Character>> getCharacterPage(
            @PathVariable String bookId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int pageSize,
            @RequestParam(required = false) String type) {
        PageResult<Character> result = characterService.getCharacterPage(bookId, page, pageSize, type);
        return Result.success(result);
    }

    /**
     * 获取角色详情
     */
    @GetMapping("/{id}")
    public Result<Character> getCharacter(@PathVariable String id) {
        Character character = characterService.getById(id);
        if (character == null) {
            return Result.notFound("角色不存在");
        }
        return Result.success(character);
    }

    /**
     * 创建角色
     */
    @PostMapping
    public Result<Character> createCharacter(@RequestBody Character character) {
        if (character.getBookId() == null || character.getBookId().isEmpty()) {
            return Result.badRequest("书籍ID不能为空");
        }
        if (character.getName() == null || character.getName().isEmpty()) {
            return Result.badRequest("角色名不能为空");
        }

        Character created = characterService.createCharacter(character);
        return Result.success(created);
    }

    /**
     * 更新角色
     */
    @PutMapping("/{id}")
    public Result<Character> updateCharacter(@PathVariable String id, @RequestBody Character character) {
        Character existing = characterService.getById(id);
        if (existing == null) {
            return Result.notFound("角色不存在");
        }

        Character updated = characterService.updateCharacter(id, character);
        return Result.success(updated);
    }

    /**
     * 更新角色档案
     */
    @PutMapping("/{id}/profile")
    public Result<Character> updateProfile(
            @PathVariable String id,
            @RequestBody Map<String, Object> profile) {
        Character existing = characterService.getById(id);
        if (existing == null) {
            return Result.notFound("角色不存在");
        }

        Character updated = characterService.updateProfile(id, profile);
        return Result.success(updated);
    }

    /**
     * 更新角色状态
     */
    @PutMapping("/{id}/state")
    public Result<Character> updateState(
            @PathVariable String id,
            @RequestBody Map<String, Object> state) {
        Character existing = characterService.getById(id);
        if (existing == null) {
            return Result.notFound("角色不存在");
        }

        Character updated = characterService.updateState(id, state);
        return Result.success(updated);
    }

    /**
     * 添加角色别名
     */
    @PostMapping("/{id}/alias")
    public Result<Character> addAlias(
            @PathVariable String id,
            @RequestBody Map<String, String> request) {
        Character existing = characterService.getById(id);
        if (existing == null) {
            return Result.notFound("角色不存在");
        }

        String alias = request.get("alias");
        if (alias == null || alias.isEmpty()) {
            return Result.badRequest("别名不能为空");
        }

        Character updated = characterService.addAlias(id, alias);
        return Result.success(updated);
    }

    /**
     * 移除角色别名
     */
    @DeleteMapping("/{id}/alias/{alias}")
    public Result<Character> removeAlias(
            @PathVariable String id,
            @PathVariable String alias) {
        Character existing = characterService.getById(id);
        if (existing == null) {
            return Result.notFound("角色不存在");
        }

        Character updated = characterService.removeAlias(id, alias);
        return Result.success(updated);
    }

    /**
     * 删除角色
     */
    @DeleteMapping("/{id}")
    public Result<Void> deleteCharacter(@PathVariable String id) {
        Character existing = characterService.getById(id);
        if (existing == null) {
            return Result.notFound("角色不存在");
        }

        characterService.removeById(id);
        return Result.success();
    }

    /**
     * 搜索角色
     */
    @GetMapping("/book/{bookId}/search")
    public Result<List<Character>> searchCharacters(
            @PathVariable String bookId,
            @RequestParam String keyword) {
        List<Character> characters = characterService.searchCharacters(bookId, keyword);
        return Result.success(characters);
    }

    /**
     * 统计书籍角色数量
     */
    @GetMapping("/book/{bookId}/stats")
    public Result<Map<String, Long>> getCharacterStats(@PathVariable String bookId) {
        Map<String, Long> stats = characterService.countCharactersByType(bookId);
        return Result.success(stats);
    }
}
