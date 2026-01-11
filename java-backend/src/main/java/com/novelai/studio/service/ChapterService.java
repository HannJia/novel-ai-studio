package com.novelai.studio.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.novelai.studio.entity.Chapter;
import com.novelai.studio.mapper.ChapterMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 章节服务
 */
@Service
public class ChapterService extends ServiceImpl<ChapterMapper, Chapter> {

    @Autowired
    private BookService bookService;

    /**
     * 获取书籍的所有章节
     */
    public List<Chapter> getChaptersByBook(String bookId) {
        LambdaQueryWrapper<Chapter> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Chapter::getBookId, bookId);
        wrapper.orderByAsc(Chapter::getOrderNum);
        return list(wrapper);
    }

    /**
     * 获取卷的所有章节
     */
    public List<Chapter> getChaptersByVolume(String volumeId) {
        LambdaQueryWrapper<Chapter> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Chapter::getVolumeId, volumeId);
        wrapper.orderByAsc(Chapter::getOrderNum);
        return list(wrapper);
    }

    /**
     * 创建章节
     */
    public Chapter createChapter(Chapter chapter) {
        // 获取最大序号
        LambdaQueryWrapper<Chapter> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Chapter::getBookId, chapter.getBookId());
        wrapper.orderByDesc(Chapter::getOrderNum);
        wrapper.last("LIMIT 1");
        Chapter lastChapter = getOne(wrapper);

        int nextOrder = lastChapter != null ? lastChapter.getOrderNum() + 1 : 1;
        chapter.setOrderNum(nextOrder);

        if (chapter.getStatus() == null) {
            chapter.setStatus("draft");
        }
        if (chapter.getWordCount() == null) {
            chapter.setWordCount(0);
        }

        save(chapter);
        updateBookStats(chapter.getBookId());
        return chapter;
    }

    /**
     * 更新章节
     */
    public Chapter updateChapter(String id, Chapter chapter) {
        Chapter existing = getById(id);
        if (existing == null) {
            return null;
        }

        chapter.setId(id);
        updateById(chapter);

        // 如果字数变化，更新书籍统计
        if (chapter.getWordCount() != null) {
            updateBookStats(existing.getBookId());
        }

        return getById(id);
    }

    /**
     * 删除章节
     */
    public boolean deleteChapter(String id) {
        Chapter chapter = getById(id);
        if (chapter == null) {
            return false;
        }

        boolean result = removeById(id);
        if (result) {
            updateBookStats(chapter.getBookId());
        }
        return result;
    }

    /**
     * 更新书籍统计信息
     */
    private void updateBookStats(String bookId) {
        List<Chapter> chapters = getChaptersByBook(bookId);
        int totalWordCount = chapters.stream()
                .mapToInt(ch -> ch.getWordCount() != null ? ch.getWordCount() : 0)
                .sum();
        bookService.updateWordCount(bookId, totalWordCount, chapters.size());
    }

    /**
     * 重新排序章节
     */
    public void reorderChapters(String bookId, List<String> chapterIds) {
        for (int i = 0; i < chapterIds.size(); i++) {
            Chapter chapter = new Chapter();
            chapter.setId(chapterIds.get(i));
            chapter.setOrderNum(i + 1);
            updateById(chapter);
        }
    }
}
