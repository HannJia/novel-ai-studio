package com.novelai.studio.service.review.rules;

import com.novelai.studio.entity.Chapter;
import com.novelai.studio.entity.ReviewIssue;
import com.novelai.studio.entity.Book;
import com.novelai.studio.service.review.ReviewContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * TimelineConflictRule 单元测试
 */
class TimelineConflictRuleTest {

    private TimelineConflictRule rule;
    private Book testBook;

    @BeforeEach
    void setUp() {
        rule = new TimelineConflictRule();

        testBook = new Book();
        testBook.setId("book-1");
        testBook.setTitle("测试书籍");
    }

    @Test
    void check_WhenChapterIsNull_ShouldReturnNoIssues() {
        // Arrange
        ReviewContext context = ReviewContext.builder()
                .book(testBook)
                .currentChapter(null)
                .build();

        // Act
        List<ReviewIssue> issues = rule.check(context);

        // Assert
        assertTrue(issues.isEmpty());
    }

    @Test
    void check_WhenContentIsEmpty_ShouldReturnNoIssues() {
        // Arrange
        Chapter chapter = new Chapter();
        chapter.setId("chapter-1");
        chapter.setContent("");

        ReviewContext context = ReviewContext.builder()
                .book(testBook)
                .currentChapter(chapter)
                .build();

        // Act
        List<ReviewIssue> issues = rule.check(context);

        // Assert
        assertTrue(issues.isEmpty());
    }

    @Test
    void check_WhenNoEvents_ShouldReturnNoIssues() {
        // Arrange
        Chapter chapter = new Chapter();
        chapter.setId("chapter-1");
        chapter.setContent("这是一段正常的内容，没有时间冲突。");
        chapter.setOrderNum(2);

        ReviewContext context = ReviewContext.builder()
                .book(testBook)
                .currentChapter(chapter)
                .storyEvents(Arrays.asList())
                .build();

        // Act
        List<ReviewIssue> issues = rule.check(context);

        // Assert
        assertTrue(issues.isEmpty());
    }

    @Test
    void getRuleName_ShouldReturnCorrectName() {
        assertEquals("timeline_conflict", rule.getName());
    }

    @Test
    void getRuleLevel_ShouldReturnError() {
        assertEquals("error", rule.getLevel());
    }

    @Test
    void isEnabled_ShouldReturnTrueByDefault() {
        assertTrue(rule.isEnabled());
    }
}
