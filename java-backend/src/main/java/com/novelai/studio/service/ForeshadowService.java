package com.novelai.studio.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.novelai.studio.entity.Foreshadow;
import com.novelai.studio.mapper.ForeshadowMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 伏笔服务
 */
@Service
public class ForeshadowService extends ServiceImpl<ForeshadowMapper, Foreshadow> {

    @Autowired
    private ForeshadowMapper foreshadowMapper;

    /**
     * 获取书籍的所有伏笔
     */
    public List<Foreshadow> getByBookId(String bookId) {
        return foreshadowMapper.selectByBookId(bookId);
    }

    /**
     * 按状态获取书籍的伏笔
     */
    public List<Foreshadow> getByBookIdAndStatus(String bookId, String status) {
        return foreshadowMapper.selectByBookIdAndStatus(bookId, status);
    }

    /**
     * 获取未回收的伏笔
     */
    public List<Foreshadow> getUnresolved(String bookId) {
        return foreshadowMapper.selectUnresolvedByBookId(bookId);
    }

    /**
     * 获取章节中埋设的伏笔
     */
    public List<Foreshadow> getByPlantedChapter(String chapterId) {
        return foreshadowMapper.selectByPlantedChapter(chapterId);
    }

    /**
     * 获取重要的未回收伏笔
     */
    public List<Foreshadow> getMajorUnresolved(String bookId) {
        return foreshadowMapper.selectMajorUnresolved(bookId);
    }

    /**
     * 获取与角色相关的伏笔
     */
    public List<Foreshadow> getByCharacter(String bookId, String characterId) {
        return foreshadowMapper.selectByCharacter(bookId, characterId);
    }

    /**
     * 创建伏笔
     */
    public Foreshadow createForeshadow(Foreshadow foreshadow) {
        if (foreshadow.getStatus() == null) {
            foreshadow.setStatus("planted");
        }
        if (foreshadow.getImportance() == null) {
            foreshadow.setImportance("minor");
        }
        if (foreshadow.getSource() == null) {
            foreshadow.setSource("manual");
        }
        save(foreshadow);
        return foreshadow;
    }

    /**
     * 更新伏笔状态
     */
    public Foreshadow updateStatus(String id, String status, String resolutionNotes) {
        Foreshadow foreshadow = getById(id);
        if (foreshadow == null) {
            return null;
        }

        foreshadow.setStatus(status);
        if (resolutionNotes != null) {
            foreshadow.setResolutionNotes(resolutionNotes);
        }
        updateById(foreshadow);
        return foreshadow;
    }

    /**
     * 添加回收章节
     */
    public Foreshadow addResolutionChapter(String id, int chapterOrder) {
        Foreshadow foreshadow = getById(id);
        if (foreshadow == null) {
            return null;
        }

        List<Integer> resolutionChapters = foreshadow.getResolutionChapters();
        if (resolutionChapters == null) {
            resolutionChapters = new ArrayList<>();
        }
        if (!resolutionChapters.contains(chapterOrder)) {
            resolutionChapters.add(chapterOrder);
            foreshadow.setResolutionChapters(resolutionChapters);

            // 如果是第一次回收，更新状态为partial
            if ("planted".equals(foreshadow.getStatus())) {
                foreshadow.setStatus("partial");
            }

            updateById(foreshadow);
        }
        return foreshadow;
    }

    /**
     * 标记为完全回收
     */
    public Foreshadow markAsResolved(String id, String resolutionNotes) {
        return updateStatus(id, "resolved", resolutionNotes);
    }

    /**
     * 标记为废弃
     */
    public Foreshadow markAsAbandoned(String id, String reason) {
        return updateStatus(id, "abandoned", reason);
    }

    /**
     * 统计各状态的伏笔数量
     */
    public Map<String, Long> countByStatus(String bookId) {
        List<Map<String, Object>> results = foreshadowMapper.countByStatus(bookId);
        return results.stream()
                .collect(Collectors.toMap(
                        m -> (String) m.get("status"),
                        m -> ((Number) m.get("count")).longValue()
                ));
    }

    /**
     * 构建伏笔提醒上下文（用于AI生成）
     */
    public String buildForeshadowReminder(String bookId, int currentChapterOrder) {
        List<Foreshadow> unresolved = getUnresolved(bookId);
        if (unresolved.isEmpty()) {
            return "";
        }

        // 过滤出埋设章节较早的伏笔
        List<Foreshadow> oldForeshadows = unresolved.stream()
                .filter(f -> currentChapterOrder - f.getPlantedChapter() >= 5) // 至少5章前埋设
                .collect(Collectors.toList());

        if (oldForeshadows.isEmpty()) {
            return "";
        }

        StringBuilder context = new StringBuilder();
        context.append("【待回收伏笔提醒】\n\n");

        for (Foreshadow f : oldForeshadows) {
            context.append("- ").append(f.getTitle());
            context.append("（第").append(f.getPlantedChapter()).append("章埋设");
            if ("major".equals(f.getImportance())) {
                context.append("，重要伏笔");
            }
            context.append("）");
            if (f.getExpectedResolve() != null && !f.getExpectedResolve().isEmpty()) {
                context.append("\n  预期回收：").append(f.getExpectedResolve());
            }
            context.append("\n");
        }

        return context.toString();
    }

    /**
     * 获取需要提醒的伏笔
     */
    public List<Foreshadow> getForeshadowsNeedReminder(String bookId, int currentChapterOrder, int minChaptersAgo) {
        List<Foreshadow> unresolved = getUnresolved(bookId);
        return unresolved.stream()
                .filter(f -> currentChapterOrder - f.getPlantedChapter() >= minChaptersAgo)
                .collect(Collectors.toList());
    }
}
