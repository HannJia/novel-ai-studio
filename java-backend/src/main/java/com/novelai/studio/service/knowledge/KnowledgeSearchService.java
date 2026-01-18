package com.novelai.studio.service.knowledge;

import com.novelai.studio.entity.KnowledgeFile;
import com.novelai.studio.service.KnowledgeFileService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * 知识库检索服务
 *
 * 实现简化版的文本检索，基于关键词匹配和TF-IDF评分
 * 支持相关度阈值过滤
 * 后续可以升级为向量检索
 */
@Service
public class KnowledgeSearchService {

    @Autowired
    private KnowledgeFileService knowledgeFileService;

    /**
     * 文本块缓存：fileId -> List<TextChunk>
     */
    private final Map<String, List<TextChunk>> chunkCache = new ConcurrentHashMap<>();

    /**
     * 默认分块大小
     */
    private static final int CHUNK_SIZE = 500;

    /**
     * 分块重叠
     */
    private static final int CHUNK_OVERLAP = 50;

    /**
     * 相关度阈值（可配置），低于此值的结果将被过滤
     * 默认0.1，范围0-1
     */
    @Value("${knowledge.search.relevance-threshold:0.1}")
    private float relevanceThreshold;

    /**
     * 设置相关度阈值
     */
    public void setRelevanceThreshold(float threshold) {
        if (threshold < 0 || threshold > 1) {
            throw new IllegalArgumentException("阈值必须在0-1之间");
        }
        this.relevanceThreshold = threshold;
    }

    /**
     * 获取当前相关度阈值
     */
    public float getRelevanceThreshold() {
        return relevanceThreshold;
    }

    /**
     * 索引文件
     */
    public int indexFile(String fileId) throws IOException {
        KnowledgeFile file = knowledgeFileService.getById(fileId);
        if (file == null) {
            throw new IOException("文件不存在");
        }

        // 读取文件内容
        String content = knowledgeFileService.readFileContent(fileId);
        if (content == null || content.isEmpty() || content.startsWith("[暂不支持")) {
            return 0;
        }

        // 分块
        List<TextChunk> chunks = splitIntoChunks(fileId, content);
        chunkCache.put(fileId, chunks);

        // 更新文件索引状态
        knowledgeFileService.updateIndexStatus(fileId, true, chunks.size());

        return chunks.size();
    }

    /**
     * 搜索知识库
     */
    public List<SearchResult> search(String bookId, String query, int topK) {
        return search(bookId, query, topK, relevanceThreshold);
    }

    /**
     * 搜索知识库（可自定义阈值）
     */
    public List<SearchResult> search(String bookId, String query, int topK, float minRelevance) {
        List<SearchResult> results = new ArrayList<>();

        // 获取书籍的所有文件
        List<KnowledgeFile> files = knowledgeFileService.getFilesByBook(bookId);

        // 对查询进行分词
        Set<String> queryTokens = tokenize(query);

        for (KnowledgeFile file : files) {
            // 确保文件已索引
            List<TextChunk> chunks = chunkCache.get(file.getId());
            if (chunks == null || chunks.isEmpty()) {
                // 尝试索引
                try {
                    indexFile(file.getId());
                    chunks = chunkCache.get(file.getId());
                } catch (IOException e) {
                    continue;
                }
            }

            if (chunks == null) continue;

            // 计算每个块的相关性分数
            for (TextChunk chunk : chunks) {
                float score = calculateScore(chunk.getContent(), queryTokens);
                // 应用相关度阈值过滤
                if (score >= minRelevance) {
                    results.add(new SearchResult(
                            file.getId(),
                            file.getOriginalName(),
                            chunk.getContent(),
                            score,
                            chunk.getChunkIndex()
                    ));
                }
            }
        }

        // 按分数排序并返回前topK个
        return results.stream()
                .sorted((a, b) -> Float.compare(b.getScore(), a.getScore()))
                .limit(topK)
                .collect(Collectors.toList());
    }

    /**
     * 搜索单个文件
     */
    public List<SearchResult> searchInFile(String fileId, String query, int topK) {
        return searchInFile(fileId, query, topK, relevanceThreshold);
    }

    /**
     * 搜索单个文件（可自定义阈值）
     */
    public List<SearchResult> searchInFile(String fileId, String query, int topK, float minRelevance) {
        List<SearchResult> results = new ArrayList<>();

        KnowledgeFile file = knowledgeFileService.getById(fileId);
        if (file == null) return results;

        List<TextChunk> chunks = chunkCache.get(fileId);
        if (chunks == null || chunks.isEmpty()) {
            try {
                indexFile(fileId);
                chunks = chunkCache.get(fileId);
            } catch (IOException e) {
                return results;
            }
        }

        if (chunks == null) return results;

        Set<String> queryTokens = tokenize(query);

        for (TextChunk chunk : chunks) {
            float score = calculateScore(chunk.getContent(), queryTokens);
            // 应用相关度阈值过滤
            if (score >= minRelevance) {
                results.add(new SearchResult(
                        file.getId(),
                        file.getOriginalName(),
                        chunk.getContent(),
                        score,
                        chunk.getChunkIndex()
                ));
            }
        }

        return results.stream()
                .sorted((a, b) -> Float.compare(b.getScore(), a.getScore()))
                .limit(topK)
                .collect(Collectors.toList());
    }

