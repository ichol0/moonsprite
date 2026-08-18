import assert from 'node:assert/strict'
import test from 'node:test'
import { moduleBoundaryErrors } from './check-module-boundaries.mjs'

test('core 禁止依赖 React、Store 和平台模块', () => {
  const source = "import React from 'react'\nimport { useWorkspace } from '@/store/workspace'\nimport { api } from '@/platform/tauri-api'"
  assert.equal(moduleBoundaryErrors('src/renderer/src/core/example.ts', source).length, 3)
})

test('非 platform 模块禁止直接访问 Tauri', () => {
  const source = "import { invoke } from '@tauri-apps/api/core'"
  assert.equal(moduleBoundaryErrors('src/renderer/src/components/Example.tsx', source).length, 1)
})

test('Store 禁止反向依赖组件', () => {
  const source = "import { Dialog } from '@/components/Dialog'"
  assert.equal(moduleBoundaryErrors('src/renderer/src/store/example.ts', source).length, 1)
})

test('既有边界债务也必须由扫描器报告并交给数字预算管理', () => {
  const tauriSource = "import { getCurrentWindow } from '@tauri-apps/api/window'"
  const storeSource = "import type { DocumentSession } from '@/store/workspace'"
  assert.equal(moduleBoundaryErrors('src/renderer/src/App.tsx', tauriSource).length, 1)
  assert.equal(moduleBoundaryErrors('src/renderer/src/core/app-render-keys.ts', storeSource).length, 1)
})
