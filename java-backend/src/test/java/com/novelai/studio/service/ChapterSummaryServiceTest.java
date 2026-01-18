package com.novelai.studio.service;

import com.novelai.studio.entity.Chapter;
import com.novelai.studio.entity.ChapterSummary;
import com.novelai.studio.mapper.ChapterSummaryMapper;
import com.novelai.studio.service.ai.AIService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * ChapterSummaryService 单元测试
 */
@ExtendWith(MockitoExtension.class)
class ChapterSummaryServiceTest {

    @Mock
    private ChapterSummaryMapper chapterSummaryMapper;

    @Mock
    private ChapterService chapterService;

    @Mock
    private AIService aiService;

    @InjectMocks
    private ChapterSummaryService chapterSummaryService;

    private Chapter testChapter;
    private ChapterSummary testSummary;

    @BeforeEach
    void setUp() {
        testChapter = new Chapter();
        testChapter.setId("chapter-1");
        testChapter.setBookId("book-1");
        testChapter.setTitle("第一章");
        testChapter.setContent("这是测试内容，主角张三进入了一个神秘的森林。");
        testChapter.setOrderNum(1);

        testSummary = new ChapterSummary();
        testSummary.setId("summary-1");
        testSummary.setChapterId("chapter-1");
        testSummary.setBookId("book-1");
        testSummary.setSummary("主角进入神秘森林");
        testSummary.setKeyEvents(Arrays.asList("进入森林"));
        testSummary.setCharactersAppeared(Arrays.asList("张三"));
        testSummary.setEmotionalTone("神秘");
    }

    @Test
    void getByChapterId_ShouldReturnSummary() {
        // Arrange
        when(chapterSummaryMapper.selectByChapterId("chapter-1")).thenReturn(testSummary);

        // Act
        ChapterSummary result = chapterSummaryService.getByChapterId("chapter-1");

        // Assert
        assertNotNull(result);
        assertEquals("summary-1", result.getId());
        assertEquals("主角进入神秘森林", result.getSummary());
    }

    @Test
    void getBeforeChapter_ShouldReturnSummariesInOrder() {
        // Arrange
        List<ChapterSummary> summaries = Arrays.asList(testSummary);
        when(chapterSummaryMapper.selectBeforeChapter("book-1", 2)).thenReturn(summaries);

        // Act
        List<ChapterSummary> result = chapterSummaryService.getBeforeChapter("book-1", 2);

        // Assert
        assertNotNull(result);
        assertEquals(1, result.size());
    }

    @Test
    void generateSummary_WhenChapterIsEmpty_ShouldReturnNull() {
        // Arrange
        Chapter emptyChapter = new Chapter();
        emptyChapter.setId("chapter-empty");
        emptyChapter.setContent("");
        when(chapterService.getById("chapter-empty")).thenReturn(emptyChapter);

        // Act
        ChapterSummary result = chapterSummaryService.generateSummary("chapter-empty");

        // Assert
        assertNull(result);
    }

    @Test
    void generateSummary_WhenChapterNotFound_ShouldReturnNull() {
        // Arrange
        when(chapterService.getById("not-exist")).thenReturn(null);

        // Act
        ChapterSummary result = chapterSummaryService.generateSummary("not-exist");

        // Assert
        assertNull(result);
    }

    @Test
    void buildPreviousContext_WhenNoSummaries_ShouldReturnEmpty() {
        // Arrange
        when(chapterSummaryMapper.selectBeforeChapter("book-1", 1)).thenReturn(Arrays.asList());

        // Act
        String context = chapterSummaryService.buildPreviousContext("book-1", 1, 5);

        // Assert
        assertEquals("", context);
    }

    @Test
    void buildPreviousContext_ShouldLimitSummaries() {
        // Arrange
        ChapterSummary s1 = new ChapterSummary();
        s1.setChapterOrder(1);
        s1.setSummary("第一章摘要");

        ChapterSummary s2 = new ChapterSummary();
        s2.setChapterOrder(2);
        s2.setSummary("第二章摘要");

        List<ChapterSummary> summaries = Arrays.asList(s1, s2);
        when(chapterSummaryMapper.selectBeforeChapter("book-1", 3)).thenReturn(summaries);

        // Act
        String context = chapterSummaryService.buildPreviousContext("book-1", 3, 10);

        // Assert
        assertNotNull(context);
        assertTrue(context.contains("第一章"));
        assertTrue(context.contains("第二章"));
    }
}
