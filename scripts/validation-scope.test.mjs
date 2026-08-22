import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyValidationScope, getRendererCodeFiles, isRendererCodeFile } from './validation-scope.mjs'

test('文档修改不触发应用构建', () => {
  assert.deepEqual(
    classifyValidationScope(['docs/product/behavior.md']),
    { files: ['docs/product/behavior.md'], full: false, web: false, rust: false, thumbnail: false, desktop: false },
  )
})

test('渲染器、Rust 与缩略图修改分别触发对应范围', () => {
  assert.equal(classifyValidationScope(['src/renderer/src/App.tsx']).web, true)
  const rust = classifyValidationScope(['src-tauri/src/lib.rs'])
  assert.equal(rust.rust, true)
  assert.equal(rust.desktop, true)
  assert.equal(rust.thumbnail, false)
  const thumbnail = classifyValidationScope(['src-tauri/thumbnail-provider/src/lib.rs'])
  assert.equal(thumbnail.thumbnail, true)
  assert.equal(thumbnail.rust, false)
})

test('依赖、配置和 CI 变化使用保守的完整范围', () => {
  for (const file of ['package.json', 'pnpm-lock.yaml', '.github/workflows/ci.yml']) {
    const scope = classifyValidationScope([file])
    assert.equal(scope.full, true)
    assert.equal(scope.web, true)
    assert.equal(scope.rust, true)
    assert.equal(scope.thumbnail, true)
  }
})

test('手动完整验证覆盖所有范围', () => {
  const scope = classifyValidationScope([], { forceFull: true })
  assert.deepEqual(
    scope,
    { files: [], full: true, web: true, rust: true, thumbnail: true, desktop: true },
  )
})

test('开发模式不让工程配置变化扩散到无关原生范围', () => {
  const scope = classifyValidationScope(['package.json'], { expandFull: false })
  assert.deepEqual(
    scope,
    { files: ['package.json'], full: true, web: true, rust: false, thumbnail: false, desktop: false },
  )
})

test('定向 Renderer 文件范围不包含样式、文档或 Rust 文件', () => {
  assert.equal(isRendererCodeFile('src/renderer/src/components/Toolbar.tsx'), true)
  assert.equal(isRendererCodeFile('src/shared/types.ts'), true)
  assert.equal(isRendererCodeFile('src/renderer/src/styles.css'), false)
  assert.equal(isRendererCodeFile('src-tauri/src/lib.rs'), false)
  assert.deepEqual(
    getRendererCodeFiles([
      'src/renderer/src/components/Toolbar.tsx',
      'src/renderer/src/components/Toolbar.tsx',
      'src/renderer/src/styles.css',
      'docs/product/behavior.md',
    ]),
    ['src/renderer/src/components/Toolbar.tsx'],
  )
})
