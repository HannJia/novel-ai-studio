package com.novelai.studio.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.novelai.studio.common.PageResult;
import com.novelai.studio.entity.Character;
import com.novelai.studio.mapper.CharacterMapper;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * 角色服务
 */
@Service
public class CharacterService extends ServiceImpl<CharacterMapper, Character> {

    /**
     * 获取书籍的所有角色
     */
    public List<Character> getCharactersByBook(String bookId) {
        LambdaQueryWrapper<Character> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Character::getBookId, bookId);
        wrapper.orderByAsc(Character::getCreatedAt);
        return list(wrapper);
    }

    /**
     * 按类型获取书籍角色
     */
    public List<Character> getCharactersByBookAndType(String bookId, String type) {
        LambdaQueryWrapper<Character> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Character::getBookId, bookId);
        if (type != null && !type.isEmpty()) {
            wrapper.eq(Character::getType, type);
        }
        wrapper.orderByAsc(Character::getCreatedAt);
        return list(wrapper);
    }

    /**
     * 分页获取书籍角色
     */
    public PageResult<Character> getCharacterPage(String bookId, int page, int pageSize, String type) {
        LambdaQueryWrapper<Character> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Character::getBookId, bookId);

        if (type != null && !type.isEmpty()) {
            wrapper.eq(Character::getType, type);
        }

        wrapper.orderByAsc(Character::getCreatedAt);

        Page<Character> pageResult = page(new Page<>(page, pageSize), wrapper);
        return PageResult.of(
                pageResult.getRecords(),
                pageResult.getTotal(),
                page,
                pageSize
        );
    }

    /**
     * 创建角色
     */
    public Character createCharacter(Character character) {
        // 初始化默认值
        if (character.getAliases() == null) {
            character.setAliases(new ArrayList<>());
        }
        if (character.getType() == null) {
            character.setType("other");
        }
        if (character.getProfile() == null) {
            character.setProfile(createDefaultProfile());
        }
        if (character.getState() == null) {
            character.setState(createDefaultState());
        }

        save(character);
        return character;
    }

    /**
     * 更新角色
     */
    public Character updateCharacter(String id, Character character) {
        character.setId(id);
        updateById(character);
        return getById(id);
    }

    /**
     * 更新角色档案
     */
    public Character updateProfile(String id, Map<String, Object> profile) {
        Character character = getById(id);
        if (character != null) {
            character.setProfile(profile);
            updateById(character);
        }
        return character;
    }

    /**
     * 更新角色状态
     */
    public Character updateState(String id, Map<String, Object> state) {
        Character character = getById(id);
        if (character != null) {
            character.setState(state);
            updateById(character);
        }
        return character;
    }

    /**
     * 添加角色别名
     */
    public Character addAlias(String id, String alias) {
        Character character = getById(id);
        if (character != null) {
            List<String> aliases = character.getAliases();
            if (aliases == null) {
                aliases = new ArrayList<>();
            }
            if (!aliases.contains(alias)) {
                aliases.add(alias);
                character.setAliases(aliases);
                updateById(character);
            }
        }
        return character;
    }

    /**
     * 移除角色别名
     */
    public Character removeAlias(String id, String alias) {
        Character character = getById(id);
        if (character != null) {
            List<String> aliases = character.getAliases();
            if (aliases != null) {
                aliases.remove(alias);
                character.setAliases(aliases);
                updateById(character);
            }
        }
        return character;
    }

    /**
     * 搜索角色（按名字或别名）
     */
    public List<Character> searchCharacters(String bookId, String keyword) {
        LambdaQueryWrapper<Character> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Character::getBookId, bookId);
        wrapper.and(w -> w
                .like(Character::getName, keyword)
                .or()
                .apply("JSON_CONTAINS(aliases, CONCAT('\"', {0}, '\"'))", keyword)
        );
        return list(wrapper);
    }

    /**
     * 统计书籍角色数量
     */
    public Map<String, Long> countCharactersByType(String bookId) {
        List<Character> characters = getCharactersByBook(bookId);
        Map<String, Long> counts = new HashMap<>();
        counts.put("protagonist", 0L);
        counts.put("supporting", 0L);
        counts.put("antagonist", 0L);
        counts.put("other", 0L);

        for (Character character : characters) {
            String type = character.getType();
            counts.put(type, counts.getOrDefault(type, 0L) + 1);
        }
        counts.put("total", (long) characters.size());

        return counts;
    }

    /**
     * 创建默认角色档案
     */
    private Map<String, Object> createDefaultProfile() {
        Map<String, Object> profile = new HashMap<>();
        profile.put("gender", "");
        profile.put("age", "");
        profile.put("appearance", "");
        profile.put("personality", "");
        profile.put("background", "");
        profile.put("abilities", "");
        profile.put("goals", "");
        profile.put("extra", new HashMap<String, String>());
        return profile;
    }

    /**
     * 创建默认角色状态
     */
    private Map<String, Object> createDefaultState() {
        Map<String, Object> state = new HashMap<>();
        state.put("isAlive", true);
        state.put("location", "");
        state.put("powerLevel", "");
        state.put("relationships", new ArrayList<>());
        state.put("items", new ArrayList<>());
        state.put("lastUpdatedChapter", 0);
        state.put("stateHistory", new ArrayList<>());
        return state;
    }
}
