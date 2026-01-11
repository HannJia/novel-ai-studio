package com.novelai.studio;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * NovelAI Studio 应用入口
 */
@SpringBootApplication
@MapperScan("com.novelai.studio.mapper")
public class NovelAiApplication {

    public static void main(String[] args) {
        SpringApplication.run(NovelAiApplication.class, args);
    }

}
