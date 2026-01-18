package com.novelai.studio.service.review.rules;

import com.novelai.studio.entity.Chapter;
import com.novelai.studio.entity.CharacterStateChange;
import com.novelai.studio.entity.ReviewIssue;
import com.novelai.studio.service.review.ReviewContext;
import com.novelai.studio.service.review.ReviewLevel;
import com.novelai.studio.service.review.ReviewType;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Level A 规则：角色生死冲突检测
 * 检测已死亡的角色在后续章节中出现
 */
@Component
public class CharacterDeathConflictRule extends AbstractReviewRule {

    public CharacterDeathConflictRule() {
        super(
            "角色生死冲突检测",
            "检测已死亡的角色在后续章节中出现的情况",
            ReviewLevel.ERROR,
            ReviewType.CHARACTER_DEATH_CONFLICT,
            10
        );
    }

    @Override
    public List<ReviewIssue> check(ReviewContext context) {
        if (context.getCurrentChapter() == null) {
            return noIssues();
        }

        Chapter currentChapter = context.getCurrentChapter();
        String content = currentChapter.getContent();
        if (content == null || content.isEmpty()) {
            return noIssues();
        }

        List<ReviewIssue> issues = new ArrayList<>();

        // 获取在当前章节之前已死亡的角色
        Map<String, Integer> deadCharacters = getDeadCharactersBeforeChapter(context, currentChapter.getOrderNum());

        if (deadCharacters.isEmpty()) {
            return noIssues();
        }

        // 检查当前章节内容中是否出现已死亡角色
        for (Map.Entry<String, Integer> entry : deadCharacters.entrySet()) {
            String characterName = entry.getKey();
            Integer deathChapter = entry.getValue();

            // 获取该角色的所有名称（包括别名）
            Set<String> allNames = getCharacterAllNames(context, characterName);

            for (String name : allNames) {
                // 检查是否在内容中出现（排除回忆、梦境等特殊场景）
                List<String> occurrences = findCharacterOccurrences(content, name);

                for (String occurrence : occurrences) {
                    if (!isInFlashbackOrDream(content, occurrence)) {
                        issues.add(ReviewIssue.builder()
                                .level(ReviewLevel.ERROR)
                                .type(ReviewType.CHARACTER_DEATH_CONFLICT)
                                .title("角色生死冲突：" + characterName)
                                .description(String.format(
                                    "角色「%s」在第%d章已死亡，但在当前章节（第%d章）中出现活动描写。",
                                    characterName, deathChapter, currentChapter.getOrderNum()
                                ))
                                .location(Map.of(
                                    "originalText", occurrence,
                                    "characterName", name
                                ))
                                .suggestion("请检查该角色是否确实已死亡，或修改相关描写（如改为回忆场景）")
                                .reference(Map.of(
                                    "deathChapter", deathChapter
                                ))
                                .confidence(new BigDecimal("0.95"))
                                .build());
                        break; // 每个名称只报告一次
                    }
                }
            }
        }

        return issues;
    }

    /**
     * 获取在指定章节之前已死亡的角色
     */
    private Map<String, Integer> getDeadCharactersBeforeChapter(ReviewContext context, int currentChapterOrder) {
        Map<String, Integer> deadCharacters = new HashMap<>();

        for (CharacterStateChange change : context.getCharacterStateChanges()) {
            if (change.getChapterOrder() < currentChapterOrder
                && "isAlive".equals(change.getField())
                && "false".equals(change.getNewValue())) {

                // 获取角色名称
                com.novelai.studio.entity.Character character = context.getCharacterById().get(change.getCharacterId());
                if (character != null) {
                    // 检查是否之后又复活了
                    boolean revived = context.getCharacterStateChanges().stream()
                            .anyMatch(c -> c.getCharacterId().equals(change.getCharacterId())
                                    && c.getChapterOrder() > change.getChapterOrder()
                                    && c.getChapterOrder() < currentChapterOrder
                                    && "isAlive".equals(c.getField())
                                    && "true".equals(c.getNewValue()));

                    if (!revived) {
                        deadCharacters.put(character.getName(), change.getChapterOrder());
                    }
                }
            }
        }

        return deadCharacters;
    }

    /**
     * 获取角色的所有名称（包括别名）
     */
    private Set<String> getCharacterAllNames(ReviewContext context, String characterName) {
        Set<String> allNames = new HashSet<>();
        allNames.add(characterName);

        // 查找角色获取别名
        for (com.novelai.studio.entity.Character character : context.getCharacters()) {
            if (character.getName().equals(characterName)) {
                if (character.getAliases() != null) {
                    allNames.addAll(character.getAliases());
                }
                break;
            }
        }

        return allNames;
    }

    /**
     * 在内容中查找角色出现的位置
     */
    private List<String> findCharacterOccurrences(String content, String name) {
        List<String> occurrences = new ArrayList<>();

        // 使用正则匹配角色名称（排除简单提及，只找动作描写）
        // 匹配模式：角色名 + 动词（说、道、想、走、跑等）
        String pattern = name + "(?:说|道|想|走|跑|站|坐|躺|看|听|问|答|笑|哭|喊|叫|来|去|回|打|杀|挥|举|拿|放|吃|喝|睡|醒)";
        Pattern p = Pattern.compile(pattern);
        Matcher m = p.matcher(content);

        while (m.find()) {
            // 获取上下文
            int start = Math.max(0, m.start() - 20);
            int end = Math.min(content.length(), m.end() + 20);
            occurrences.add(content.substring(start, end));
        }

        return occurrences;
    }

    /**
     * 检查是否在回忆或梦境场景中
     */
    private boolean isInFlashbackOrDream(String content, String occurrence) {
        // 简单检测：查看上下文是否包含回忆/梦境相关词汇
        String[] flashbackKeywords = {"回忆", "想起", "记得", "从前", "当年", "那时", "梦见", "梦中", "梦里", "恍惚"};

        // 在occurrence周围200字内查找关键词
        int pos = content.indexOf(occurrence);
        if (pos < 0) return false;

        int start = Math.max(0, pos - 100);
        int end = Math.min(content.length(), pos + occurrence.length() + 100);
        String context = content.substring(start, end);

        for (String keyword : flashbackKeywords) {
            if (context.contains(keyword)) {
                return true;
            }
        }

        return false;
    }
}
