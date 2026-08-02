import { execFileSync } from 'node:child_process'
import { classifyPerformanceImpact } from './performance-scope-rules.mjs'

const requestedFiles = process.argv.slice(2).filter((argument) => argument !== '--')
const changedFiles = () => {
  const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).split(/\r?\n/)
  const untracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).split(/\r?\n/)
  return [...new Set([...tracked, ...untracked].filter((file) => file && !file.replaceAll('\\', '/').startsWith('resource/')))]
}
const files = requestedFiles.length > 0 ? requestedFiles : changedFiles()
const result = classifyPerformanceImpact(files)

console.log(`性能影响等级：${result.level}`)
if (result.files.length === 0) console.log('没有检测到未提交改动。')
else for (const file of result.files) console.log(`- ${file}`)
if (result.commands.length === 0) console.log('无需运行性能基准。')
else {
  console.log('建议运行：')
  for (const command of result.commands) console.log(`- ${command}`)
}
