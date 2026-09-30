export interface VirtualListHandle {
  scrollToIndex: (index: number, align?: 'start' | 'center' | 'nearest', smooth?: boolean) => Promise<void>
  element: () => HTMLElement | undefined
}