    /**
     * 获取文件的相关上下文
     */
    public String getRelevantContext(String bookId, String query, int maxChunks) {
        List<SearchResult> results = search(bookId, query, maxChunks);

        if (results.isEmpty()) {
            return "";
        }

        StringBuilder context = new StringBuilder();
        context.append("【参考知识库内容】\n\n");

        for (int i = 0; i < results.size(); i++) {
            SearchResult result = results.get(i);
            context.append(String.format("--- 来源: %s ---\n", result.getFilename()));
            context.append(result.getContent());
            context.append("\n\n");
        }

        return context.toString();
    }

    /**
     * 清除文件索引
     */
    public void clearIndex(String fileId) {
        chunkCache.remove(fileId);
        knowledgeFileService.updateIndexStatus(fileId, false, 0);
    }

    /**
     * 清除书籍所有索引
     */
    public void clearBookIndex(String bookId) {
        List<KnowledgeFile> files = knowledgeFileService.getFilesByBook(bookId);
        for (KnowledgeFile file : files) {
            clearIndex(file.getId());
        }
    }

    /**
     * 将文本分割成块
     */
    private List<TextChunk> splitIntoChunks(String fileId, String content) {
        List<TextChunk> chunks = new ArrayList<>();

        if (content == null || content.isEmpty()) {
            return chunks;
        }

        int start = 0;
        int chunkIndex = 0;

        while (start < content.length()) {
            int end = Math.min(start + CHUNK_SIZE, content.length());

            // 尝试在句子边界切分
            if (end < content.length()) {
                int lastPeriod = content.lastIndexOf("。", end);
                int lastQuestion = content.lastIndexOf("？", end);
                int lastExclaim = content.lastIndexOf("！", end);
                int lastNewline = content.lastIndexOf("\n", end);

                int boundary = Math.max(Math.max(lastPeriod, lastQuestion),
                                       Math.max(lastExclaim, lastNewline));

                if (boundary > start + CHUNK_SIZE / 2) {
                    end = boundary + 1;
                }
            }

            String chunkContent = content.substring(start, end).trim();
            if (!chunkContent.isEmpty()) {
                TextChunk chunk = new TextChunk(
                        UUID.randomUUID().toString(),
                        fileId,
                        chunkContent,
                        chunkIndex
                );
                chunk.setStartPosition(start);
                chunk.setEndPosition(end);
                chunks.add(chunk);
                chunkIndex++;
            }

            // 下一块开始位置（考虑重叠）
            start = end - CHUNK_OVERLAP;
            if (start <= chunks.get(chunks.size() - 1).getStartPosition()) {
                start = end;
            }
        }

        return chunks;
    }

    /**
     * 简单分词
     */
    private Set<String> tokenize(String text) {
        Set<String> tokens = new HashSet<>();
        if (text == null || text.isEmpty()) {
            return tokens;
        }

        // 移除标点符号，转小写
        String cleaned = text.toLowerCase()
                .replaceAll("[\\p{Punct}\\s]+", " ")
                .trim();

        // 按空格分割（英文）
        String[] words = cleaned.split("\\s+");
        for (String word : words) {
            if (word.length() > 1) {
                tokens.add(word);
            }
        }

        // 中文：按字符（简化处理，实际应用需要分词器）
        for (char c : cleaned.toCharArray()) {
            if (Character.toString(c).matches("[\\u4e00-\\u9fa5]")) {
                tokens.add(String.valueOf(c));
            }
        }

        // 中文：双字组合
        String chineseOnly = cleaned.replaceAll("[^\\u4e00-\\u9fa5]", "");
        for (int i = 0; i < chineseOnly.length() - 1; i++) {
            tokens.add(chineseOnly.substring(i, i + 2));
        }

        return tokens;
    }

    /**
     * 计算相关性分数（简化的TF-IDF）
     */
    private float calculateScore(String content, Set<String> queryTokens) {
        if (content == null || content.isEmpty() || queryTokens.isEmpty()) {
            return 0;
        }

        String contentLower = content.toLowerCase();
        int matchCount = 0;
        int totalOccurrences = 0;

        for (String token : queryTokens) {
            int index = 0;
            int occurrences = 0;
            while ((index = contentLower.indexOf(token, index)) != -1) {
                occurrences++;
                index += token.length();
            }
            if (occurrences > 0) {
                matchCount++;
                totalOccurrences += occurrences;
            }
        }

        if (matchCount == 0) {
            return 0;
        }

        // 分数 = 匹配的关键词比例 * 出现次数的对数
        float matchRatio = (float) matchCount / queryTokens.size();
        float occurrenceScore = (float) Math.log(1 + totalOccurrences);

        return matchRatio * occurrenceScore;
    }
}
