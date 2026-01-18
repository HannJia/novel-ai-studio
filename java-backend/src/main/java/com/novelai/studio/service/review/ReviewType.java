package com.novelai.studio.service.review;

/**
 * 审查问题类型常量
 */
public class ReviewType {

    // ============ Level A: 确定性错误 ============

    /**
     * 角色生死冲突：已死亡的角色在后续章节中出现
     */
    public static final String CHARACTER_DEATH_CONFLICT = "character_death_conflict";

    /**
     * 称呼不一致：同一角色的名称/称呼使用不一致
     */
    public static final String NAME_INCONSISTENCY = "name_inconsistency";

    /**
     * 时间线冲突：事件发生的时间顺序存在矛盾
     */
    public static final String TIMELINE_CONFLICT = "timeline_conflict";

    /**
     * 实力等级冲突：角色实力变化不符合设定逻辑
     */
    public static final String POWER_LEVEL_CONFLICT = "power_level_conflict";

    /**
     * 地理位置冲突：角色移动距离/时间不合理
     */
    public static final String LOCATION_CONFLICT = "location_conflict";

    // ============ Level B: 高可信警告 ============

    /**
     * 性格偏离：角色行为与设定的性格不符
     */
    public static final String PERSONALITY_DEVIATION = "personality_deviation";

    /**
     * 能力超限：角色表现出超出设定的能力
     */
    public static final String ABILITY_EXCEEDED = "ability_exceeded";

    /**
     * 设定冲突：内容与世界观设定矛盾
     */
    public static final String SETTING_CONFLICT = "setting_conflict";

    /**
     * 物品异常：物品使用/存在不合理
     */
    public static final String ITEM_ANOMALY = "item_anomaly";

    // ============ Level C: 建议 ============

    /**
     * 因果关系存疑：情节发展的因果逻辑不清
     */
    public static final String CAUSALITY_DOUBT = "causality_doubt";

    /**
     * 节奏问题：叙事节奏存在问题
     */
    public static final String PACING_ISSUE = "pacing_issue";

    /**
     * 情感突兀：角色情感变化过于突兀
     */
    public static final String EMOTION_ABRUPT = "emotion_abrupt";

    /**
     * 伏笔遗忘：埋设的伏笔长期未回收
     */
    public static final String FORESHADOW_FORGOTTEN = "foreshadow_forgotten";

    // ============ Level D: 提示 ============

    /**
     * 视角漂移：叙事视角不一致
     */
    public static final String VIEWPOINT_DRIFT = "viewpoint_drift";

    /**
     * 文风不一致：写作风格前后不一致
     */
    public static final String STYLE_INCONSISTENCY = "style_inconsistency";
}
