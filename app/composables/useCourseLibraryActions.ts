import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useCourseStore } from './useCourseStore'
import type { useLearningHome } from './useLearningHome'
import type { LibraryCourse } from '~/types/course'

export function useCourseLibraryActions(home: Pick<ReturnType<typeof useLearningHome>, 'courses' | 'refresh'>) {
  const store = useCourseStore()
  const router = useRouter()
  const { courses } = home
  const changing = ref('')
  const courseAction = ref<'rename' | 'delete' | null>(null)
  const actionCourse = ref<LibraryCourse | null>(null)
  const draftName = ref('')
  const actionError = ref('')

  function editCourse(course: LibraryCourse, action: 'rename' | 'delete') {
    if (changing.value || store.state.loading) return
    actionCourse.value = course
    draftName.value = course.name
    actionError.value = ''
    courseAction.value = action
  }
  function closeCourseAction(open: boolean) {
    if (!open && !changing.value) courseAction.value = null
  }
  async function submitCourseAction() {
    const course = actionCourse.value
    const action = courseAction.value
    if (!course || !action || changing.value) return
    changing.value = course.id
    actionError.value = ''
    try {
      if (action === 'rename') course.name = await store.renameCourse(course.id, draftName.value)
      else {
        await store.deleteCourse(course.id)
        courses.value = courses.value.filter((entry) => entry.course.id !== course.id)
      }
      await home.refresh()
      courseAction.value = null
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
    } finally {
      changing.value = ''
    }
  }

  function go(
    course: LibraryCourse,
    view: 'overview' | 'player' | 'today' | 'practice' = 'overview',
    path?: string,
    seconds?: number,
  ) {
    if (changing.value) return
    return router.push({
      path: `/courses/${encodeURIComponent(course.id)}${view === 'player' ? '/player' : ''}`,
      query: {
        ...(view === 'player' ? { autoplay: '1' } : {}),
        ...(view === 'player' && (path ?? course.lastVideoPath) ? { lesson: path ?? course.lastVideoPath } : {}),
        ...(seconds !== undefined ? { at: String(seconds) } : {}),
        ...(view === 'today' || view === 'practice' ? { panel: view } : {}),
      },
    })
  }

  async function update(course: LibraryCourse, patch: Partial<Pick<LibraryCourse, 'status' | 'pinned'>>) {
    if (changing.value) return
    changing.value = course.id
    try {
      if (await store.updateLibrary(course.id, patch)) {
        Object.assign(course, patch)
        await home.refresh()
      }
    } finally {
      changing.value = ''
    }
  }
  return {
    store,
    changing,
    courseAction,
    actionCourse,
    draftName,
    actionError,
    editCourse,
    closeCourseAction,
    submitCourseAction,
    go,
    update,
  }
}
