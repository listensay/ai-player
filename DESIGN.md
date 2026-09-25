# Headspace — Style Reference
> Sunlit wellness retreat on warm paper

**Theme:** light

Source measurements are normalized; roles and recommendations are interpreted. Font summary lists are independent, not paired by position. HTML examples are reconstructions, not source components.

Headspace lives in a sunlit wellness retreat on warm paper: a cream canvas (#f9f4f2) that breathes, bold rounded surfaces, and tightly tracked headlines that feel confident and calm rather than clinical. The palette is predominantly achromatic with a warm dark text scale (#2d2c2b, #44423f) that never goes cold-black on body copy, and color is deployed as deliberate emotional punctuation — Headspace yellow for energy, electric blue for the primary signup, and a deep violet for contemplative moments. Radii are generous: 16-32px on cards and feature blocks, 8px on buttons and inputs, and 9999px (800px in tokens) for pills and circular elements, giving every surface a soft, huggable quality. Typography is a single custom geometric sans (Headspace Apercu) at weights 400/500/700 with negative letter-spacing that tightens as sizes scale up, producing headlines that feel sculpted rather than shouted.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Page Cream | `#f9f4f2` | `--color-page-cream` | Page background, large section surfaces — the warm paper tone that sets the entire mood |
| Pure White | `#ffffff` | `--color-pure-white` | Card surfaces, elevated panels, input fills, inverse text on dark buttons |
| Charcoal Ink | `#2d2c2b` | `--color-charcoal-ink` | Supporting neutral for secondary UI, dividers, and muted labels. Do not promote it to the primary CTA color |
| Graphite | `#44423f` | `--color-graphite` | Secondary text, muted UI labels, icon strokes, nav links |
| Slate | `#4b4c4d` | `--color-slate` | Tertiary text, footer body, helper copy, low-emphasis borders |
| Stone | `#63605d` | `--color-stone` | Disabled states, lowest-emphasis text, decorative dividers |
| Driftwood | `#c6c1b9` | `--color-driftwood` | Hairline list dividers, subtle structural separators |
| Linen | `#e2ded9` | `--color-linen` | Card borders, input borders, subtle elevation shadows — the neutral that separates surfaces on cream |
| Ash | `#d0d0d0` | `--color-ash` | Input border, focused field rings, checkbox borders |
| Soft Black | `#000000` | `--color-soft-black` | True black for maximum-contrast dark buttons and bold display text |
| Brand Orange | `#f47d31` | `--color-brand-orange` | Headspace logo mark — the single warm dot that anchors the brand identity across all surfaces |
| Mindful Blue | `#0061ef` | `--color-mindful-blue` | Violet supporting accent for decorative details and low-frequency emphasis. Do not promote it to the primary CTA color |
| Sunbeam Yellow | `#ffce00` | `--color-sunbeam-yellow` | Headspace signature brand yellow — top banner backgrounds, feature card highlights, optimistic punctuation |
| Deep Indigo | `#3b197f` | `--color-deep-indigo` | Contemplative illustration fills, meditation-related visual moments — the serious counterpart to the cheerful yellow |
| Twilight Violet | `#281466` | `--color-twilight-violet` | Deep illustration fills paired with Deep Indigo, gradient companion, night-mode meditation contexts |
| Plum | `#5f2b89` | `--color-plum` | Mid-tone violet for illustration gradients and decorative fills |
| Mauve | `#8144a8` | `--color-mauve` | Lighter violet in illustration gradients — soft, warm purple |
| Celeste | `#00a4ff` | `--color-celeste` | Bright sky blue used in category icons and decorative illustration accents |

## Tokens — Typography

### Headspace Apercu — Single-family system used for everything from body copy to display headlines. Weights are 400 (body), 500 (subheadings, nav), 700 (headings, buttons). The custom geometric forms give a friendly-but-precise feel; tight tracking on display sizes sculpts the headlines into confident shapes rather than defaulting to bold shouts. · `--font-headspace-apercu`
- **Substitute:** Inter, DM Sans, or Plus Jakarta Sans
- **Weights:** 400, 500, 700
- **Sizes:** 12, 14, 16, 18, 20, 24, 29, 32, 40, 48, 52, 56, 64, 72
- **Line height:** 1.2-1.5 body, 0.73-1.2 display
- **Letter spacing:** -0.0100em body, -0.0250em medium, -0.0300em display
- **OpenType features:** `'ss01' on, 'cv11' on`
- **Role:** Single-family system used for everything from body copy to display headlines. Weights are 400 (body), 500 (subheadings, nav), 700 (headings, buttons). The custom geometric forms give a friendly-but-precise feel; tight tracking on display sizes sculpts the headlines into confident shapes rather than defaulting to bold shouts.

### Type Scale

| Role | Family | Weight | Size | Line Height | Letter Spacing | Token |
|------|--------|--------|------|-------------|----------------|-------|
| caption | — | — | 12px | 1.5 | -0.12px | `--text-caption` |
| body-sm | — | — | 14px | 1.5 | -0.14px | `--text-body-sm` |
| body | — | — | 16px | 1.5 | -0.16px | `--text-body` |
| subheading | — | — | 20px | 1.33 | -0.5px | `--text-subheading` |
| heading-sm | — | — | 24px | 1.33 | -0.6px | `--text-heading-sm` |
| heading | — | — | 32px | 1.3 | -0.8px | `--text-heading` |
| heading-lg | — | — | 40px | 1.29 | -1px | `--text-heading-lg` |
| display | — | — | 52px | 1.13 | -1.56px | `--text-display` |
| display-lg | — | — | 72px | 1.1 | -2.16px | `--text-display-lg` |

## Tokens — Spacing & Shapes

**Base unit:** 4px

**Density:** comfortable

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 20 | 20px | `--spacing-20` |
| 24 | 24px | `--spacing-24` |
| 32 | 32px | `--spacing-32` |
| 40 | 40px | `--spacing-40` |
| 48 | 48px | `--spacing-48` |
| 56 | 56px | `--spacing-56` |
| 60 | 60px | `--spacing-60` |
| 64 | 64px | `--spacing-64` |
| 80 | 80px | `--spacing-80` |
| 84 | 84px | `--spacing-84` |
| 96 | 96px | `--spacing-96` |
| 100 | 100px | `--spacing-100` |

### Border Radius

| Element | Value |
|---------|-------|
| cards | 16px |
| pills | 800px |
| small | 8px |
| inputs | 8px |
| buttons | 800px |
| featured | 24-32px |

### Shadows

| Name | Value | Token |
|------|-------|-------|
| subtle | `rgba(65, 61, 69, 0.2) 0px 2px 0px 0px` | `--shadow-subtle` |

### Layout

- **Page max-width:** 1200px
- **Section gap:** 64px
- **Card padding:** 32-48px
- **Element gap:** 8-16px

## Components

### 输入控件

所有表单输入统一使用 Vuetify 组件：文本和数字使用 `VTextField`，多行内容使用 `VTextarea`，选择项使用 `VSelect`、`VCheckbox` 或 `VRadioGroup`，文件选择使用 `VFileInput`，播放进度和音量使用 `VSlider`。应用模板不再直接使用原生 `input`、`textarea`、`select` 或手写滑块；保留组件自带的键盘操作与无障碍语义。

输入框采用白色背景、Linen 细边框与 8px 圆角；无提示或校验信息时不预留底部空白。播放滑块使用 Linen 轨道、Charcoal Ink 已播放部分与 Sunbeam Yellow 圆形手柄。

搜索框使用 `VTextField` 的浮动标签、Lucide 搜索图标和组件清空按钮，不只保留占位文字与边框；隐藏浏览器自带的搜索装饰和清空按钮，避免出现两套控件。清空后恢复完整结果。

### 课程概览布局

概览兼顾扫读和留白：顶部展示课程、进度与学习入口；桌面左侧展示课程列表，右侧依次纵向排列今日任务、当前阶段和完整月历，支持切换月份和选择日期。小屏自然纵向排列，不强制把所有内容压进一个视口。

概览最大宽度为 1440px，桌面区域间距 24px，卡片内边距 20–24px；手机区域间距 20px。搜索框与状态筛选组统一为 40px 高度。七天投入保留月历下方的紧凑七列图表，日历与其他卡片不互相拉伸。概览月历精简重复的统计卡片，保留日期网格、今日目标和所选日期记录；任务明细继续使用 Vuetify 弹窗。长课程列表限制自身高度，页面允许自然滚动。

### 扩展面板

可展开的课程章节、阶段详情、实践说明和练习内容统一使用 Vuetify 的 `VExpansionPanels`、`VExpansionPanel`、`VExpansionPanelTitle` 与 `VExpansionPanelText`。使用组件自带的交互、键盘操作、展开动画和延迟渲染，不再使用原生 `details/summary` 或自行组合按钮和隐藏容器实现面板。

外观采用白色背景、Linen 细边框、16px 圆角和 Lucide 展开图标；标题展开前后保持一致高度，不增加阴影。长列表继续分页，关闭的重型内容不提前渲染。

正文与标题之间保留 12px 内边距，正文左右及底部保持 16px，不让进度、说明或输入框紧贴标题。侧栏目录保留紧凑排列，不叠加正文内边距。

### 知识点与每日练习

播放器右侧依次为“知识点 / 笔记 / 逐字稿”，每次打开课节默认展示知识点；选中页签与知识点序号使用黄色重点。知识点卡片展示标题、要点和来源时间，长内容在右栏独立滚动。转写、模型准备、整理进度、取消与错误重试均在该面板显示。

概览、播放器和今日学习安排提供“今日巩固”入口，显示视频完成进度或作答进度。每日弹窗复用课后练习布局，提供稍后继续、作答统计与来源课节回看，避免重复弹出。

### 课后练习弹窗

弹窗最大宽度 920px、高度不超过视口的 92% 或 980px，顶部和底部固定，中间独立滚动。白色阅读面上使用居中的正文列，内容宽度约 680px，桌面内边距 32px；题目正文 17px、反馈 16px，行高 1.9。代码使用等宽字体、浅奶油色背景与细边框，代码块保留缩进并允许横向滚动。

顶部题目选择器只显示题号和总数，长知识点名称收进下拉列表与详情；保留上一题 / 下一题入口。“作答”和“反馈解析”独立切换，切题返回题目顶部，提交后进入反馈。反馈依次展示本次作答、需要调整、已答对和下一步，长段落在完整句子后留白，不改写历史记录。参考答案、知识点与作答要求、掌握记录和参考材料保持折叠，反馈中可展开查看题目。

材料设置使用独立视图并提供返回入口。底部突出当前主要动作，将再练一题 / 一组合并到“继续出题”菜单；请求期间显示进度和取消，题目及答案保持正常对比度。材料不足、配置缺失或保存失败时显示对应提示，重复提交禁用。

### 链接与文字操作

链接及文字操作按钮在默认、悬停（hover）、聚焦和按下状态均不使用文字下划线，包括课程标题、回看入口、笔记正文链接和链接预览浮层。不要使用 `underline`、`hover:underline` 或通过底边框模拟下划线。

用文字颜色、字重和已有的按钮背景区分可点击内容；悬停时可使用 Deep Indigo，键盘操作保留清晰的焦点轮廓。正文链接使用 Mindful Blue。完成事项的删除线属于状态标记，继续保留。

### Yellow Announcement Banner
**Role:** Top-of-page promotional strip

Full-width #ffce00 background, dark #2d2c2b text, centered, single-line message. 32-40px vertical padding, 14-16px body text. No close button visible. The warm yellow immediately sets the brand tone.

### Primary Navigation Bar
**Role:** Site-wide navigation

White (#ffffff) background, 1px bottom border in #e2ded9. Logo (orange dot + 'headspace' wordmark) left, centered nav links (For You, For Business, For Providers, Our Plans, Resources, About) in #2d2c2b at 16px weight 500, right side has Log In text link, Help text link, and blue #0061ef 'Try for free' pill button.

### Primary Blue CTA Button
**Role:** Main signup / go action

Background #0061ef, white text, 800px (fully pill) border-radius, 12px 24px padding, 16px weight 700 text. Highest visual emphasis in any interface. Used for top-level conversions.

### Dark Pill Button
**Role:** Secondary action / product-level CTA

Background #2d2c2b (or #000000 for true black), white text, 800px radius, 14-16px 28px padding, 16px weight 700. Features a 2px solid offset shadow in rgba(65,61,69,0.2) giving a printed-sticker depth cue. Used for 'Try for $0', 'Check your coverage', and 'Subscribe'.

### Hero Feature Card
**Role:** Large dual-purpose content block

Two large cards side-by-side. Background #f9f4f2 or #ffffff, 24-32px border-radius, 48px internal padding. Contains a centered heading (32-40px weight 700), dark pill CTA below, and a phone-screenshot mockup with decorative illustration elements. Generous whitespace, no visible border — surface difference from page cream defines the card.

### Category Card
**Role:** Topic navigation tile

White (#ffffff) background, 16px border-radius, 1px #e2ded9 border, 20-24px padding. Layout: text label left (16px weight 500 in #2d2c2b), colored icon glyph center-right, chevron right. Icon colors vary by category: yellow lightning, purple moon, teal spiral, pink smiley, orange circle, blue speech. Arranged in a 3-column grid.

### Filter Pill
**Role:** Section tab / category filter

Two variants: active = #2d2c2b background, white text, 800px radius, 12px 20px padding, 14px weight 500, with a small white dot indicator. Inactive = white background, #2d2c2b text, 1px #e2ded9 border, same dimensions. Horizontal row layout.

### Content Feature Card
**Role:** Full-width colored content highlight

Large card with a vivid brand-color background (#ffce00 yellow primary, #ffa1cc pink, #00a4ff blue variants). 24-32px radius. Contains a small floating chat-style UI mockup (white card with message bubble) over the colored surface, with a large display heading beside it in #2d2c2b.

### Email Subscribe Form
**Role:** Newsletter capture

Inline row: white (#ffffff) email input (8px radius, 1px #d0d0d0 border, 16px weight 400 placeholder) adjacent to a dark pill 'Subscribe' button (#2d2c2b). Input takes ~60% width, button ~30%. Stacks on mobile.

### Footer Link Directory
**Role:** Site map / secondary navigation

6-column grid on #f9f4f2 background. Column headers (16px weight 700 #2d2c2b), links (14px weight 400 #63605d, 10-12px row gap). 'Get the app' column contains black App Store and Google Play badge buttons. Copyright and legal links in a thin #2d2c2b strip below.

### App Store Badge Button
**Role:** Download CTA in footer

Black (#000000) rounded rectangle, white Apple/Google logo and 'Download on the App Store' / 'GET IT ON Google Play' text. ~140px wide, 8px radius. Official badge styling — not custom.

### Notification Toast / Chat Bubble
**Role:** In-context AI companion UI

White card, 12-16px radius, small drop shadow. Contains a colored dot avatar (brand color), bold user label, and message text in #44423f. Used as decorative UI element overlaid on content cards to suggest the Ebb AI companion.

## Do's and Don'ts

### Do
- Use Page Cream (#f9f4f2) as the default canvas — never substitute pure gray or white as the page background
- Use 800px border-radius for all primary buttons, CTAs, and pills to maintain the huggable, rounded character
- Apply Headspace Apercu weight 700 with -0.0300em letter-spacing for any display-sized heading (40px+) — the tight tracking is the signature
- Use Sunbeam Yellow (#ffce00) sparingly as emotional punctuation for banners and feature highlights, not as a default surface color
- Pair dark pill buttons (#2d2c2b) with the 2px solid charcoal offset shadow for a printed-sticker depth effect
- Use Mindful Blue (#0061ef) exclusively for the single highest-priority action per view — never spread it across multiple buttons
- Build section rhythm with 64px vertical gaps between major bands; cards within a band breathe with 24-32px gaps
- Ground the brand with the orange logo dot (#f47d31) in the top-left of every page — it is the only element that never changes

### Don't
- Do not use #000000 for body text — the warm dark #2d2c2b keeps the interface from feeling clinical
- Do not apply heavy drop shadows to cards; rely on the cream/white surface contrast and 1px Linen (#e2ded9) borders instead
- Do not use sharp corners (0-4px radius) on cards or buttons — the entire system speaks soft and rounded
- Do not introduce new saturated colors outside the brand palette; every chromatic choice should map to mindfulness/calm/energy
- Do not center-align long body copy — left-align paragraphs of 16px+ text; center only short headlines and single statements
- Do not use outline-only monoline icons — Headspace icons are filled, colorful, and rounded
- Do not stretch the nav or footer to different background colors from the page cream — keep the warm paper continuous
- Do not use letter-spacing 0 or positive values on headings — the negative tracking from 400px upward is non-negotiable for brand recognition

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Page Cream | `#f9f4f2` | Base canvas — the warm paper tone of the entire site |
| 1 | Pure White | `#ffffff` | Card surfaces, category cards, email input fields |
| 2 | Sunbeam Yellow | `#ffce00` | Feature content cards, brand-accent surfaces |
| 3 | Blush | `#ffa1cc` | Alternate accent surface for content variety |
| 4 | Celeste | `#00a4ff` | Rare chromatic surface for standout feature blocks |

## Elevation

- **Dark buttons:** `rgba(65, 61, 69, 0.2) 0px 2px 0px 0px`
- **Cards on cream:** `0 1px 2px rgba(0,0,0,0.04) — hairline border preferred over shadow`

## Imagery

Illustration-led with photographic interludes. Category navigation uses flat geometric icon badges (lightning bolt, crescent moon, spiral, smiley, circle, speech bubble) in brand colors on white. Feature cards combine real product-screenshot crops (phone frames showing the app interface like Managing Anxiety, therapy sessions) with flat, friendly 2D illustration — soft organic shapes, abstract characters, warm color washes in the yellow/violet/blue palette. Hero sections blend product mockups with decorative blob shapes. Photography appears sparingly — therapy provider headshots are real portraits with warm natural lighting, not stylized. Icons in the category grid are filled, multi-colored, and rounded — never outlined monoline. The overall feel is craft-illustration meets real product: warm, hand-built, optimistic.

## Layout

Full-bleed bands alternating between cream and white card-on-cream compositions. Hero is a centered headline-over-content-block pattern with the brand statement above two large side-by-side feature cards. Navigation is a simple white top bar (logo left, links center, login + blue CTA right) with a high-contrast yellow announcement strip above it. Content sections follow a rhythm of: eyebrow pills/tabs → centered display headline → 2-column or 3-column card grids → large single full-width colored content card. The footer is a dense 6-column link directory on cream with email capture above and app store badges beside login. Cards within grids use generous 24-32px gaps; the page breathes with 64px section gaps. No sidebar, no mega-menu — every section is a clean horizontal band.

## Agent Prompt Guide

**Quick Color Reference**
- text: #2d2c2b (body), #000000 (display), #44423f (secondary)
- background: #f9f4f2 (page), #ffffff (card)
- border: #e2ded9 (card), #d0d0d0 (input)
- accent: #ffce00 (yellow banner), #f47d31 (logo)
- primary action: no distinct CTA color
- dark button: #2d2c2b (secondary dark pill)

**Example Component Prompts**
1. **Build a navigation bar**: White (#ffffff) background, 1px bottom border in #e2ded9. Left: orange dot (#f47d31) + 'headspace' wordmark in #2d2c2b. Center: nav links in 16px weight 500 #2d2c2b. Right: 'Log In' text link, 'Help' text link, then a blue 'Try for free' pill button (#0061ef bg, white text, 800px radius, 12px 24px padding, 16px weight 700).

2. **Build a hero feature card**: Background #f9f4f2, 32px border-radius, 48px padding. Centered heading at 40px weight 700 in #2d2c2b with -1.0px letter-spacing. Below it, a dark pill button: #2d2c2b background, white text, 800px radius, 14px 28px padding, shadow rgba(65,61,69,0.2) 0px 2px 0px 0px. Lower portion contains a phone mockup with decorative illustration.

3. **Build a category tile card**: White (#ffffff) background, 16px radius, 1px #e2ded9 border, 24px padding. Layout: 'Stress less' label in 16px weight 500 #2d2c2b on the left, a yellow (#ffce00) lightning-bolt icon in the center, and a right-pointing chevron in #44423f on the far right.

4. **Build a yellow content card**: Full-width #ffce00 background, 32px radius, 64px padding. Left side: a small white chat-bubble card (12px radius, soft shadow) with a purple dot avatar, 'You' label in 14px weight 700, and message text in #44423f. Right side: large heading at 48px weight 700 in #2d2c2b, -1.2px letter-spacing.

5. **Build a footer link column**: On #f9f4f2 background, column header at 16px weight 700 #2d2c2b, followed by 6-8 links at 14px weight 400 #63605d with 10-12px row gap. No background, no border — open layout on the cream canvas.

## Similar Brands

- **Calm** — Same warm cream + accent yellow palette, generous rounded cards, single primary blue action button, and meditation/mental-health visual territory
- **Calm app** — Shared pill-radius buttons, large soft product mockups in feature cards, and illustrated decorative blob shapes over colored content surfaces
- **Notion** — Similar warm dark text (#2d2c2b range) instead of clinical black, tight negative letter-spacing on display headings, and cream/white surface contrast philosophy
- **Mailchimp** — Same voice — friendly geometric sans, cream canvas, bold single-color feature cards, and rounded pill CTAs in primary blue
- **Spotify** — Shared brand color usage strategy — one vivid accent dominates, the rest of the interface stays in a warm neutral scale with generous radii

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors */
  --color-page-cream: #f9f4f2;
  --color-pure-white: #ffffff;
  --color-charcoal-ink: #2d2c2b;
  --color-graphite: #44423f;
  --color-slate: #4b4c4d;
  --color-stone: #63605d;
  --color-driftwood: #c6c1b9;
  --color-linen: #e2ded9;
  --color-ash: #d0d0d0;
  --color-soft-black: #000000;
  --color-brand-orange: #f47d31;
  --color-mindful-blue: #0061ef;
  --color-sunbeam-yellow: #ffce00;
  --color-deep-indigo: #3b197f;
  --color-twilight-violet: #281466;
  --color-plum: #5f2b89;
  --color-mauve: #8144a8;
  --color-celeste: #00a4ff;

  /* Typography — Font Families */
  --font-headspace-apercu: 'Headspace Apercu', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 12px;
  --leading-caption: 1.5;
  --tracking-caption: -0.12px;
  --text-body-sm: 14px;
  --leading-body-sm: 1.5;
  --tracking-body-sm: -0.14px;
  --text-body: 16px;
  --leading-body: 1.5;
  --tracking-body: -0.16px;
  --text-subheading: 20px;
  --leading-subheading: 1.33;
  --tracking-subheading: -0.5px;
  --text-heading-sm: 24px;
  --leading-heading-sm: 1.33;
  --tracking-heading-sm: -0.6px;
  --text-heading: 32px;
  --leading-heading: 1.3;
  --tracking-heading: -0.8px;
  --text-heading-lg: 40px;
  --leading-heading-lg: 1.29;
  --tracking-heading-lg: -1px;
  --text-display: 52px;
  --leading-display: 1.13;
  --tracking-display: -1.56px;
  --text-display-lg: 72px;
  --leading-display-lg: 1.1;
  --tracking-display-lg: -2.16px;

  /* Typography — Weights */
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-bold: 700;

  /* Spacing */
  --spacing-unit: 4px;
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-40: 40px;
  --spacing-48: 48px;
  --spacing-56: 56px;
  --spacing-60: 60px;
  --spacing-64: 64px;
  --spacing-80: 80px;
  --spacing-84: 84px;
  --spacing-96: 96px;
  --spacing-100: 100px;

  /* Layout */
  --page-max-width: 1200px;
  --section-gap: 64px;
  --card-padding: 32-48px;
  --element-gap: 8-16px;

  /* Border Radius */
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-2xl: 16px;
  --radius-3xl: 24px;
  --radius-3xl-2: 32px;
  --radius-full: 112px;
  --radius-full-2: 800px;

  /* Named Radii */
  --radius-cards: 16px;
  --radius-pills: 800px;
  --radius-small: 8px;
  --radius-inputs: 8px;
  --radius-buttons: 800px;
  --radius-featured: 24-32px;

  /* Shadows */
  --shadow-subtle: rgba(65, 61, 69, 0.2) 0px 2px 0px 0px;

  /* Surfaces */
  --surface-page-cream: #f9f4f2;
  --surface-pure-white: #ffffff;
  --surface-sunbeam-yellow: #ffce00;
  --surface-blush: #ffa1cc;
  --surface-celeste: #00a4ff;
}
```

### Tailwind v4

```css
@theme {
  /* Colors */
  --color-page-cream: #f9f4f2;
  --color-pure-white: #ffffff;
  --color-charcoal-ink: #2d2c2b;
  --color-graphite: #44423f;
  --color-slate: #4b4c4d;
  --color-stone: #63605d;
  --color-driftwood: #c6c1b9;
  --color-linen: #e2ded9;
  --color-ash: #d0d0d0;
  --color-soft-black: #000000;
  --color-brand-orange: #f47d31;
  --color-mindful-blue: #0061ef;
  --color-sunbeam-yellow: #ffce00;
  --color-deep-indigo: #3b197f;
  --color-twilight-violet: #281466;
  --color-plum: #5f2b89;
  --color-mauve: #8144a8;
  --color-celeste: #00a4ff;

  /* Typography */
  --font-headspace-apercu: 'Headspace Apercu', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 12px;
  --leading-caption: 1.5;
  --tracking-caption: -0.12px;
  --text-body-sm: 14px;
  --leading-body-sm: 1.5;
  --tracking-body-sm: -0.14px;
  --text-body: 16px;
  --leading-body: 1.5;
  --tracking-body: -0.16px;
  --text-subheading: 20px;
  --leading-subheading: 1.33;
  --tracking-subheading: -0.5px;
  --text-heading-sm: 24px;
  --leading-heading-sm: 1.33;
  --tracking-heading-sm: -0.6px;
  --text-heading: 32px;
  --leading-heading: 1.3;
  --tracking-heading: -0.8px;
  --text-heading-lg: 40px;
  --leading-heading-lg: 1.29;
  --tracking-heading-lg: -1px;
  --text-display: 52px;
  --leading-display: 1.13;
  --tracking-display: -1.56px;
  --text-display-lg: 72px;
  --leading-display-lg: 1.1;
  --tracking-display-lg: -2.16px;

  /* Spacing */
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-40: 40px;
  --spacing-48: 48px;
  --spacing-56: 56px;
  --spacing-60: 60px;
  --spacing-64: 64px;
  --spacing-80: 80px;
  --spacing-84: 84px;
  --spacing-96: 96px;
  --spacing-100: 100px;

  /* Border Radius */
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-2xl: 16px;
  --radius-3xl: 24px;
  --radius-3xl-2: 32px;
  --radius-full: 112px;
  --radius-full-2: 800px;

  /* Shadows */
  --shadow-subtle: rgba(65, 61, 69, 0.2) 0px 2px 0px 0px;
}
```
