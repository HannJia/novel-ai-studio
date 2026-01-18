package com.novelai.studio.service.knowledge;

import lombok.Data;

/**
 * 文本块
 */
@Data
public class TextChunk {
    private String id;
    private String fileId;
    private String content;
    private int chunkIndex;
    private int startPosition;
    private int endPosition;
    private float[] embedding;

    public TextChunk() {}

    public TextChunk(String id, String fileId, String content, int chunkIndex) {
        this.id = id;
        this.fileId = fileId;
        this.content = content;
        this.chunkIndex = chunkIndex;
    }
}
