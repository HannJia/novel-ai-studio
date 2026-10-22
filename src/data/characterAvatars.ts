import type { Character } from '@/types/novel'

export type CharacterAvatarEra = 'ancient' | 'modern'
export type CharacterAvatarGender = 'female' | 'male'
export type CharacterAvatarCategory = 'heroine' | 'protagonist' | 'villain' | 'support' | 'mentor' | 'healer' | 'warrior' | 'scholar' | 'leader' | 'merchant' | 'traveler'
export interface CharacterAvatar { id: string; label: string; role: string; col: number; row: number; src: string; era: CharacterAvatarEra; gender: CharacterAvatarGender; category: CharacterAvatarCategory }
export type AvatarCharacter = Pick<Character, 'id' | 'name' | 'identity'> & Partial<Pick<Character, 'avatarId' | 'avatarColor' | 'description'>>
export const CHARACTER_AVATAR_ATLAS_URL = new URL('../assets/avatars/ink-atlas-v1.png', import.meta.url).href
const ancientHeroines = new URL('../assets/avatars/ink-ancient-heroines-v1.png', import.meta.url).href
const modernHeroines = new URL('../assets/avatars/ink-modern-heroines-v1.png', import.meta.url).href
const antagonists = new URL('../assets/avatars/ink-antagonists-v1.png', import.meta.url).href
const supporting = new URL('../assets/avatars/ink-supporting-v1.png', import.meta.url).href

