import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./pages/HomePage.vue') },
    {
      path: '/courses/:id', component: () => import('./pages/CourseLayout.vue'),
      children: [
        { path: '', name: 'course-overview', component: () => import('./pages/CourseOverviewPage.vue') },
        { path: 'player', name: 'course-player', component: () => import('./pages/PlayerPage.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
