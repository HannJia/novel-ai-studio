package com.novelai.studio.controller;

import com.novelai.studio.common.PageResult;
import com.novelai.studio.common.Result;
import com.novelai.studio.entity.KnowledgeFile;
import com.novelai.studio.service.KnowledgeFileService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * 知识库文件控制器
 */
@RestController
@RequestMapping("/api/knowledge/files")
public class KnowledgeFileController {

    @Autowired
    private KnowledgeFileService knowledgeFileService;

    /**
     * 上传文件
     */
    @PostMapping("/upload")
    public Result<KnowledgeFile> uploadFile(
            @RequestParam("file") MultipartFile file,
            @RequestParam(required = false) String bookId,
            @RequestParam(required = false) String categoryId) {
        try {
            KnowledgeFile uploaded = knowledgeFileService.uploadFile(file, bookId, categoryId);
            return Result.success(uploaded);
        } catch (IllegalArgumentException e) {
            return Result.badRequest(e.getMessage());
        } catch (IOException e) {
            return Result.error("文件上传失败: " + e.getMessage());
        }
    }

    /**
     * 获取书籍的所有文件
     */
    @GetMapping("/book/{bookId}")
    public Result<List<KnowledgeFile>> getFilesByBook(@PathVariable String bookId) {
        String bid = "global".equals(bookId) ? null : bookId;
        List<KnowledgeFile> files = knowledgeFileService.getFilesByBook(bid);
        return Result.success(files);
    }

    /**
     * 获取全局知识库文件
     */
    @GetMapping("/global")
    public Result<List<KnowledgeFile>> getGlobalFiles() {
        List<KnowledgeFile> files = knowledgeFileService.getFilesByBook(null);
        return Result.success(files);
    }

    /**
     * 按分类获取文件
     */
    @GetMapping("/book/{bookId}/category/{categoryId}")
    public Result<List<KnowledgeFile>> getFilesByCategory(
            @PathVariable String bookId,
            @PathVariable String categoryId) {
        String bid = "global".equals(bookId) ? null : bookId;
        List<KnowledgeFile> files = knowledgeFileService.getFilesByCategory(bid, categoryId);
        return Result.success(files);
    }

    /**
     * 分页获取文件
     */
    @GetMapping("/book/{bookId}/page")
    public Result<PageResult<KnowledgeFile>> getFilePage(
            @PathVariable String bookId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int pageSize,
            @RequestParam(required = false) String categoryId,
            @RequestParam(required = false) Boolean isIndexed) {
        String bid = "global".equals(bookId) ? null : bookId;
        PageResult<KnowledgeFile> result = knowledgeFileService.getFilePage(bid, page, pageSize, categoryId, isIndexed);
        return Result.success(result);
    }

    /**
     * 获取文件详情
     */
    @GetMapping("/{id}")
    public Result<KnowledgeFile> getFile(@PathVariable String id) {
        KnowledgeFile file = knowledgeFileService.getById(id);
        if (file == null) {
            return Result.notFound("文件不存在");
        }
        return Result.success(file);
    }

    /**
     * 删除文件
     */
    @DeleteMapping("/{id}")
    public Result<Void> deleteFile(@PathVariable String id) {
        try {
            KnowledgeFile existing = knowledgeFileService.getById(id);
            if (existing == null) {
                return Result.notFound("文件不存在");
            }
            knowledgeFileService.deleteFile(id);
            return Result.success();
        } catch (IOException e) {
            return Result.error("删除文件失败: " + e.getMessage());
        }
    }

    /**
     * 读取文件内容
     */
    @GetMapping("/{id}/content")
    public Result<String> getFileContent(@PathVariable String id) {
        try {
            String content = knowledgeFileService.readFileContent(id);
            return Result.success(content);
        } catch (IOException e) {
            return Result.error("读取文件失败: " + e.getMessage());
        }
    }

    /**
     * 添加标签
     */
    @PostMapping("/{id}/tag")
    public Result<KnowledgeFile> addTag(
            @PathVariable String id,
            @RequestBody Map<String, String> request) {
        KnowledgeFile existing = knowledgeFileService.getById(id);
        if (existing == null) {
            return Result.notFound("文件不存在");
        }

        String tag = request.get("tag");
        if (tag == null || tag.isEmpty()) {
            return Result.badRequest("标签不能为空");
        }

        KnowledgeFile updated = knowledgeFileService.addTag(id, tag);
        return Result.success(updated);
    }

    /**
     * 移除标签
     */
    @DeleteMapping("/{id}/tag/{tag}")
    public Result<KnowledgeFile> removeTag(
            @PathVariable String id,
            @PathVariable String tag) {
        KnowledgeFile existing = knowledgeFileService.getById(id);
        if (existing == null) {
            return Result.notFound("文件不存在");
        }

        KnowledgeFile updated = knowledgeFileService.removeTag(id, tag);
        return Result.success(updated);
    }

    /**
     * 获取文件统计
     */
    @GetMapping("/book/{bookId}/stats")
    public Result<Map<String, Object>> getFileStats(@PathVariable String bookId) {
        String bid = "global".equals(bookId) ? null : bookId;
        Map<String, Object> stats = knowledgeFileService.getFileStats(bid);
        return Result.success(stats);
    }
}
