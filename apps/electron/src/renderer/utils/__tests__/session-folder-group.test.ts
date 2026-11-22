import { describe, expect, it } from 'bun:test'
import {
  WORKSPACE_FOLDER_GROUP_KEY,
  getFolderGroupKey,
  getFolderGroupLabel,
  getFolderLabelFromGroupKey,
  normalizeWorkingDirForGroup,
} from '../session-folder-group'

describe('session-folder-group', () => {
  it('normalizes Windows and POSIX paths consistently', () => {
    expect(normalizeWorkingDirForGroup('D:\\ClaudeWork\\Shiori\\')).toBe('d:/claudework/shiori')
    expect(normalizeWorkingDirForGroup('d:/ClaudeWork/Shiori')).toBe('d:/claudework/shiori')
    expect(normalizeWorkingDirForGroup('/Users/alice/dev/shiori/')).toBe('/Users/alice/dev/shiori')
    expect(normalizeWorkingDirForGroup('/')).toBe('/')
    expect(normalizeWorkingDirForGroup('C:\\')).toBe('c:/')
    expect(normalizeWorkingDirForGroup('')).toBeNull()
    expect(normalizeWorkingDirForGroup(undefined)).toBeNull()
  })

  it('produces identical group keys for equivalent Windows directory casings', () => {
    const a = getFolderGroupKey('D:\\ClaudeWork\\Shiori')
    const b = getFolderGroupKey('d:/claudework/shiori/')
    expect(a).toBe(b)
    expect(a).toBe('folder:d:/claudework/shiori')
    expect(getFolderGroupKey(undefined)).toBe(WORKSPACE_FOLDER_GROUP_KEY)
  })

  it('extracts readable basenames and fallback labels', () => {
    expect(getFolderGroupLabel('D:\\ClaudeWork\\Shiori', '通用会话')).toBe('Shiori')
    expect(getFolderGroupLabel('/Users/alice/projects/app/', 'General')).toBe('app')
    expect(getFolderGroupLabel('C:\\', 'General')).toBe('C:\\')
    expect(getFolderGroupLabel(undefined, '通用会话')).toBe('通用会话')
  })

  it('derives labels from collapsed group keys', () => {
    expect(getFolderLabelFromGroupKey('folder:d:/claudework/shiori', '通用会话')).toBe('shiori')
    expect(getFolderLabelFromGroupKey(WORKSPACE_FOLDER_GROUP_KEY, '通用会话')).toBe('通用会话')
  })
})
