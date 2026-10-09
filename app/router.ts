import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./pages/HomePage.vue') },
    ...(['settings', 'study'] as const).map((dialog) => ({
      path: `/${dialog}`,
      redirect: (to: import('vue-router').RouteLocation) => ({ path: '/', query: { ...to.query, dialog } }),
    })),
    {
      path: '/courses/:id',
      component: () => import('./pages/CourseLayout.vue'),
      children: [
        { path: '', name: 'course-overview', component: () => import('./pages/CourseOverviewPage.vue') },
        { path: 'player', name: 'course-player', component: () => import('./pages/PlayerPage.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
