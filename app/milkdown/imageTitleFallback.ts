/**
 * remark 补丁：给没有 title 的图片补上空字符串。
 *
 * Milkdown 的 image-block 把 markdown 里的 title 当作图片说明（caption），
 * 但 `![alt](src)` 这种没有 title 的图片解析出来是 null，会触发 ProseMirror 的
 * 属性校验错误（"Expected value of type string for attribute caption"），整张图片被丢掉。
 * 这里在解析阶段统一兜底，无论是别的工具写的笔记还是 Crepe 自己序列化的无说明图片都能正常打开。
 */
import { $remark } from '@milkdown/kit/utils'

interface MdNode {
  type: string
  title?: string | null
  children?: MdNode[]
}

function walk(node: MdNode) {
  if ((node.type === 'image' || node.type === 'image-block') && node.title == null) {
    node.title = ''
  }
  node.children?.forEach(walk)
}

export const imageTitleFallback = $remark('ai-player-image-title-fallback', () => () => (tree: MdNode) => {
  walk(tree)
})
