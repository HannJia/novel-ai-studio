package com.novelai.studio.controller;

import com.novelai.studio.common.Result;
import com.novelai.studio.entity.Book;
import com.novelai.studio.service.BookService;
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
 * BookController 单元测试
 */
@ExtendWith(MockitoExtension.class)
class BookControllerTest {

    @Mock
    private BookService bookService;

    @InjectMocks
    private BookController bookController;

    private Book testBook;

    @BeforeEach
    void setUp() {
        testBook = new Book();
        testBook.setId("book-1");
        testBook.setTitle("测试书籍");
        testBook.setAuthor("测试作者");
        testBook.setGenre("fantasy");
        testBook.setStyle("轻松");
        testBook.setStatus("writing");
    }

    @Test
    void getBooks_ShouldReturnAllBooks() {
        // Arrange
        List<Book> books = Arrays.asList(testBook);
        when(bookService.getBookList()).thenReturn(books);

        // Act
        Result<List<Book>> result = bookController.getBooks();

        // Assert
        assertNotNull(result);
        assertEquals(200, result.getCode());
        assertEquals(1, result.getData().size());
    }

    @Test
    void getBook_WhenBookExists_ShouldReturnBook() {
        // Arrange
        when(bookService.getById("book-1")).thenReturn(testBook);

        // Act
        Result<Book> result = bookController.getBook("book-1");

        // Assert
        assertNotNull(result);
        assertEquals(200, result.getCode());
        assertEquals("测试书籍", result.getData().getTitle());
    }

    @Test
    void getBook_WhenBookNotExists_ShouldReturn404() {
        // Arrange
        when(bookService.getById("not-exist")).thenReturn(null);

        // Act
        Result<Book> result = bookController.getBook("not-exist");

        // Assert
        assertNotNull(result);
        assertEquals(404, result.getCode());
    }

    @Test
    void createBook_WhenTitleIsEmpty_ShouldReturnBadRequest() {
        // Arrange
        Book invalidBook = new Book();
        invalidBook.setTitle("");
        invalidBook.setGenre("fantasy");
        invalidBook.setStyle("轻松");

        // Act
        Result<Book> result = bookController.createBook(invalidBook);

        // Assert
        assertEquals(400, result.getCode());
    }

    @Test
    void createBook_WhenGenreIsEmpty_ShouldReturnBadRequest() {
        // Arrange
        Book invalidBook = new Book();
        invalidBook.setTitle("有效标题");
        invalidBook.setGenre("");
        invalidBook.setStyle("轻松");

        // Act
        Result<Book> result = bookController.createBook(invalidBook);

        // Assert
        assertEquals(400, result.getCode());
    }

    @Test
    void createBook_WhenValid_ShouldReturnCreatedBook() {
        // Arrange
        when(bookService.createBook(any(Book.class))).thenReturn(testBook);

        // Act
        Result<Book> result = bookController.createBook(testBook);

        // Assert
        assertEquals(200, result.getCode());
        assertNotNull(result.getData());
    }

    @Test
    void deleteBook_WhenBookExists_ShouldReturnSuccess() {
        // Arrange
        when(bookService.getById("book-1")).thenReturn(testBook);
        when(bookService.removeById("book-1")).thenReturn(true);

        // Act
        Result<Void> result = bookController.deleteBook("book-1");

        // Assert
        assertEquals(200, result.getCode());
    }

    @Test
    void deleteBook_WhenBookNotExists_ShouldReturn404() {
        // Arrange
        when(bookService.getById("not-exist")).thenReturn(null);

        // Act
        Result<Void> result = bookController.deleteBook("not-exist");

        // Assert
        assertEquals(404, result.getCode());
    }
}
