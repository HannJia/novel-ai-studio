export type ChatSearchProtocol = 'auto' | 'responses' | 'anthropic' | 'openrouter' | 'chat-completions'

export interface ChatSource {
  url: string
  title: string
  excerpt?: string
}

export interface ChatSearchRecord {
  protocol: Exclude<ChatSearchProtocol, 'auto'>
  status: 'searched' | 'not-used' | 'unverified'
  sources: ChatSource[]
}
