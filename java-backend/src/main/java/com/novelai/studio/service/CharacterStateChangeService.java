package com.novelai.studio.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.novelai.studio.entity.Character;
import com.novelai.studio.entity.Chapter;
import com.novelai.studio.entity.CharacterStateChange;
import com.novelai.studio.mapper.CharacterStateChangeMapper;
import com.novelai.studio.service.ai.AIService;
import com.novelai.studio.service.ai.dto.GenerateResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 角色状态变更服务
 */
@Service
public class CharacterStateChangeService extends ServiceImpl<CharacterStateChangeMapper, CharacterStateChange> {

    @Autowired
    private CharacterStateChangeMapper characterStateChangeMapper;

    @Autowired
    private CharacterService characterService;

    @Autowired
    private ChapterService chapterService;

    @Autowired
    private AIService aiService;

    /**
     * 获取角色的所有状态变更记录
     */
    public List<CharacterStateChange> getByCharacterId(String characterId) {
        return characterStateChangeMapper.selectByCharacterId(characterId);
    }

    /**
     * 获取书籍的所有状态变更记录
     */
    public List<CharacterStateChange> getByBookId(String bookId) {
        return characterStateChangeMapper.selectByBookId(bookId);
    }

    /**
     * 获取章节中的所有状态变更
     */
    public List<CharacterStateChange> getByChapterId(String chapterId) {
        return characterStateChangeMapper.selectByChapterId(chapterId);
    }

    /**
     * 获取角色在指定章节的状态
     */
    public Map<String, String> getCharacterStateAtChapter(String characterId, int chapterOrder) {
        List<CharacterStateChange> changes = characterStateChangeMapper.selectBeforeChapter(characterId, chapterOrder);

        // 构建状态映射（每个字段取最新值）
        Map<String, String> state = new HashMap<>();
        for (CharacterStateChange change : changes) {
            state.put(change.getField(), change.getNewValue());
        }

        return state;
    }

    /**
     * 记录状态变更
     */
    public CharacterStateChange recordChange(String characterId, String bookId, String chapterId,
                                              int chapterOrder, String field, String oldValue,
                                              String newValue, String reason) {
        CharacterStateChange change = new CharacterStateChange();
        change.setCharacterId(characterId);
        change.setBookId(bookId);
        change.setChapterId(chapterId);
        change.setChapterOrder(chapterOrder);
        change.setField(field);
        change.setOldValue(oldValue);
        change.setNewValue(newValue);
        change.setReason(reason);

        save(change);
        return change;
    }

    /**
     * 批量记录状态变更
     */
    public List<CharacterStateChange> recordChanges(List<CharacterStateChange> changes) {
        saveBatch(changes);
        return changes;
    }

    /**
     * 获取角色的最新状态
     */
    public Map<String, String> getLatestState(String characterId) {
        List<CharacterStateChange> latestChanges = characterStateChangeMapper.selectLatestByCharacter(characterId);

        Map<String, String> state = new HashMap<>();
        for (CharacterStateChange change : latestChanges) {
            state.put(change.getField(), change.getNewValue());
        }

        return state;
    }

    /**
     * 构建角色状态上下文（用于AI生成）
     */
    public String buildCharacterStateContext(String bookId, int currentChapterOrder) {
        List<Character> characters = characterService.getCharactersByBook(bookId);
        if (characters.isEmpty()) {
            return "";
        }

        StringBuilder context = new StringBuilder();
        context.append("【角色当前状态】\n\n");

        for (Character character : characters) {
            Map<String, String> state = getCharacterStateAtChapter(character.getId(), currentChapterOrder);
            if (!state.isEmpty()) {
                context.append("- ").append(character.getName()).append("：");
                List<String> stateItems = state.entrySet().stream()
                        .map(e -> e.getKey() + "=" + e.getValue())
                        .collect(Collectors.toList());
                context.append(String.join(", ", stateItems)).append("\n");
            }
        }

        return context.toString();
    }

    /**
     * 获取角色状态变更历史（按章节分组）
     */
    public Map<Integer, List<CharacterStateChange>> getChangeHistoryByChapter(String characterId) {
        List<CharacterStateChange> changes = getByCharacterId(characterId);
        return changes.stream().collect(Collectors.groupingBy(CharacterStateChange::getChapterOrder));
    }

    /**
     * 删除章节的所有状态变更记录
     */
    public void deleteByChapterId(String chapterId) {
        List<CharacterStateChange> changes = getByChapterId(chapterId);
        if (!changes.isEmpty()) {
            removeByIds(changes.stream().map(CharacterStateChange::getId).collect(Collectors.toList()));
        }
    }

