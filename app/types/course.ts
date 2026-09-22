/** 课程目录树与观看进度的数据模型 */

export interface VideoEntry {
  kind: 'video'
  /** 文件名，含扩展名 */
  name: string
  /** 去掉扩展名的标题，用作笔记文件名 */
  title: string
  /** 相对课程根目录的路径，如 "01-基础/02-变量.mp4"，作为进度与笔记的键 */
  path: string
  /** 所在目录相对路径，根目录为 "" */
  dir: string
  /** 顺序号（扁平列表中的下标，从 0 开始） */
  index: number
  handle: FileSystemFileHandle
  parent: FileSystemDirectoryHandle
}

export interface FolderEntry {
  kind: 'folder'
  name: string
  path: string
  handle: FileSystemDirectoryHandle
  children: Array<FolderEntry | VideoEntry>
  /** 递归统计的视频数 */
  videoCount: number
}

export interface Course {
  /** 稳定 id，首次打开时生成并随最近记录保存，用于隔离进度存储 */
  id: string
  name: string
  handle: FileSystemDirectoryHandle
  root: FolderEntry
  /** 扁平、自然排序后的视频列表 */
  videos: VideoEntry[]
}

export interface VideoProgress {
  /** 上次播放到的秒数 */
  time: number
  /** 视频总时长（秒） */
  duration: number
  /** 0–1 的完成比例 */
  ratio: number
  /** 是否已看完（比例 ≥ 0.95 或播放结束） */
  done: boolean
  /** 最近一次更新时间戳 */
  updatedAt: number
}

export interface RecentCourse {
  id: string
  name: string
  handle: FileSystemDirectoryHandle
  videoCount: number
  lastOpenedAt: number
  lastVideoPath?: string
}

export type TreeFilter = 'all' | 'unfinished' | 'done'