export const characterAvatars: readonly CharacterAvatar[] = [
  { id: 'ink-scholar-f', label: '青衿·女', role: 'scholar', col: 0, row: 0, src: CHARACTER_AVATAR_ATLAS_URL, era: 'ancient', gender: 'female', category: 'scholar' },
  { id: 'ink-scholar-m', label: '青衿·男', role: 'scholar', col: 1, row: 0, src: CHARACTER_AVATAR_ATLAS_URL, era: 'ancient', gender: 'male', category: 'scholar' },
  { id: 'ink-mentor-f', label: '长者·女', role: 'mentor', col: 2, row: 0, src: CHARACTER_AVATAR_ATLAS_URL, era: 'ancient', gender: 'female', category: 'mentor' },
  { id: 'ink-mentor-m', label: '长者·男', role: 'mentor', col: 3, row: 0, src: CHARACTER_AVATAR_ATLAS_URL, era: 'ancient', gender: 'male', category: 'mentor' },
  { id: 'ink-warrior-f', label: '执剑·女', role: 'warrior', col: 0, row: 1, src: CHARACTER_AVATAR_ATLAS_URL, era: 'ancient', gender: 'female', category: 'warrior' },
  { id: 'ink-warrior-m', label: '执剑·男', role: 'warrior', col: 1, row: 1, src: CHARACTER_AVATAR_ATLAS_URL, era: 'ancient', gender: 'male', category: 'warrior' },
  { id: 'ink-leader-f', label: '执政·女', role: 'leader', col: 2, row: 1, src: CHARACTER_AVATAR_ATLAS_URL, era: 'ancient', gender: 'female', category: 'leader' },
  { id: 'ink-leader-m', label: '执政·男', role: 'leader', col: 3, row: 1, src: CHARACTER_AVATAR_ATLAS_URL, era: 'ancient', gender: 'male', category: 'leader' },
  { id: 'ink-healer-f', label: '杏林·女', role: 'healer', col: 0, row: 2, src: CHARACTER_AVATAR_ATLAS_URL, era: 'ancient', gender: 'female', category: 'healer' },
  { id: 'ink-healer-m', label: '杏林·男', role: 'healer', col: 1, row: 2, src: CHARACTER_AVATAR_ATLAS_URL, era: 'ancient', gender: 'male', category: 'healer' },
  { id: 'ink-merchant-f', label: '行商·女', role: 'merchant', col: 2, row: 2, src: CHARACTER_AVATAR_ATLAS_URL, era: 'ancient', gender: 'female', category: 'merchant' },
  { id: 'ink-merchant-m', label: '行商·男', role: 'merchant', col: 3, row: 2, src: CHARACTER_AVATAR_ATLAS_URL, era: 'ancient', gender: 'male', category: 'merchant' },
  { id: 'ink-traveler-f', label: '远行·女', role: 'traveler', col: 0, row: 3, src: CHARACTER_AVATAR_ATLAS_URL, era: 'ancient', gender: 'female', category: 'traveler' },
  { id: 'ink-traveler-m', label: '远行·男', role: 'traveler', col: 1, row: 3, src: CHARACTER_AVATAR_ATLAS_URL, era: 'ancient', gender: 'male', category: 'traveler' },
  { id: 'ink-modern-f', label: '今朝·女', role: 'modern', col: 2, row: 3, src: CHARACTER_AVATAR_ATLAS_URL, era: 'modern', gender: 'female', category: 'protagonist' },
  { id: 'ink-modern-m', label: '今朝·男', role: 'modern', col: 3, row: 3, src: CHARACTER_AVATAR_ATLAS_URL, era: 'modern', gender: 'male', category: 'protagonist' },
  { id: 'ancient-heroine-01', label: '青衿', role: 'heroine', col: 0, row: 0, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-02', label: '执剑', role: 'heroine', col: 1, row: 0, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-03', label: '杏林', role: 'heroine', col: 2, row: 0, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-04', label: '逐风', role: 'heroine', col: 3, row: 0, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-05', label: '金枝', role: 'heroine', col: 0, row: 1, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-06', label: '观棋', role: 'heroine', col: 1, row: 1, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-07', label: '临阵', role: 'heroine', col: 2, row: 1, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-08', label: '听弦', role: 'heroine', col: 3, row: 1, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-09', label: '霜华', role: 'heroine', col: 0, row: 2, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-10', label: '春酿', role: 'heroine', col: 1, row: 2, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-11', label: '挽弓', role: 'heroine', col: 2, row: 2, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-12', label: '紫宸', role: 'heroine', col: 3, row: 2, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-13', label: '书灯', role: 'heroine', col: 0, row: 3, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-14', label: '问雪', role: 'heroine', col: 1, row: 3, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-15', label: '藏锋', role: 'heroine', col: 2, row: 3, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'ancient-heroine-16', label: '夜阑', role: 'heroine', col: 3, row: 3, src: ancientHeroines, era: 'ancient', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-01', label: '知行', role: 'heroine', col: 0, row: 0, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-02', label: '白衣', role: 'heroine', col: 1, row: 0, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-03', label: '向晴', role: 'heroine', col: 2, row: 0, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-04', label: '寻真', role: 'heroine', col: 3, row: 0, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-05', label: '筑梦', role: 'heroine', col: 0, row: 1, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-06', label: '望舒', role: 'heroine', col: 1, row: 1, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-07', label: '绮墨', role: 'heroine', col: 2, row: 1, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-08', label: '竞风', role: 'heroine', col: 3, row: 1, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-09', label: '暖冬', role: 'heroine', col: 0, row: 2, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-10', label: '明律', role: 'heroine', col: 1, row: 2, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-11', label: '书栖', role: 'heroine', col: 2, row: 2, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-12', label: '新程', role: 'heroine', col: 3, row: 2, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-13', label: '从容', role: 'heroine', col: 0, row: 3, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-14', label: '未央', role: 'heroine', col: 1, row: 3, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-15', label: '流音', role: 'heroine', col: 2, row: 3, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'modern-heroine-16', label: '青锋', role: 'heroine', col: 3, row: 3, src: modernHeroines, era: 'modern', gender: 'female', category: 'heroine' },
  { id: 'ink-antagonist-01', label: '朝堂', role: 'villain', col: 0, row: 0, src: antagonists, era: 'ancient', gender: 'male', category: 'villain' },
  { id: 'ink-antagonist-02', label: '冷玉', role: 'villain', col: 1, row: 0, src: antagonists, era: 'ancient', gender: 'female', category: 'villain' },
  { id: 'ink-antagonist-03', label: '玄谋', role: 'villain', col: 2, row: 0, src: antagonists, era: 'ancient', gender: 'male', category: 'villain' },
  { id: 'ink-antagonist-04', label: '凌霜', role: 'villain', col: 3, row: 0, src: antagonists, era: 'ancient', gender: 'female', category: 'villain' },
  { id: 'ink-antagonist-05', label: '苍狼', role: 'villain', col: 0, row: 1, src: antagonists, era: 'ancient', gender: 'male', category: 'villain' },
  { id: 'ink-antagonist-06', label: '惊鸿', role: 'villain', col: 1, row: 1, src: antagonists, era: 'ancient', gender: 'female', category: 'villain' },
  { id: 'ink-antagonist-07', label: '白策', role: 'villain', col: 2, row: 1, src: antagonists, era: 'ancient', gender: 'male', category: 'villain' },
  { id: 'ink-antagonist-08', label: '凤仪', role: 'villain', col: 3, row: 1, src: antagonists, era: 'ancient', gender: 'female', category: 'villain' },
  { id: 'ink-antagonist-09', label: '争锋', role: 'villain', col: 0, row: 2, src: antagonists, era: 'modern', gender: 'male', category: 'villain' },
  { id: 'ink-antagonist-10', label: '寒星', role: 'villain', col: 1, row: 2, src: antagonists, era: 'modern', gender: 'female', category: 'villain' },
  { id: 'ink-antagonist-11', label: '城府', role: 'villain', col: 2, row: 2, src: antagonists, era: 'modern', gender: 'male', category: 'villain' },
  { id: 'ink-antagonist-12', label: '绮局', role: 'villain', col: 3, row: 2, src: antagonists, era: 'modern', gender: 'female', category: 'villain' },
  { id: 'ink-antagonist-13', label: '暗涌', role: 'villain', col: 0, row: 3, src: antagonists, era: 'modern', gender: 'male', category: 'villain' },
  { id: 'ink-antagonist-14', label: '赤焰', role: 'villain', col: 1, row: 3, src: antagonists, era: 'modern', gender: 'female', category: 'villain' },
  { id: 'ink-antagonist-15', label: '骄阳', role: 'villain', col: 2, row: 3, src: antagonists, era: 'modern', gender: 'male', category: 'villain' },
  { id: 'ink-antagonist-16', label: '鉴心', role: 'villain', col: 3, row: 3, src: antagonists, era: 'modern', gender: 'female', category: 'villain' },
  { id: 'ink-support-01', label: '书友', role: 'support', col: 0, row: 0, src: supporting, era: 'ancient', gender: 'male', category: 'support' },
  { id: 'ink-support-02', label: '春桃', role: 'support', col: 1, row: 0, src: supporting, era: 'ancient', gender: 'female', category: 'support' },
  { id: 'ink-support-03', label: '行商', role: 'support', col: 2, row: 0, src: supporting, era: 'ancient', gender: 'male', category: 'support' },
  { id: 'ink-support-04', label: '济世', role: 'support', col: 3, row: 0, src: supporting, era: 'ancient', gender: 'female', category: 'support' },
  { id: 'ink-support-05', label: '长青', role: 'support', col: 0, row: 1, src: supporting, era: 'ancient', gender: 'male', category: 'support' },
  { id: 'ink-support-06', label: '知礼', role: 'support', col: 1, row: 1, src: supporting, era: 'ancient', gender: 'female', category: 'support' },
  { id: 'ink-support-07', label: '守城', role: 'support', col: 2, row: 1, src: supporting, era: 'ancient', gender: 'male', category: 'support' },
  { id: 'ink-support-08', label: '乡邻', role: 'support', col: 3, row: 1, src: supporting, era: 'ancient', gender: 'female', category: 'support' },
  { id: 'ink-support-09', label: '同舟', role: 'support', col: 0, row: 2, src: supporting, era: 'modern', gender: 'male', category: 'support' },
  { id: 'ink-support-10', label: '清和', role: 'support', col: 1, row: 2, src: supporting, era: 'modern', gender: 'female', category: 'support' },
  { id: 'ink-support-11', label: '慈父', role: 'support', col: 2, row: 2, src: supporting, era: 'modern', gender: 'male', category: 'support' },
  { id: 'ink-support-12', label: '知暖', role: 'support', col: 3, row: 2, src: supporting, era: 'modern', gender: 'female', category: 'support' },
  { id: 'ink-support-13', label: '秉公', role: 'support', col: 0, row: 3, src: supporting, era: 'modern', gender: 'male', category: 'support' },
  { id: 'ink-support-14', label: '同窗', role: 'support', col: 1, row: 3, src: supporting, era: 'modern', gender: 'female', category: 'support' },
  { id: 'ink-support-15', label: '格物', role: 'support', col: 2, row: 3, src: supporting, era: 'modern', gender: 'male', category: 'support' },
  { id: 'ink-support-16', label: '烟火', role: 'support', col: 3, row: 3, src: supporting, era: 'modern', gender: 'female', category: 'support' },
]

export function inferAvatarEra(text: string): CharacterAvatarEra {
  return /都市|现代|职场|商战|公司|总裁|董事|总监|经理|地产|金融|公务|政府|官员|大学|同学|记者|律师|警察|医生|程序员|科技|末世|科幻|urban|modern|sci.?fi|cyber/i.test(text) ? 'modern' : 'ancient'
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  return hash
}

export function resolveCharacterAvatar(character: AvatarCharacter, context: { era?: CharacterAvatarEra } = {}): CharacterAvatar {
  const manual = characterAvatars.find(avatar => avatar.id === character.avatarId)
  if (manual) return manual
  const identity = character.identity || ''
  const era = context.era || inferAvatarEra(identity)
  const genderText = `${identity} ${character.description || ''}`
  const gender: CharacterAvatarGender | undefined = /女|姑娘|女士|婆婆|母亲|妈妈|妻|姐姐|妹妹|千金|female|woman/i.test(identity) ? 'female'
    : /男|公子|爷爷|父亲|爸爸|丈夫|哥哥|弟弟|\bmale\b|\bman\b/i.test(identity) ? 'male'
    : /她|\bshe\b/i.test(genderText) ? 'female' : /(?:^|[。！？\s，,])他(?:是|曾|在|的|有|将)|\bhe\b/i.test(genderText) ? 'male' : undefined
  const role = /反派|反角|对手|敌人|仇敌|恶人|宿敌|幕后|villain|antagonist|rival/i.test(identity) ? 'villain'
    : /女主|女一|红颜|女儿|千金|女配/i.test(identity) ? 'heroine'
    : /医|药|大夫|治疗|护士|healer|doctor/i.test(identity) ? 'healer'
    : /师父|师尊|长老|导师|老者|老人|婆婆|爷爷|太傅|mentor|elder/i.test(identity) ? 'mentor'
    : /将军|武将|军人|剑客|侠|战士|武者|侍卫|warrior|soldier/i.test(identity) ? 'warrior'
    : /帝|君王|国王|女王|统领|宗主|掌门|首领|领主|董事|总裁|总监|经理|官员|部长|leader|ruler/i.test(identity) ? 'leader'
    : /商|掌柜|店主|老板|merchant/i.test(identity) ? 'merchant'
    : /书生|学者|文人|谋士|秀才|状元|先生|scholar/i.test(identity) ? 'scholar'
    : /主角|男主|主人公/i.test(identity) ? 'protagonist' : 'support'
  let choices = characterAvatars.filter(avatar => avatar.era === era && (!gender || avatar.gender === gender))
  const matching = choices.filter(avatar => avatar.role === role || avatar.category === role)
  if (matching.length) choices = matching
  else if (role === 'heroine' || gender === 'female') choices = choices.filter(avatar => avatar.category === 'heroine' || avatar.category === 'support')
  else choices = choices.filter(avatar => avatar.category !== 'villain' && avatar.category !== 'heroine')
  if (!choices.length) choices = characterAvatars.filter(avatar => avatar.era === era)
  return choices[stableHash(character.id || character.name || identity || 'character') % choices.length]
}
