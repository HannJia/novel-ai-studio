import { computed, ref, type ComputedRef } from 'vue'
import type { DataPanelChange, DataPanelItem } from '@/types/novel'

export function useDataPanelSelection(
  items: ComputedRef<DataPanelItem[]>,
  pendingChanges: ComputedRef<DataPanelChange[]>,
) {
  const selectedItemIds = ref(new Set<string>())
  const selectedChangeIds = ref(new Set<string>())
  const selectedItems = computed(() => items.value.filter(item => selectedItemIds.value.has(item.id)))
  const selectedChanges = computed(() => pendingChanges.value.filter(change => selectedChangeIds.value.has(change.id)))
  const allChangesSelected = computed(() => pendingChanges.value.length > 0 && selectedChanges.value.length === pendingChanges.value.length)

  function toggleItem(itemId: string) {
    const next = new Set(selectedItemIds.value)
    if (next.has(itemId)) next.delete(itemId)
    else next.add(itemId)
    selectedItemIds.value = next
  }

  function toggleChange(changeId: string) {
    const next = new Set(selectedChangeIds.value)
    if (next.has(changeId)) next.delete(changeId)
    else next.add(changeId)
    selectedChangeIds.value = next
  }

  function toggleAllChanges() {
    selectedChangeIds.value = allChangesSelected.value
      ? new Set()
      : new Set(pendingChanges.value.map(change => change.id))
  }

  function clearChange(changeId?: string) {
    if (!changeId) {
      selectedChangeIds.value = new Set()
      return
    }
    const next = new Set(selectedChangeIds.value)
    next.delete(changeId)
    selectedChangeIds.value = next
  }

  function clearItem(itemId: string) {
    const next = new Set(selectedItemIds.value)
    next.delete(itemId)
    selectedItemIds.value = next
  }

  return {
    selectedItemIds, selectedChangeIds, selectedItems, selectedChanges, allChangesSelected,
    toggleItem, toggleChange, toggleAllChanges, clearChange, clearItem,
  }
}
