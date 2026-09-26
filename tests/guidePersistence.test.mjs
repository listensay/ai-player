import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { createRenderer, reactive, ref } from 'vue'

const boundaries = {
  '~/composables/useAiSettings': ['useAiSettings'],
  '~/composables/useProgress': ['useProgress'],
  '~/utils/platform': ['desktopInvoke'],
  '~/utils/guideAi': ['planPrompt', 'practicePrompt', 'requestGuideJson'],
  '~/utils/guideMedia': ['collectGuideMetadata', 'loadLessonSubtitles', 'relevantCues'],
  '~/utils/dbClient': ['dbFetchGuide', 'dbSaveGuide', 'dbSaveSetting', 'dbFetchCheckIns', 'dbSaveCheckIns'],
  '~/utils/database': ['databaseRequest'],
}
registerHooks({resolve(specifier, context, next) {
  if (boundaries[specifier]) {
    const code = boundaries[specifier].map(name => `export const ${name} = (...args) => globalThis.guideTestIO.${name}(...args)`).join('\n')
    return { url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true }
  }
  if (specifier.startsWith('~/')) return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
  return next(specifier, context)
}})
const { useLearningGuide } = await import('../app/composables/useLearningGuide.ts')
const { useStudyCheckIn } = await import('../app/composables/useStudyCheckIn.ts')
globalThis.window = new EventTarget()
const tick = () => new Promise(resolve => setImmediate(resolve))
const course = id => ({id, videos: [{path:'a.mp4', title:'课程', size:1, modified:1}]})
const plan = () => ({version:1, createdAt:123, summary:'保留这条路线', profile:'已有基础', dailyMinutes:30,
  modules:[{id:'m',title:'基础',description:'课程基础'}], messages:[],
  lessons:[{path:'a.mp4',moduleId:'m',status:'required',reason:'需要学习',prerequisites:[],concepts:['变量']}]})
