package com.novelai.studio.service.review;

import com.novelai.studio.entity.Book;
import com.novelai.studio.entity.Chapter;
import com.novelai.studio.entity.ChapterSummary;
import com.novelai.studio.entity.CharacterStateChange;
import com.novelai.studio.entity.Foreshadow;
import com.novelai.studio.entity.StoryEvent;
import com.novelai.studio.entity.WorldSetting;
import lombok.Data;
import lombok.Builder;
import java.util.List;
import java.util.Map;

/**
 * 规则执行上下文
 * 包含审查规则所需的所有数据
 */
@Data
@Builder
public class ReviewContext {

    /**
     * 书籍信息
     */
    private Book book;

    /**
     * 当前审查的章节
     */
    private Chapter currentChapter;

    /**
     * 书籍的所有章节（按顺序）
     */
    private List<Chapter> allChapters;

    /**
     * 书籍的所有角色
     */
    private List<com.novelai.studio.entity.Character> characters;

    /**
     * 书籍的世界观设定
     */
    private List<WorldSetting> worldSettings;

    /**
     * 书籍的伏笔
     */
    private List<Foreshadow> foreshadows;

    /**
     * 书籍的故事事件
     */
    private List<StoryEvent> storyEvents;

    /**
     * 角色状态变更历史
     */
    private List<CharacterStateChange> characterStateChanges;

    /**
     * 章节摘要
     */
    private List<ChapterSummary> chapterSummaries;

    /**
     * 角色名称到ID的映射（包括别名）
     */
    private Map<String, String> characterNameToId;

    /**
     * 角色ID到角色信息的映射
     */
    private Map<String, com.novelai.studio.entity.Character> characterById;

    /**
     * 审查模式：single（单章节）、batch（批量）、full（全书）
     */
    @Builder.Default
    private String reviewMode = "single";
}
