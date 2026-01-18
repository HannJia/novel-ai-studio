package com.novelai.studio.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.novelai.studio.common.PageResult;
import com.novelai.studio.entity.KnowledgeFile;
import com.novelai.studio.mapper.KnowledgeFileMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

/**
 * 知识库文件服务
 */
@Service
public class KnowledgeFileService extends ServiceImpl<KnowledgeFileMapper, KnowledgeFile> {

    @Value("${app.upload.knowledge-path:${user.home}/.novel-ai-studio/uploads/knowledge}")
    private String uploadPath;

    /**
     * 支持的文件类型
     */
    private static final Set<String> SUPPORTED_TYPES = new HashSet<>(
            Arrays.asList("txt", "pdf", "docx", "epub", "md")
    );

    /**
     * 最大文件大小（10MB）
     */
    private static final long MAX_FILE_SIZE = 10 * 1024 * 1024;

    /**
     * 上传文件
     */
    public KnowledgeFile uploadFile(MultipartFile file, String bookId, String categoryId) throws IOException {
        // 验证文件
        validateFile(file);

        // 获取文件信息
        String originalName = file.getOriginalFilename();
        String fileType = getFileExtension(originalName);
        long fileSize = file.getSize();

        // 生成存储文件名
        String filename = UUID.randomUUID().toString() + "." + fileType;

        // 确定存储路径
        String subDir = bookId != null ? bookId : "global";
        Path dirPath = Paths.get(uploadPath, subDir);
        Files.createDirectories(dirPath);

        Path filePath = dirPath.resolve(filename);
        file.transferTo(filePath.toFile());

        // 创建数据库记录
        KnowledgeFile knowledgeFile = new KnowledgeFile();
        knowledgeFile.setBookId(bookId);
        knowledgeFile.setCategoryId(categoryId);
        knowledgeFile.setFilename(filename);
        knowledgeFile.setOriginalName(originalName);
        knowledgeFile.setFileType(fileType);
        knowledgeFile.setFileSize(fileSize);
        knowledgeFile.setFilePath(filePath.toString());
        knowledgeFile.setIsIndexed(false);
        knowledgeFile.setChunkCount(0);
        knowledgeFile.setTags(new ArrayList<>());

        save(knowledgeFile);
        return knowledgeFile;
    }

    /**
     * 获取书籍的所有文件
     */
    public List<KnowledgeFile> getFilesByBook(String bookId) {
        LambdaQueryWrapper<KnowledgeFile> wrapper = new LambdaQueryWrapper<>();
        if (bookId != null) {
            wrapper.eq(KnowledgeFile::getBookId, bookId);
        } else {
            wrapper.isNull(KnowledgeFile::getBookId);
        }
        wrapper.orderByDesc(KnowledgeFile::getCreatedAt);
        return list(wrapper);
    }

    /**
     * 按分类获取文件
     */
    public List<KnowledgeFile> getFilesByCategory(String bookId, String categoryId) {
        LambdaQueryWrapper<KnowledgeFile> wrapper = new LambdaQueryWrapper<>();
        if (bookId != null) {
            wrapper.eq(KnowledgeFile::getBookId, bookId);
        } else {
            wrapper.isNull(KnowledgeFile::getBookId);
        }
        if (categoryId != null) {
            wrapper.eq(KnowledgeFile::getCategoryId, categoryId);
        }
        wrapper.orderByDesc(KnowledgeFile::getCreatedAt);
        return list(wrapper);
    }

    /**
     * 分页获取文件
     */
    public PageResult<KnowledgeFile> getFilePage(String bookId, int page, int pageSize, String categoryId, Boolean isIndexed) {
        LambdaQueryWrapper<KnowledgeFile> wrapper = new LambdaQueryWrapper<>();
        if (bookId != null) {
            wrapper.eq(KnowledgeFile::getBookId, bookId);
        } else {
            wrapper.isNull(KnowledgeFile::getBookId);
        }

        if (categoryId != null && !categoryId.isEmpty()) {
            wrapper.eq(KnowledgeFile::getCategoryId, categoryId);
        }

        if (isIndexed != null) {
            wrapper.eq(KnowledgeFile::getIsIndexed, isIndexed);
        }

        wrapper.orderByDesc(KnowledgeFile::getCreatedAt);

        Page<KnowledgeFile> pageResult = page(new Page<>(page, pageSize), wrapper);
        return PageResult.of(
                pageResult.getRecords(),
                pageResult.getTotal(),
                page,
                pageSize
        );
    }

