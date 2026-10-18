import { onMounted } from 'vue'
import { databaseRequest } from '~/utils/database'
import { createHomeTasks } from '~/utils/homeTasks'

const key = 'home-tasks:v1'
const tasks = createHomeTasks({
  read: () => databaseRequest('settings', { query: { key } }),
  write: (value) => databaseRequest('settings', { method: 'POST', body: { key, value } }),
})

export function useHomeTasks() {
  onMounted(() => void tasks.load())
  return tasks
}
