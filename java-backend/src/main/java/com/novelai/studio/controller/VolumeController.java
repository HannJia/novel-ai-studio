package com.novelai.studio.controller;

import com.novelai.studio.common.Result;
import com.novelai.studio.entity.Volume;
import com.novelai.studio.service.VolumeService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 卷控制器
 */
@RestController
@RequestMapping("/api/books/{bookId}/volumes")
public class VolumeController {

    @Autowired
    private VolumeService volumeService;

    /**
     * 获取书籍的所有卷
     */
    @GetMapping
    public Result<List<Volume>> getVolumes(@PathVariable String bookId) {
        List<Volume> volumes = volumeService.getVolumesByBookId(bookId);
        return Result.success(volumes);
    }

    /**
     * 获取卷详情
     */
    @GetMapping("/{id}")
    public Result<Volume> getVolume(@PathVariable String bookId, @PathVariable String id) {
        Volume volume = volumeService.getById(id);
        if (volume == null) {
            return Result.notFound("卷不存在");
        }
        return Result.success(volume);
    }

    /**
     * 创建卷
     */
    @PostMapping
    public Result<Volume> createVolume(@PathVariable String bookId, @RequestBody Volume volume) {
        if (volume.getTitle() == null || volume.getTitle().isEmpty()) {
            return Result.badRequest("卷名不能为空");
        }

        volume.setBookId(bookId);
        Volume created = volumeService.createVolume(volume);
        return Result.success(created);
    }

    /**
     * 更新卷
     */
    @PutMapping("/{id}")
    public Result<Volume> updateVolume(@PathVariable String bookId, @PathVariable String id, @RequestBody Volume volume) {
        Volume existing = volumeService.getById(id);
        if (existing == null) {
            return Result.notFound("卷不存在");
        }

        Volume updated = volumeService.updateVolume(id, volume);
        return Result.success(updated);
    }

    /**
     * 删除卷
     */
    @DeleteMapping("/{id}")
    public Result<Void> deleteVolume(@PathVariable String bookId, @PathVariable String id) {
        Volume existing = volumeService.getById(id);
        if (existing == null) {
            return Result.notFound("卷不存在");
        }

        volumeService.deleteVolume(id);
        return Result.success();
    }

    /**
     * 调整卷顺序
     */
    @PutMapping("/reorder")
    public Result<Void> reorderVolumes(@PathVariable String bookId, @RequestBody List<String> volumeIds) {
        volumeService.reorderVolumes(bookId, volumeIds);
        return Result.success();
    }
}
