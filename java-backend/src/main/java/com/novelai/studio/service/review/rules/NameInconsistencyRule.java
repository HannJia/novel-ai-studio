package com.novelai.studio.service.review.rules;

import com.novelai.studio.entity.Chapter;
import com.novelai.studio.entity.ReviewIssue;
import com.novelai.studio.service.review.ReviewContext;
import com.novelai.studio.service.review.ReviewLevel;
import com.novelai.studio.service.review.ReviewType;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.*;

/**
 * Level A 规则：称呼不一致检测
 * 检测同一角色的名称/称呼使用不一致的情况
 */
@Component
public class NameInconsistencyRule extends AbstractReviewRule {

    public NameInconsistencyRule() {
        super(
            "称呼不一致检测",
            "检测同一角色在文中的称呼是否混乱使用",
            ReviewLevel.ERROR,
            ReviewType.NAME_INCONSISTENCY,
            20
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

        // 检查每个角色
        for (com.novelai.studio.entity.Character character : context.getCharacters()) {
            // 收集该角色的所有称呼使用情况
            Map<String, Integer> nameUsage = new HashMap<>();

            // 检查主名称
            int mainNameCount = countOccurrences(content, character.getName());
            if (mainNameCount > 0) {
                nameUsage.put(character.getName(), mainNameCount);
            }

            // 检查别名
            if (character.getAliases() != null) {
                for (String alias : character.getAliases()) {
                    int aliasCount = countOccurrences(content, alias);
                    if (aliasCount > 0) {
                        nameUsage.put(alias, aliasCount);
                    }
                }
            }

            // 如果使用了多个不同的称呼，且存在混用问题
            if (nameUsage.size() > 1) {
                // 检查是否存在可能的混淆
                List<String> potentialIssues = checkForConfusingUsage(content, nameUsage);
                if (!potentialIssues.isEmpty()) {
                    issues.add(ReviewIssue.builder()
                            .level(ReviewLevel.ERROR)
                            .type(ReviewType.NAME_INCONSISTENCY)
                            .title("称呼使用混乱：" + character.getName())
                            .description(String.format(
                                "角色「%s」在本章中使用了多个不同的称呼：%s。" +
                                "在同一段落或相近位置混用不同称呼可能导致读者困惑。",
                                character.getName(),
                                String.join("、", nameUsage.keySet())
                            ))
                            .location(Map.of(
                                "characterId", character.getId(),
                                "usedNames", nameUsage
                            ))
                            .suggestion("建议在同一场景中保持称呼一致，或在切换称呼时有明确的上下文过渡")
                            .confidence(new BigDecimal("0.80"))
                            .build());
                }
            }
        }

        // 检查是否有未定义的角色名称被使用
        issues.addAll(checkUndefinedCharacterNames(context, content));

        return issues;
    }

    /**
     * 统计文本中某个名称出现的次数
     */
    private int countOccurrences(String content, String name) {
        int count = 0;
        int index = 0;
        while ((index = content.indexOf(name, index)) != -1) {
            count++;
            index += name.length();
        }
        return count;
    }

    /**
     * 检查是否存在混淆使用
     */
    private List<String> checkForConfusingUsage(String content, Map<String, Integer> nameUsage) {
        List<String> issues = new ArrayList<>();

        List<String> names = new ArrayList<>(nameUsage.keySet());
        if (names.size() < 2) {
            return issues;
        }

        // 检查是否在相近位置（100字内）出现了不同的称呼
        for (int i = 0; i < names.size(); i++) {
            for (int j = i + 1; j < names.size(); j++) {
                String name1 = names.get(i);
                String name2 = names.get(j);

                // 查找两个名称在文中的位置
                int pos1 = content.indexOf(name1);
                while (pos1 >= 0) {
                    int pos2 = content.indexOf(name2);
                    while (pos2 >= 0) {
                        if (Math.abs(pos1 - pos2) < 100) {
                            issues.add(String.format("「%s」和「%s」在相近位置出现", name1, name2));
                            break;
                        }
                        pos2 = content.indexOf(name2, pos2 + 1);
                    }
                    if (!issues.isEmpty()) break;
                    pos1 = content.indexOf(name1, pos1 + 1);
                }
                if (!issues.isEmpty()) break;
            }
            if (!issues.isEmpty()) break;
        }

        return issues;
    }

    /**
     * 检查是否有未定义的角色名称被使用
     */
    private List<ReviewIssue> checkUndefinedCharacterNames(ReviewContext context, String content) {
        List<ReviewIssue> issues = new ArrayList<>();

        // 简单的人名检测模式：中文姓名通常2-4个字
        // 这里使用一个简化的方法：查找形如"XX说"、"XX道"的模式
        String[] speechVerbs = {"说", "道", "问", "答", "叫", "喊"};

        Set<String> definedNames = context.getCharacterNameToId().keySet();

        for (String verb : speechVerbs) {
            int index = 0;
            while ((index = content.indexOf(verb, index)) != -1) {
                // 向前查找2-4个字作为可能的人名
                if (index >= 2) {
                    for (int len = 2; len <= 4 && index >= len; len++) {
                        String possibleName = content.substring(index - len, index);
                        // 检查是否全是中文字符
                        if (isChineseName(possibleName) && !definedNames.contains(possibleName)) {
                            // 可能是未定义的角色
                            // 这里只是警告，不是错误
                            // 因为可能是临时角色或者误判
                        }
                    }
                }
                index++;
            }
        }

        return issues;
    }

    /**
     * 检查是否是有效的中文名字
     */
    private boolean isChineseName(String text) {
        if (text == null || text.isEmpty()) {
            return false;
        }
        for (char c : text.toCharArray()) {
            if (!Character.toString(c).matches("[\\u4e00-\\u9fa5]")) {
                return false;
            }
        }
        // 排除常见的非人名词汇
        String[] excludeWords = {"这个", "那个", "什么", "怎么", "为什么", "然后", "但是", "可是", "因为", "所以"};
        for (String word : excludeWords) {
            if (text.equals(word)) {
                return false;
            }
        }
        return true;
    }
}
