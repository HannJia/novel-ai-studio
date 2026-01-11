package com.novelai.studio.controller;

import com.novelai.studio.common.PageResult;
import com.novelai.studio.common.Result;
import com.novelai.studio.entity.Book;
import com.novelai.studio.service.BookService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 书籍控制器
 */
@RestController
@RequestMapping("/api/books")
public class BookController {

    @Autowired
    private BookService bookService;

    /**
     * 获取书籍列表
     */
    @GetMapping
    public Result<List<Book>> getBooks() {
        List<Book> books = bookService.getBookList();
        return Result.success(books);
    }

    /**
     * 分页获取书籍列表
     */
    @GetMapping("/page")
    public Result<PageResult<Book>> getBookPage(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int pageSize,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String genre) {
        PageResult<Book> result = bookService.getBookPage(page, pageSize, status, genre);
        return Result.success(result);
    }

    /**
     * 获取书籍详情
     */
    @GetMapping("/{id}")
    public Result<Book> getBook(@PathVariable String id) {
        Book book = bookService.getById(id);
        if (book == null) {
            return Result.notFound("书籍不存在");
        }
        return Result.success(book);
    }

    /**
     * 创建书籍
     */
    @PostMapping
    public Result<Book> createBook(@RequestBody Book book) {
        if (book.getTitle() == null || book.getTitle().isEmpty()) {
            return Result.badRequest("书名不能为空");
        }
        if (book.getGenre() == null || book.getGenre().isEmpty()) {
            return Result.badRequest("类型不能为空");
        }
        if (book.getStyle() == null || book.getStyle().isEmpty()) {
            return Result.badRequest("风格不能为空");
        }

        Book created = bookService.createBook(book);
        return Result.success(created);
    }

    /**
     * 更新书籍
     */
    @PutMapping("/{id}")
    public Result<Book> updateBook(@PathVariable String id, @RequestBody Book book) {
        Book existing = bookService.getById(id);
        if (existing == null) {
            return Result.notFound("书籍不存在");
        }

        Book updated = bookService.updateBook(id, book);
        return Result.success(updated);
    }

    /**
     * 删除书籍
     */
    @DeleteMapping("/{id}")
    public Result<Void> deleteBook(@PathVariable String id) {
        Book existing = bookService.getById(id);
        if (existing == null) {
            return Result.notFound("书籍不存在");
        }

        bookService.removeById(id);
        return Result.success();
    }
}