const stored = () => ({plan:plan(),metadata:{},view:'route',includeOptional:false,mastery:{},questions:[],today:null,updatedAt:123})
function deferred() { let resolve, reject; const promise=new Promise((a,b)=>{resolve=a;reject=b}); return {promise,resolve,reject} }
function harness(t, overrides={}, checkIn=false) {
  const saves=[], checkSaves=[]
  globalThis.guideTestIO={
    useAiSettings:()=>({settings:reactive({}),configured:ref(true)}),
    useProgress:()=>({get:()=>undefined,courseProgress:()=>({})}),
    dbFetchGuide:async()=>stored(), dbSaveGuide:async data=>{saves.push(structuredClone(data));return true},
    dbSaveSetting:async()=>true, databaseRequest:async()=>null,
    collectGuideMetadata:async()=>{}, dbFetchCheckIns:async()=>({}),
    dbSaveCheckIns:async (id,days)=>{checkSaves.push({id,days:structuredClone(days)});return true},
    ...overrides,
  }
  const active=ref(course('one'));let guide,clock
  const renderer=createRenderer({createComment:()=>({}),insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null})
  const app=renderer.createApp({setup(){
    guide=useLearningGuide(active)
    if(checkIn) clock=useStudyCheckIn(active,ref({today:null,dailyMinutes:30}))
    return ()=>null
  }})
  app.mount({});t.after(()=>app.unmount())
  return {guide,clock,active,saves,checkSaves,app}
}
test('导学尚未读取完成时，定时保存和退出均不写入空路线', async t=>{
  const pending=deferred();const h=harness(t,{dbFetchGuide:()=>pending.promise})
  h.guide.persist();await new Promise(resolve=>setTimeout(resolve,250))
  assert.equal(h.saves.length,0);assert.equal(h.guide.guideReady.value,false)
  h.app.unmount();pending.resolve(stored());await tick();assert.equal(h.saves.length,0)
})
test('导学读取失败后不生成、不自动保存，原记录不会被覆盖', async t=>{
  const h=harness(t,{dbFetchGuide:async()=>{throw Error('read failed')}});await tick()
  h.guide.persist();assert.equal(await h.guide.generate('新目标',30),false)
  assert.equal(h.saves.length,0);assert.match(h.guide.state.storageError,/读取失败/)
})
test('旧路线校验失败时保留数据库，不将空计划保存回去',async t=>{
  const h=harness(t,{dbFetchGuide:async()=>({...stored(),plan:{...plan(),lessons:[]}})});await tick()
  h.guide.persist();assert.equal(h.saves.length,0);assert.equal(h.guide.guideReady.value,false)
})
test('成功读取后恢复路线和对话，修改可保存',async t=>{
  const saved=stored();saved.plan.messages=[{role:'user',content:'保留我的目标'}]
  const h=harness(t,{dbFetchGuide:async()=>saved});await tick()
  assert.equal(h.guide.state.plan.createdAt,123);assert.equal(h.guide.state.plan.messages[0].content,'保留我的目标')
  h.guide.setDailyMinutes(45);h.guide.persist();await tick()
  assert.equal(h.saves.at(-1).plan.dailyMinutes,45)
})
test('切课后迟到的旧读取结果不会覆盖新课程',async t=>{
  const pending=deferred();const h=harness(t,{dbFetchGuide:id=>id==='one'?pending.promise:Promise.resolve(stored())})
  h.active.value=course('two');await tick();pending.resolve({...stored(),plan:{...plan(),summary:'旧课程'}});await tick()
  assert.equal(h.guide.state.plan.summary,'保留这条路线');h.guide.persist()
  assert.ok(h.saves.every(item=>item.courseId==='two'))
})
test('保存失败明确提示，允许重试',async t=>{
  const h=harness(t,{dbSaveGuide:async()=>false});await tick();h.guide.persist();await tick()
  assert.match(h.guide.state.storageError,/保存失败/)
})
test('打卡未读取或读取失败时，不用零时长覆盖已保存记录',async t=>{
  const pending=deferred();const h=harness(t,{dbFetchCheckIns:()=>pending.promise},true)
  h.clock.persist();assert.equal(h.checkSaves.length,0)
  pending.reject(Error('read failed'));await tick();h.clock.persist()
  assert.equal(h.checkSaves.length,0);assert.match(h.clock.state.storageError,/读取失败/)
})

test('调整计划与撤销只影响安排，保留调整后新增的实践记录与掌握程度', async t => {
  const saved = stored()
  saved.plan.program = { days: 30, startDate: '2026-09-21', budget: { video: 30, code: 15, project: 0, recap: 0 }, lightEvery: 0, lightMinutes: 30 }
  const h = harness(t, { dbFetchGuide: async () => saved }); await tick()
  const next = structuredClone(saved.plan)
  next.program.days = 40
  assert.equal(h.guide.applySchedule(next, '调整剩余计划'), true)
  h.guide.state.records.entries.push({ id: 'new', date: h.guide.todayDate.value, moduleId: 'm', taskId: 't', kind: 'code', title: '练习', instructions: '练习', targetMinutes: 15, minutes: 8, done: false, evidence: '代码已保存' })
  h.guide.setMastery('a.mp4', '变量', 'mastered')
  assert.equal(h.guide.undo(), true)
  assert.equal(h.guide.state.plan.program.days, 30)
  assert.equal(h.guide.state.records.entries.find(e => e.id === 'new').minutes, 8)
  assert.equal(Object.values(h.guide.state.mastery)[0].level, 'mastered')
  assert.equal(h.guide.state.plan.lessons[0].status, 'skipped')
})

test('没有 AI 路线时可直接按本地目录设置学习计划', async t => {
  const h = harness(t, { dbFetchGuide: async () => null }); await tick()
  const local = h.guide.planForScheduling()
  assert.equal(h.guide.state.plan, null)
  assert.deepEqual(local.lessons.map(l => l.path), ['a.mp4'])
  assert.equal(h.guide.applySchedule(local, '设置学习计划'), true)
  h.guide.persist(); await tick()
  assert.equal(h.saves.at(-1).plan.program.budget.video, 30)
})
