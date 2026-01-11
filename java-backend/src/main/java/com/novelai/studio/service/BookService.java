package com.novelai.studio.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.novelai.studio.common.PageResult;
import com.novelai.studio.entity.Book;
import com.novelai.studio.mapper.BookMapper;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 书籍服务
 */
@Service
public class BookService extends ServiceImpl<BookMapper, Book> {

    /**
     * 获取书籍列表
     */
    public List<Book> getBookList() {
        LambdaQueryWrapper<Book> wrapper = new LambdaQueryWrapper<>();
        wrapper.orderByDesc(Book::getUpdatedAt);
        return list(wrapper);
    }

    /**
     * 分页获取书籍列表
     */
    public PageResult<Book> getBookPage(int page, int pageSize, String status, String genre) {
        LambdaQueryWrapper<Book> wrapper = new LambdaQueryWrapper<>();

        if (status != null && !status.isEmpty()) {
            wrapper.eq(Book::getStatus, status);
        }
        if (genre != null && !genre.isEmpty()) {
            wrapper.eq(Book::getGenre, genre);
        }

        wrapper.orderByDesc(Book::getUpdatedAt);

        Page<Book> pageResult = page(new Page<>(page, pageSize), wrapper);
        return PageResult.of(
                pageResult.getRecords(),
                pageResult.getTotal(),
                page,
                pageSize
        );
    }

    /**
     * 创建书籍
     */
    public Book createBook(Book book) {
        book.setWordCount(0);
        book.setChapterCount(0);
        if (book.getStatus() == null) {
            book.setStatus("writing");
        }
        save(book);
        return book;
    }

    /**
     * 更新书籍
     */
    public Book updateBook(String id, Book book) {
        book.setId(id);
        updateById(book);
        return getById(id);
    }

    /**
     * 更新字数统计
     */
    public void updateWordCount(String id, int wordCount, int chapterCount) {
        Book book = new Book();
        book.setId(id);
        book.setWordCount(wordCount);
        book.setChapterCount(chapterCount);
        updateById(book);
    }
}
