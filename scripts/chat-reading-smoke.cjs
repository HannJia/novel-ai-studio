// UI-only, isolated-browser regression. Requires the local fixture servers:
// node scripts/fixtures/inspiration-api.cjs
// npm exec vite -- --config scripts/fixtures/vite.config.mts
// node scripts/chat-reading-smoke.cjs [path-to-playwright]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require(process.argv[2] || 'playwright')

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-reading-smoke-'))
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      return url.hostname === '127.0.0.1' ? route.continue() : route.abort()
    })
    await page.goto('http://127.0.0.1:5175/#/settings')
    await page.getByRole('button', { name: '+ 添加模型', exact: true }).click()
    await page.getByPlaceholder('如：https://api.deepseek.com').fill('http://127.0.0.1:5175/__fixture')
    await page.getByPlaceholder('sk-...', { exact: true }).fill('local-ui-fixture')
    await page.getByPlaceholder('如：deepseek-chat / gpt-4o / qwen-max').fill('local-fixture')
    await page.getByRole('button', { name: '添加', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.getByRole('link', { name: '📚 我的书架' }).click()
    await page.getByRole('button', { name: '创建新书', exact: true }).click()
    await page.getByRole('radio', { name: '灵感模式 先与 AI 聊想法，整理并检查设定后再生成大纲。', exact: true }).check()
    await page.getByRole('button', { name: '开始灵感对话 →', exact: true }).click()

    const stats = () => page.evaluate(() => {
      const history = document.querySelector('.inspiration-history')
      const assistants = history.querySelectorAll('.assistant')
      const users = history.querySelectorAll('.user')
      const pin = document.querySelector('.inspiration-sticky-prompt')
      const rect = node => {
        const r = node.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }
      }
      return {
        history: rect(history), assistant: rect(assistants[assistants.length - 1]),
        user: rect(users[users.length - 1]), pin: rect(pin),
        prompt: pin.querySelector('p').textContent, top: history.scrollTop,
        overflow: document.documentElement.scrollWidth > innerWidth,
        composer: rect(document.querySelector('.inspiration-composer')),
        innerHeight,
      }
    })

    for (const size of [{ width: 1280, height: 720 }, { width: 689, height: 698 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size)
      for (const search of [false, true]) {
        const toggle = page.locator('.inspiration-search-toggle')
        if ((await toggle.getAttribute('aria-pressed') === 'true') !== search) await toggle.click()
        const count = await page.locator('.inspiration-message.assistant').count()
        const prompt = `滚动阅读回归 ${size.width} ${search ? '联网' : '流式'}：` +
          (search ? '这个问题很长，请完整保留我的每条要求。\n'.repeat(45) : '主角从小工厂起步，请列出因果链。')
        await page.getByRole('textbox', { name: '我想写一个怎样的故事？', exact: true }).fill(prompt)
        await page.getByRole('button', { name: '发送', exact: true }).click()
        await page.waitForFunction(expected =>
          document.querySelectorAll('.inspiration-message.assistant').length === expected &&
          !document.querySelector('[data-streaming-assistant]') &&
          !document.querySelector('.inspiration-progress'), count + 1)
        const initial = await stats()
        assert.ok(Math.abs(initial.assistant.top - initial.history.top - 12) < 2, JSON.stringify(initial))
        assert.equal(initial.prompt.trim(), prompt.trim())
        assert.equal(initial.overflow, false)
        assert.ok(initial.composer.bottom <= size.height + 1)
        assert.ok(initial.user.left > initial.assistant.left)
        assert.ok(initial.pin.bottom <= initial.history.top)

        await page.locator('.inspiration-history').press('PageDown')
        await page.waitForFunction(previous => document.querySelector('.inspiration-history').scrollTop > previous + 20, initial.top)
        const scrolled = await stats()
        assert.equal(scrolled.pin.top, initial.pin.top)
        assert.equal(scrolled.prompt.trim(), prompt.trim())
        if (search) {
          await page.getByRole('button', { name: '展开', exact: true }).click()
          assert.equal((await page.locator('#inspiration-current-prompt').textContent()).trim(), prompt.trim())
          const expanded = await stats()
          assert.ok(expanded.history.height >= 80)
          assert.ok(expanded.composer.bottom <= expanded.innerHeight + 1)
          await page.getByRole('button', { name: '收起', exact: true }).click()
        }
        await page.screenshot({ path: path.join(output, `chat-${size.width}-${search ? 'search' : 'stream'}.png`) })
      }
    }

    // The same empty test book goes through the normal wizard; no seeded store,
    // real credentials, user data directory or external API is involved.
    // The six long answers above exercise scrolling, not context limits.
    // Start a fresh creation flow before the separate extraction regression.
    await page.getByRole('button', { name: '返回书架', exact: true }).click()
    await page.getByRole('button', { name: '创建新书', exact: true }).click()
    await page.getByRole('radio', { name: '灵感模式 先与 AI 聊想法，整理并检查设定后再生成大纲。', exact: true }).check()
    await page.getByRole('button', { name: '开始灵感对话 →', exact: true }).click()
    await page.getByRole('textbox', { name: '我想写一个怎样的故事？', exact: true }).fill('写一个普通工人的创业故事')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await page.locator('.inspiration-message.assistant').waitFor()
    await page.getByRole('button', { name: '整理设定并检查', exact: true }).click()
    await page.getByRole('button', { name: '下一步 →', exact: true }).click()
    await page.getByRole('button', { name: '✨ 生成大纲', exact: true }).click()
    await page.getByRole('button', { name: '编辑大纲', exact: true }).waitFor()

    for (const size of [{ width: 1280, height: 720 }, { width: 689, height: 698 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size)
      const toolbar = page.locator('.outline-edit-toolbar')
      await toolbar.scrollIntoViewIfNeeded()
      const before = await toolbar.boundingBox()
      await page.locator('.outline-output-scroll').press('End')
      await page.waitForFunction(() => document.querySelector('.outline-output-scroll').scrollTop > 0)
      const after = await toolbar.boundingBox()
      assert.equal(before.y, after.y)
      const layout = await page.evaluate(() => {
        const toolbar = document.querySelector('.outline-edit-toolbar')
        const content = document.querySelector('.outline-output-scroll')
        const r = toolbar.getBoundingClientRect()
        return {
          separated: r.bottom <= content.getBoundingClientRect().top + 1,
          opaque: getComputedStyle(toolbar).backgroundColor,
          hitInsideToolbar: toolbar.contains(document.elementFromPoint(r.left + 15, r.top + r.height / 2)),
          overflow: document.documentElement.scrollWidth > innerWidth,
        }
      })
      assert.ok(layout.separated && layout.hitInsideToolbar)
      assert.notEqual(layout.opaque, 'rgba(0, 0, 0, 0)')
      assert.equal(layout.overflow, false)
      await page.getByRole('button', { name: '编辑大纲', exact: true }).click()
      await page.getByRole('button', { name: '取消修改', exact: true }).click()
      await page.screenshot({ path: path.join(output, `outline-${size.width}.png`) })
    }
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ passed: true, sizes: ['1280x720', '689x698', '390x844'], errors, screenshots: output }, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
