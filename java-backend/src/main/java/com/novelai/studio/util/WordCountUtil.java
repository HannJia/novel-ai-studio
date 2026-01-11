package com.novelai.studio.util;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 字数统计工具类
 * 按照项目规范，统计时不包含标点符号
 */
public class WordCountUtil {

    // 中文汉字正则
    private static final Pattern CHINESE_PATTERN = Pattern.compile("[\\u4e00-\\u9fff]");

    // 英文单词正则
    private static final Pattern ENGLISH_WORD_PATTERN = Pattern.compile("[a-zA-Z]+");

    // 连续数字正则
    private static final Pattern NUMBER_PATTERN = Pattern.compile("\\d+");

    /**
     * 统计字数（不含标点）
     *
     * @param text 要统计的文本
     * @return 字数
     */
    public static int countWords(String text) {
        if (text == null || text.isEmpty()) {
            return 0;
        }

        int count = 0;

        // 统计中文字数
        Matcher chineseMatcher = CHINESE_PATTERN.matcher(text);
        while (chineseMatcher.find()) {
            count++;
        }

        // 统计英文单词数
        Matcher englishMatcher = ENGLISH_WORD_PATTERN.matcher(text);
        while (englishMatcher.find()) {
            count++;
        }

        // 统计数字组数（连续数字算1个）
        Matcher numberMatcher = NUMBER_PATTERN.matcher(text);
        while (numberMatcher.find()) {
            count++;
        }

        return count;
    }

    /**
     * 详细统计结果
     */
    public static class WordCountDetail {
        private int total;
        private int chinese;
        private int english;
        private int numbers;

        public WordCountDetail(int total, int chinese, int english, int numbers) {
            this.total = total;
            this.chinese = chinese;
            this.english = english;
            this.numbers = numbers;
        }

        public int getTotal() {
            return total;
        }

        public int getChinese() {
            return chinese;
        }

        public int getEnglish() {
            return english;
        }

        public int getNumbers() {
            return numbers;
        }
    }

    /**
     * 详细统计字数
     *
     * @param text 要统计的文本
     * @return 详细统计结果
     */
    public static WordCountDetail countWordsDetailed(String text) {
        if (text == null || text.isEmpty()) {
            return new WordCountDetail(0, 0, 0, 0);
        }

        int chinese = 0;
        int english = 0;
        int numbers = 0;

        // 统计中文字数
        Matcher chineseMatcher = CHINESE_PATTERN.matcher(text);
        while (chineseMatcher.find()) {
            chinese++;
        }

        // 统计英文单词数
        Matcher englishMatcher = ENGLISH_WORD_PATTERN.matcher(text);
        while (englishMatcher.find()) {
            english++;
        }

        // 统计数字组数
        Matcher numberMatcher = NUMBER_PATTERN.matcher(text);
        while (numberMatcher.find()) {
            numbers++;
        }

        int total = chinese + english + numbers;
        return new WordCountDetail(total, chinese, english, numbers);
    }

    /**
     * 格式化字数显示
     *
     * @param count 字数
     * @return 格式化后的字符串
     */
    public static String formatWordCount(int count) {
        if (count >= 10000) {
            return String.format("%.1f万", count / 10000.0);
        } else if (count >= 1000) {
            return String.format("%.1fk", count / 1000.0);
        }
        return String.valueOf(count);
    }
}
