package com.novelai.studio.service;

import com.novelai.studio.entity.Book;
import com.novelai.studio.mapper.BookMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * BookService 单元测试
 */
@ExtendWith(MockitoExtension.class)
class BookServiceTest {

    @Mock
    private BookMapper bookMapper;

    @InjectMocks
    private BookService bookService;

    private Book testBook;

    @BeforeEach
    void setUp() {
        testBook = new Book();
        testBook.setId("test-book-id");
        testBook.setTitle("测试书籍");
        testBook.setAuthor("测试作者");
        testBook.setGenre("fantasy");
        testBook.setStyle("轻松");
        testBook.setStatus("writing");
        testBook.setWordCount(0);
        testBook.setChapterCount(0);
    }

    @Test
    void createBook_ShouldSetDefaultValues() {
        // Arrange
        Book newBook = new Book();
        newBook.setTitle("新书");
        newBook.setGenre("fantasy");
        newBook.setStyle("轻松");

        when(bookMapper.insert(any(Book.class))).thenReturn(1);

        // Act
        Book created = bookService.createBook(newBook);

        // Assert
        assertNotNull(created);
        assertEquals(0, created.getWordCount());
        assertEquals(0, created.getChapterCount());
        assertEquals("writing", created.getStatus());
        verify(bookMapper, times(1)).insert(any(Book.class));
    }

    @Test
    void createBook_ShouldKeepExistingStatus() {
        // Arrange
        Book newBook = new Book();
        newBook.setTitle("新书");
        newBook.setGenre("fantasy");
        newBook.setStyle("轻松");
        newBook.setStatus("completed");

        when(bookMapper.insert(any(Book.class))).thenReturn(1);

        // Act
        Book created = bookService.createBook(newBook);

        // Assert
        assertEquals("completed", created.getStatus());
    }

    @Test
    void updateWordCount_ShouldUpdateCorrectly() {
        // Arrange
        String bookId = "test-id";
        int wordCount = 10000;
        int chapterCount = 5;

        when(bookMapper.updateById(any(Book.class))).thenReturn(1);

        // Act
        bookService.updateWordCount(bookId, wordCount, chapterCount);

        // Assert
        verify(bookMapper, times(1)).updateById(any(Book.class));
    }
}
