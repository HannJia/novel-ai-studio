package com.novelai.studio.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.novelai.studio.entity.Volume;
import com.novelai.studio.mapper.VolumeMapper;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 卷服务
 */
@Service
public class VolumeService extends ServiceImpl<VolumeMapper, Volume> {

    /**
     * 获取书籍的所有卷
     */
    public List<Volume> getVolumesByBookId(String bookId) {
        LambdaQueryWrapper<Volume> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Volume::getBookId, bookId)
               .orderByAsc(Volume::getOrderNum);
        return list(wrapper);
    }

    /**
     * 创建卷
     */
    public Volume createVolume(Volume volume) {
        // 获取当前最大排序号
        Integer maxOrder = getMaxOrderNum(volume.getBookId());
        volume.setOrderNum(maxOrder + 1);
        volume.setWordCount(0);
        volume.setChapterCount(0);
        save(volume);
        return volume;
    }

    /**
     * 更新卷
     */
    public Volume updateVolume(String id, Volume volume) {
        volume.setId(id);
        updateById(volume);
        return getById(id);
    }

    /**
     * 删除卷
     */
    public void deleteVolume(String id) {
        removeById(id);
    }

    /**
     * 获取最大排序号
     */
    private Integer getMaxOrderNum(String bookId) {
        LambdaQueryWrapper<Volume> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Volume::getBookId, bookId)
               .orderByDesc(Volume::getOrderNum)
               .last("LIMIT 1");
        Volume volume = getOne(wrapper);
        return volume != null ? volume.getOrderNum() : 0;
    }

    /**
     * 更新卷的统计信息
     */
    public void updateVolumeStats(String volumeId, int wordCount, int chapterCount) {
        Volume volume = new Volume();
        volume.setId(volumeId);
        volume.setWordCount(wordCount);
        volume.setChapterCount(chapterCount);
        updateById(volume);
    }

    /**
     * 调整卷顺序
     */
    public void reorderVolumes(String bookId, List<String> volumeIds) {
        for (int i = 0; i < volumeIds.size(); i++) {
            Volume volume = new Volume();
            volume.setId(volumeIds.get(i));
            volume.setOrderNum(i + 1);
            updateById(volume);
        }
    }
}