    /**
     * 从章节内容中提取角色状态变化（AI辅助）
     */
    public List<CharacterStateChange> extractFromChapter(String chapterId) {
        Chapter chapter = chapterService.getById(chapterId);
        if (chapter == null || chapter.getContent() == null || chapter.getContent().isEmpty()) {
            return new ArrayList<>();
        }

        // 获取书籍的角色列表
        List<Character> characters = characterService.getCharactersByBook(chapter.getBookId());
        if (characters.isEmpty()) {
            return new ArrayList<>();
        }

        // 构建AI提示
        String prompt = buildExtractionPrompt(chapter, characters);

        // 调用AI提取状态变化
        GenerateResult result = aiService.generate(prompt);
        if (result == null || result.getContent() == null || result.getContent().isEmpty()) {
            return new ArrayList<>();
        }

        // 解析AI响应
        List<CharacterStateChange> changes = parseExtractionResponse(result.getContent(), chapter, characters);

        // 先删除该章节的旧记录
        deleteByChapterId(chapterId);

        // 保存新的状态变化
        if (!changes.isEmpty()) {
            saveBatch(changes);
        }

        return changes;
    }

    /**
     * 构建状态变化提取的AI提示
     */
    private String buildExtractionPrompt(Chapter chapter, List<Character> characters) {
        StringBuilder prompt = new StringBuilder();
        prompt.append("请从以下小说章节中提取角色状态变化。\n\n");

        prompt.append("【已知角色列表】\n");
        for (Character c : characters) {
            prompt.append("- ").append(c.getName());
            if (c.getAliases() != null && !c.getAliases().isEmpty()) {
                prompt.append("（别名：").append(String.join("、", c.getAliases())).append("）");
            }
            prompt.append("\n");
        }

        prompt.append("\n【章节标题】").append(chapter.getTitle()).append("\n\n");
        prompt.append("【章节内容】\n").append(chapter.getContent()).append("\n\n");

        prompt.append("请按以下JSON数组格式输出角色状态变化：\n");
        prompt.append("[\n");
        prompt.append("  {\n");
        prompt.append("    \"characterName\": \"角色名称\",\n");
        prompt.append("    \"field\": \"变化字段（如：location位置/status状态/emotion情绪/relationship关系/ability能力/health健康）\",\n");
        prompt.append("    \"oldValue\": \"变化前的值（如果已知）\",\n");
        prompt.append("    \"newValue\": \"变化后的值\",\n");
        prompt.append("    \"reason\": \"变化原因\"\n");
        prompt.append("  }\n");
        prompt.append("]\n\n");
        prompt.append("注意：\n");
        prompt.append("1. 只提取明确的状态变化，不要推测\n");
        prompt.append("2. 如果没有状态变化，返回空数组 []\n");
        prompt.append("3. 只关注已知角色列表中的角色\n");

        return prompt.toString();
    }

    /**
     * 解析AI响应为状态变化列表
     */
    @SuppressWarnings("unchecked")
    private List<CharacterStateChange> parseExtractionResponse(String response, Chapter chapter, List<Character> characters) {
        List<CharacterStateChange> changes = new ArrayList<>();

        // 构建角色名到ID的映射
        Map<String, String> nameToId = new HashMap<>();
        for (Character c : characters) {
            nameToId.put(c.getName(), c.getId());
            if (c.getAliases() != null) {
                for (String alias : c.getAliases()) {
                    nameToId.put(alias, c.getId());
                }
            }
        }

        try {
            int jsonStart = response.indexOf("[");
            int jsonEnd = response.lastIndexOf("]") + 1;
            if (jsonStart >= 0 && jsonEnd > jsonStart) {
                String jsonStr = response.substring(jsonStart, jsonEnd);
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                List<Map<String, Object>> jsonList = mapper.readValue(jsonStr, List.class);

                for (Map<String, Object> json : jsonList) {
                    String characterName = (String) json.get("characterName");
                    String characterId = nameToId.get(characterName);

                    if (characterId != null) {
                        CharacterStateChange change = new CharacterStateChange();
                        change.setCharacterId(characterId);
                        change.setBookId(chapter.getBookId());
                        change.setChapterId(chapter.getId());
                        change.setChapterOrder(chapter.getOrderNum());
                        change.setField((String) json.get("field"));
                        change.setOldValue((String) json.get("oldValue"));
                        change.setNewValue((String) json.get("newValue"));
                        change.setReason((String) json.get("reason"));
                        changes.add(change);
                    }
                }
            }
        } catch (Exception e) {
            // 解析失败，返回空列表
        }

        return changes;
    }
}
