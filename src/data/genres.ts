import type { Genre } from '@/types/novel'

// 小说分类数据（参考起点中文网 + 番茄小说实际分类）
export const genres: Genre[] = [
  {
    label: '玄幻', value: 'xuanhuan',
    children: [
      { label: '东方玄幻', value: 'eastern-fantasy' },
      { label: '异世大陆', value: 'other-world' },
      { label: '异术超能', value: 'supernatural' },
      { label: '远古神话', value: 'ancient-myth' },
      { label: '转世重生', value: 'reincarnation' },
      { label: '西方奇幻', value: 'western-fantasy' },
      { label: '王朝争霸', value: 'dynasty-war' },
      { label: '高武世界', value: 'high-martial' },
    ]
  },
  {
    label: '仙侠', value: 'xianxia',
    children: [
      { label: '幻想修仙', value: 'fantasy-cultivation' },
      { label: '修真文明', value: 'cultivation-civilization' },
      { label: '古典仙侠', value: 'classic-xianxia' },
      { label: '现代修仙', value: 'modern-cultivation' },
    ]
  },
  {
    label: '武侠', value: 'wuxia',
    children: [
      { label: '传统武侠', value: 'traditional-wuxia' },
      { label: '武侠幻想', value: 'wuxia-fantasy' },
      { label: '国术无双', value: 'national-martial' },
    ]
  },
  {
    label: '都市', value: 'urban',
    children: [
      { label: '都市生活', value: 'urban-life' },
      { label: '都市异能', value: 'urban-supernatural' },
      { label: '商战职场', value: 'business' },
      { label: '娱乐明星', value: 'entertainment' },
      { label: '神医', value: 'miracle-doctor' },
      { label: '鉴宝', value: 'treasure-appraisal' },
      { label: '都市修真', value: 'urban-cultivation' },
      { label: '神豪', value: 'super-rich' },
    ]
  },
  {
    label: '现实', value: 'reality',
    children: [
      { label: '时代叙事', value: 'era-narrative' },
      { label: '家庭伦理', value: 'family-ethics' },
      { label: '社会乡土', value: 'social-rural' },
    ]
  },
  {
    label: '历史', value: 'history',
    children: [
      { label: '架空历史', value: 'alternate-history' },
      { label: '秦汉三国', value: 'qin-han-3k' },
      { label: '两晋隋唐', value: 'jin-sui-tang' },
      { label: '两宋元明', value: 'song-yuan-ming' },
      { label: '清史民国', value: 'qing-republic' },
      { label: '上古先秦', value: 'pre-qin' },
      { label: '外国历史', value: 'foreign-history' },
    ]
  },
  {
    label: '军事', value: 'military',
    children: [
      { label: '军旅生涯', value: 'military-life' },
      { label: '军事战争', value: 'military-war' },
      { label: '战争幻想', value: 'war-fantasy' },
      { label: '抗战烽火', value: 'resistance-war' },
      { label: '特种兵', value: 'special-forces' },
      { label: '谍战风云', value: 'espionage' },
    ]
  },
  {
    label: '游戏', value: 'game',
    children: [
      { label: '电子竞技', value: 'esports' },
      { label: '虚拟网游', value: 'vrmmo' },
      { label: '游戏异界', value: 'game-isekai' },
      { label: '游戏生涯', value: 'game-career' },
    ]
  },
  {
    label: '科幻', value: 'scifi',
    children: [
      { label: '星际文明', value: 'interstellar' },
      { label: '末世危机', value: 'apocalypse' },
      { label: '超级科技', value: 'super-tech' },
      { label: '时空穿梭', value: 'time-travel' },
      { label: '进化变异', value: 'evolution' },
      { label: '古武机甲', value: 'mecha' },
      { label: '未来世界', value: 'future-world' },
    ]
  },
  {
    label: '悬疑', value: 'mystery',
    children: [
      { label: '侦探推理', value: 'detective' },
      { label: '诡秘悬疑', value: 'occult-mystery' },
      { label: '探险异闻', value: 'adventure' },
      { label: '恐怖惊悚', value: 'horror-thriller' },
    ]
  },
  {
    label: '体育', value: 'sports',
    children: [
      { label: '篮球运动', value: 'basketball' },
      { label: '足球运动', value: 'football' },
      { label: '其他运动', value: 'other-sports' },
      { label: '体育赛事', value: 'sports-events' },
    ]
  },
  {
    label: '轻小说', value: 'light-novel',
    children: [
      { label: '原生幻想', value: 'original-fantasy' },
      { label: '二次元', value: 'acg' },
      { label: '衍生同人', value: 'fanfiction' },
      { label: '校园日常', value: 'school-daily' },
    ]
  },
  {
    label: '诸天', value: 'multiverse',
    children: [
      { label: '诸天无限', value: 'infinite-worlds' },
      { label: '综漫', value: 'crossover-anime' },
      { label: '影视同人', value: 'movie-fanfic' },
    ]
  },
  {
    label: '其他', value: 'other',
    children: [
      { label: '种田经营', value: 'farming' },
      { label: '灵气复苏', value: 'spiritual-revival' },
      { label: '系统流', value: 'system-cheat' },
      { label: '重生', value: 'rebirth' },
      { label: '穿越', value: 'transmigration' },
    ]
  },
]

// 题材标签列表
export const themeTags: string[] = [
  '长生', '种田', '系统', '重生', '穿越', '无敌', '打脸',
  '扮猪吃老虎', '后宫', '单女主', '无女主', '群像', '日常',
  '轻松', '暗黑', '争霸', '宗门', '家族', '学院', '副本',
  '诸天流', '救赎', '复仇', '经商', '基建', '慢热', '爽文',
]
