/**
 * File System Access API 的补充类型声明。
 * TypeScript 内置的 lib.dom 只覆盖了标准化部分，
 * showDirectoryPicker / queryPermission / requestPermission 仍是 WICG 草案（Chromium 系可用）。
 */
export {}

type FileSystemPermissionMode = 'read' | 'readwrite'

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode
}

type WellKnownDirectory = 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'

declare global {
  interface FileSystemHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  }

  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>
    entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>
    keys(): AsyncIterableIterator<string>
  }

  interface DirectoryPickerOptions {
    id?: string
    mode?: FileSystemPermissionMode
    startIn?: FileSystemHandle | WellKnownDirectory
  }

  interface Window {
    showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>
  }
}
