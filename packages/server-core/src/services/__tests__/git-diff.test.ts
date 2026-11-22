import { describe, expect, it } from 'bun:test'
import {
  isBinaryBuffer,
  isPathInsideRoot,
  normalizeLineEndings,
  parseGitStatusAndNumstat,
  parseNumstatZ,
} from '../git-diff'

describe('git-diff parsers', () => {
  it('parses NUL-delimited numstat entries including renames and binary files', () => {
    const raw = [
      '12\t3\tsrc/app.ts',
      '-\t-\tassets/logo.png',
      '4\t1\t',
      'src/old.ts',
      'src/new.ts',
      '',
    ].join('\0')

    const map = parseNumstatZ(raw)
    expect(map.get('src/app.ts')).toEqual({ additions: 12, deletions: 3, isBinary: false })
    expect(map.get('assets/logo.png')).toEqual({ additions: 0, deletions: 0, isBinary: true })
    expect(map.get('src/new.ts')).toEqual({ additions: 4, deletions: 1, isBinary: false })
  })

  it('parses porcelain -z status and combines staged + unstaged stats', () => {
    const porcelain = [
      ' M apps/electron/src/main.ts',
      'MM packages/shared/src/中文文件.ts',
      'R  src/renamed.ts',
      'src/original.ts',
      '?? docs/new-note.md',
      ' D obsolete.ts',
      '',
    ].join('\0')

    const unstaged = [
      '10\t2\tapps/electron/src/main.ts',
      '3\t1\tpackages/shared/src/中文文件.ts',
      '0\t15\tobsolete.ts',
      '',
    ].join('\0')

    const staged = [
      '5\t0\tpackages/shared/src/中文文件.ts',
      '2\t2\t',
      'src/original.ts',
      'src/renamed.ts',
      '',
    ].join('\0')

    const { files, truncated } = parseGitStatusAndNumstat(porcelain, unstaged, staged)
    expect(truncated).toBe(false)
    expect(files).toHaveLength(5)

    expect(files[0]).toMatchObject({
      path: 'apps/electron/src/main.ts',
      status: 'modified',
      code: 'M',
      staged: false,
      unstaged: true,
      additions: 10,
      deletions: 2,
    })

    expect(files[1]).toMatchObject({
      path: 'packages/shared/src/中文文件.ts',
      status: 'modified',
      staged: true,
      unstaged: true,
      additions: 8,
      deletions: 1,
    })

    expect(files[2]).toMatchObject({
      path: 'src/renamed.ts',
      oldPath: 'src/original.ts',
      status: 'renamed',
      code: 'R',
      additions: 2,
      deletions: 2,
    })

    expect(files[3]).toMatchObject({
      path: 'docs/new-note.md',
      status: 'untracked',
      code: '?',
    })

    expect(files[4]).toMatchObject({
      path: 'obsolete.ts',
      status: 'deleted',
      code: 'D',
      deletions: 15,
    })
  })

  it('detects binary buffers via NUL byte', () => {
    expect(isBinaryBuffer(Buffer.from('hello world\n你好世界'))).toBe(false)
    expect(isBinaryBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))).toBe(true)
  })

  it('validates repository-relative paths safely without false positives', () => {
    expect(isPathInsideRoot('D:/ClaudeWork/Shiori', 'D:/ClaudeWork/Shiori/apps/electron/src/main/index.ts')).toBe(true)
    expect(isPathInsideRoot('D:/ClaudeWork/Shiori', 'D:/ClaudeWork/Shiori/..weird-name.txt')).toBe(true)
    expect(isPathInsideRoot('D:/ClaudeWork/Shiori', 'D:/ClaudeWork/Shiori')).toBe(false)
    expect(isPathInsideRoot('D:/ClaudeWork/Shiori', 'D:/ClaudeWork/other.txt')).toBe(false)
    expect(isPathInsideRoot('D:/ClaudeWork/Shiori', 'C:/Windows/System32/drivers/etc/hosts')).toBe(false)
  })

  it('normalizes CRLF and CR line endings to LF so Windows working trees diff cleanly against HEAD', () => {
    expect(normalizeLineEndings('a\r\nb\r\nc\n')).toBe('a\nb\nc\n')
    expect(normalizeLineEndings('line1\rline2\r\nline3')).toBe('line1\nline2\nline3')
  })
})