    /**
     * 删除文件
     */
    public void deleteFile(String id) throws IOException {
        KnowledgeFile file = getById(id);
        if (file != null) {
            // 删除物理文件
            Path filePath = Paths.get(file.getFilePath());
            Files.deleteIfExists(filePath);

            // 删除数据库记录
            removeById(id);
        }
    }

    /**
     * 更新索引状态
     */
    public KnowledgeFile updateIndexStatus(String id, boolean isIndexed, int chunkCount) {
        KnowledgeFile file = getById(id);
        if (file != null) {
            file.setIsIndexed(isIndexed);
            file.setChunkCount(chunkCount);
            updateById(file);
        }
        return file;
    }

    /**
     * 添加标签
     */
    public KnowledgeFile addTag(String id, String tag) {
        KnowledgeFile file = getById(id);
        if (file != null) {
            List<String> tags = file.getTags();
            if (tags == null) {
                tags = new ArrayList<>();
            }
            if (!tags.contains(tag)) {
                tags.add(tag);
                file.setTags(tags);
                updateById(file);
            }
        }
        return file;
    }

    /**
     * 移除标签
     */
    public KnowledgeFile removeTag(String id, String tag) {
        KnowledgeFile file = getById(id);
        if (file != null) {
            List<String> tags = file.getTags();
            if (tags != null) {
                tags.remove(tag);
                file.setTags(tags);
                updateById(file);
            }
        }
        return file;
    }

    /**
     * 读取文件内容
     */
    public String readFileContent(String id) throws IOException {
        KnowledgeFile file = getById(id);
        if (file == null) {
            throw new IOException("文件不存在");
        }

        Path filePath = Paths.get(file.getFilePath());
        if (!Files.exists(filePath)) {
            throw new IOException("文件不存在于磁盘");
        }

        // 根据文件类型读取
        String fileType = file.getFileType();
        if ("txt".equals(fileType) || "md".equals(fileType)) {
            return new String(Files.readAllBytes(filePath), "UTF-8");
        }

        // 其他类型暂时返回提示
        return "[暂不支持读取" + fileType + "格式文件内容]";
    }

    /**
     * 统计文件数量
     */
    public Map<String, Object> getFileStats(String bookId) {
        List<KnowledgeFile> files = getFilesByBook(bookId);
        Map<String, Object> stats = new HashMap<>();

        long totalSize = 0;
        int indexedCount = 0;
        Map<String, Integer> typeCount = new HashMap<>();

        for (KnowledgeFile file : files) {
            totalSize += file.getFileSize();
            if (Boolean.TRUE.equals(file.getIsIndexed())) {
                indexedCount++;
            }
            String type = file.getFileType();
            typeCount.put(type, typeCount.getOrDefault(type, 0) + 1);
        }

        stats.put("totalCount", files.size());
        stats.put("totalSize", totalSize);
        stats.put("indexedCount", indexedCount);
        stats.put("typeCount", typeCount);

        return stats;
    }

    /**
     * 验证文件
     */
    private void validateFile(MultipartFile file) {
        if (file.isEmpty()) {
            throw new IllegalArgumentException("文件不能为空");
        }

        if (file.getSize() > MAX_FILE_SIZE) {
            throw new IllegalArgumentException("文件大小不能超过10MB");
        }

        String extension = getFileExtension(file.getOriginalFilename());
        if (!SUPPORTED_TYPES.contains(extension.toLowerCase())) {
            throw new IllegalArgumentException("不支持的文件类型: " + extension);
        }
    }

    /**
     * 获取文件扩展名
     */
    private String getFileExtension(String filename) {
        if (filename == null || filename.isEmpty()) {
            return "";
        }
        int lastDot = filename.lastIndexOf('.');
        if (lastDot == -1) {
            return "";
        }
        return filename.substring(lastDot + 1).toLowerCase();
    }
}
