import type { InjectionKey } from 'vue'

// Keep the workspace's single chat instance alive while its view moves into the editor.
export const editorAssistantHostKey: InjectionKey<(host: HTMLElement, active: boolean) => void> = Symbol('editorAssistantHost')
