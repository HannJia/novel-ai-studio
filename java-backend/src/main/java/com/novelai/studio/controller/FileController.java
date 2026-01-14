package com.novelai.studio.controller;

import com.novelai.studio.common.Result;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.net.MalformedURLException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Map;
import java.util.UUID;

/**
 * 文件上传控制器
 */
@RestController
@RequestMapping("/api/files")
public class FileController {

    @Value("${upload.path}")
    private String uploadPath;

    @Value("${upload.cover-path}")
    private String coverPath;

    private Path coverStoragePath;

    @PostConstruct
    public void init() {
        try {
            coverStoragePath = Paths.get(uploadPath, coverPath).toAbsolutePath().normalize();
            Files.createDirectories(coverStoragePath);
        } catch (IOException e) {
            throw new RuntimeException("无法创建上传目录", e);
        }
    }

    /**
     * 上传书籍封面
     */
    @PostMapping("/cover")
    public Result<Map<String, String>> uploadCover(@RequestParam("file") MultipartFile file) {
        if (file.isEmpty()) {
            return Result.badRequest("请选择要上传的文件");
        }

        // 验证文件类型
        String contentType = file.getContentType();
        if (contentType == null || !contentType.startsWith("image/")) {
            return Result.badRequest("只支持上传图片文件");
        }

        // 验证文件大小（最大5MB）
        if (file.getSize() > 5 * 1024 * 1024) {
            return Result.badRequest("文件大小不能超过5MB");
        }

        try {
            // 生成唯一文件名
            String originalFilename = file.getOriginalFilename();
            String extension = "";
            if (originalFilename != null && originalFilename.contains(".")) {
                extension = originalFilename.substring(originalFilename.lastIndexOf("."));
            }
            String newFilename = UUID.randomUUID().toString() + extension;

            // 保存文件
            Path targetPath = coverStoragePath.resolve(newFilename);
            Files.copy(file.getInputStream(), targetPath, StandardCopyOption.REPLACE_EXISTING);

            // 返回访问URL
            String fileUrl = "/api/files/cover/" + newFilename;
            return Result.success(Map.of(
                "url", fileUrl,
                "filename", newFilename
            ));
        } catch (IOException e) {
            return Result.error("文件上传失败: " + e.getMessage());
        }
    }

    /**
     * 获取书籍封面
     */
    @GetMapping("/cover/{filename}")
    public ResponseEntity<Resource> getCover(@PathVariable String filename) {
        try {
            Path filePath = coverStoragePath.resolve(filename).normalize();
            Resource resource = new UrlResource(filePath.toUri());

            if (resource.exists() && resource.isReadable()) {
                // 确定Content-Type
                String contentType = Files.probeContentType(filePath);
                if (contentType == null) {
                    contentType = "application/octet-stream";
                }

                return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(contentType))
                    .header(HttpHeaders.CACHE_CONTROL, "max-age=86400")
                    .body(resource);
            } else {
                return ResponseEntity.notFound().build();
            }
        } catch (MalformedURLException e) {
            return ResponseEntity.badRequest().build();
        } catch (IOException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    /**
     * 删除书籍封面
     */
    @DeleteMapping("/cover/{filename}")
    public Result<Void> deleteCover(@PathVariable String filename) {
        try {
            Path filePath = coverStoragePath.resolve(filename).normalize();

            // 安全检查：确保文件在允许的目录内
            if (!filePath.startsWith(coverStoragePath)) {
                return Result.badRequest("非法的文件路径");
            }

            if (Files.exists(filePath)) {
                Files.delete(filePath);
            }
            return Result.success();
        } catch (IOException e) {
            return Result.error("删除文件失败: " + e.getMessage());
        }
    }
}
