import { onBeforeUnmount, reactive } from 'vue'
import { databaseRequest } from '~/utils/database'
import { desktopInvoke } from '~/utils/platform'
import { isRecord } from '~/utils/guide'
import { knowledgeDocument } from '~/utils/learningOutcomes'
import { createNotionKnowledgeClient, mergeKnowledgeDocument } from '~/utils/knowledgeSync'
import { useLearningManagement } from './useLearningManagement'
import { useCourseWorkspace } from './useCourseWorkspace'

export function useKnowledgeSync() {
  const learning = useLearningManagement(),
    workspace = useCourseWorkspace()
  const state = reactive({
    vault: '',
    notionToken: '',
    notionPage: '',
    ready: false,
    busy: false,
    error: '',
    notice: '',
    conflicts: [] as Array<{
      path: string
      local: string
      remote: string | null
      courseId: string
      target: 'vault' | 'notion'
    }>,
  })
  let controller: AbortController | undefined,
    disposed = false
  async function load() {
    try {
      const [vault, notion] = await Promise.all([
        databaseRequest('settings', { query: { key: 'learning-vault-root' } }),
        databaseRequest('settings', { query: { key: 'learning-notion' } }),
      ])
      if (disposed) return
      if (vault !== null && typeof vault !== 'string') throw Error('知识库设置无法读取。')
      if (notion !== null && (!isRecord(notion) || typeof notion.token !== 'string' || typeof notion.page !== 'string'))
        throw Error('Notion 设置无法读取。')
      state.vault = typeof vault === 'string' ? vault : ''
      if (isRecord(notion)) {
        state.notionToken = String(notion.token)
        state.notionPage = String(notion.page)
      }
      state.ready = true
    } catch (e) {
      state.error = String(e)
    }
  }
  async function chooseVault() {
    try {
      state.vault = (await desktopInvoke<string | null>('choose_knowledge_vault')) ?? state.vault
    } catch (e) {
      state.error = String(e)
    }
  }
  async function saveNotion() {
    if (!state.ready) return
    try {
      createNotionKnowledgeClient(state.notionToken, state.notionPage, new AbortController().signal)
      await databaseRequest('settings', {
        method: 'POST',
        body: { key: 'learning-notion', value: { token: state.notionToken, page: state.notionPage } },
      })
      state.notice = 'Notion 连接已保存'
      state.error = ''
    } catch (e) {
      state.error = String(e)
    }
  }
  async function sync(
    courseId: string,
    target: 'vault' | 'notion',
    onlyPath?: string,
    resolution?: 'local' | 'remote',
  ) {
    if (state.busy || !state.ready) return
    state.busy = true
    state.error = ''
    state.notice = ''
    controller = new AbortController()
    const signal = controller.signal
    try {
      await workspace.noteEditor.value?.save()
      if (workspace.noteEditor.value?.hasUnsavedChanges()) throw Error('请先保存当前笔记。')
      await learning.refresh()
      if (learning.sourceError.value) throw Error(learning.sourceError.value)
      const course = learning.courses.value.find((c) => c.course.id === courseId)
      if (!course) throw Error('课程暂不可用。')
      const source = learning.sources.value
      const paths = onlyPath
        ? [onlyPath]
        : [
            ...new Set([
              ...source.notes.filter((n) => n.courseId === courseId).map((n) => n.path),
              ...source.summaries.filter((n) => n.courseId === courseId).map((n) => n.path),
              ...source.practices
                .filter((p) => p.courseId === courseId)
                .flatMap((p) =>
                  p.record.path.startsWith('daily:')
                    ? p.record.sources.flatMap((s) => (s.path ? [s.path] : []))
                    : [p.record.path],
                ),
            ]),
          ]
      const notion =
        target === 'notion' ? createNotionKnowledgeClient(state.notionToken, state.notionPage, signal) : null
      let count = 0
      for (const path of paths) {
        signal.throwIfAborted()
        const document = knowledgeDocument(course, path, source),
          identity = JSON.stringify([courseId, path])
        const key = `knowledge-sync:${JSON.stringify([target, target === 'vault' ? state.vault : state.notionPage, courseId, path])}`
        const raw = await databaseRequest('settings', { query: { key } })
        if (
          raw !== null &&
          (!isRecord(raw) ||
            (raw.base !== null && typeof raw.base !== 'string') ||
            (raw.pageId !== null && typeof raw.pageId !== 'string'))
        )
          throw Error('同步记录无法读取。')
        const baseline = raw as { base: string | null; pageId: string | null; local?: string } | null
        let pageId = baseline?.pageId ?? null
        let remote: string | null
        if (notion) remote = pageId ? (await notion.read(pageId)).content : null
        else {
          const response = await desktopInvoke<unknown>('knowledge_vault_document', {
            identity,
            content: null,
            expected: null,
          })
          if (!isRecord(response) || (response.content !== null && typeof response.content !== 'string'))
            throw Error('知识库文档无法读取。')
          remote = response.content as string | null
        }
        // A newly-created Notion page has no document yet and is safely resumable.
        if (pageId && baseline?.base === null && remote === '') remote = null
        signal.throwIfAborted()
        const conflict = state.conflicts.find((c) => c.courseId === courseId && c.path === path && c.target === target)
        const chosen = resolution && conflict?.remote === remote ? resolution : undefined
        const merged = mergeKnowledgeDocument(baseline?.base ?? null, document.content, remote, chosen, baseline?.local)
        state.conflicts = state.conflicts.filter(
          (c) => !(c.courseId === courseId && c.path === path && c.target === target),
        )
        if (merged.conflict) {
          state.conflicts.push({ path, courseId, target, local: document.content, remote })
          continue
        }
        // Recheck local state after network reads. Never apply a stale remote answer over a new draft.
        const current = await databaseRequest<{ content: string }>('notes', { query: { courseId, videoPath: path } })
        signal.throwIfAborted()
        if (current.content !== document.note || workspace.noteEditor.value?.hasUnsavedChanges())
          throw Error('笔记已修改，请重新同步。')
        if (notion) {
          if (!pageId) {
            pageId = await notion.write(null, `${course.course.name} · ${path.split('/').at(-1)}`, merged.content, null)
            await databaseRequest('settings', { method: 'POST', body: { key, value: { base: null, pageId } } })
          }
          if (remote !== merged.content) await notion.write(pageId, '', merged.content, remote)
        } else if (remote !== merged.content)
          await desktopInvoke('knowledge_vault_document', { identity, content: merged.content, expected: remote })
        signal.throwIfAborted()
        if (merged.note !== document.note) {
          await databaseRequest('notes', {
            method: 'POST',
            body: { courseId, videoPath: path, content: merged.note, expectedContent: document.note },
          })
          if (workspace.course.value?.id === courseId && workspace.video.value?.path === path)
            workspace.noteRevision.value++
        }
        await databaseRequest('settings', {
          method: 'POST',
          body: {
            key,
            value: { base: merged.content, pageId, local: document.prefix + merged.note + document.suffix },
          },
        })
        count++
      }
      if (!disposed)
        state.notice = `已同步 ${count} 篇${state.conflicts.length ? `，${state.conflicts.length} 篇待选择版本` : ''}`
      await learning.refresh()
    } catch (e) {
      if (!signal.aborted && !disposed) state.error = String(e)
    } finally {
      state.busy = false
      controller = undefined
    }
  }
  onBeforeUnmount(() => {
    disposed = true
    controller?.abort()
  })
  return { state, load, chooseVault, saveNotion, sync, cancel: () => controller?.abort() }
}
