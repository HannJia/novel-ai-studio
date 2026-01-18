package com.novelai.studio.service.knowledge;

import lombok.Data;

/**
 * 检索结果
 */
@Data
public class SearchResult {
    private String fileId;
    private String filename;
    private String content;
    private float score;
    private int chunkIndex;

    public SearchResult() {}

    public SearchResult(String fileId, String filename, String content, float score, int chunkIndex) {
        this.fileId = fileId;
        this.filename = filename;
        this.content = content;
        this.score = score;
        this.chunkIndex = chunkIndex;
    }
}
