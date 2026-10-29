// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { buildTreeMenu } from './treeMenu'
import { NumberPromptDialog } from '../common/NumberPromptDialog'
import { useExplorerStore, CHILD_PAGE_SIZE } from '../../stores/explorer'
import { installJsdomLayout } from '../../testing/jsdomLayout'
import type { MenuActionEntry } from '../common/ContextMenu'
import type { MoreRow, NodeRow } from './treeData'
import type { ObjectInstance } from '../../api/types'

/**
 * The paging controls on a "Show more" row. Right-clicking that row is the
 * gesture for "this node has 1,000 children and I want more than a page", so
 * the menu has to offer both a custom count and everything, and the custom
 * count has to go through a real dialog: Electron's renderer does not
 * implement window.prompt.
 */

beforeAll(installJsdomLayout)
afterEach(() => {
  cleanup()
  useExplorerStore.setState({ childPageLimits: new Map() })
  useExplorerStore.getState().reset()
})

const moreRow: MoreRow = {
  kind: 'more',
  key: 'hier/P#more',
  depth: 2,
  parentId: 'hier:P',
  shown: CHILD_PAGE_SIZE,
  hidden: 950,
  parentIndex: 0,
}

function actions(entries: ReturnType<typeof buildTreeMenu>): MenuActionEntry[] {
  return (entries ?? []).filter((e): e is MenuActionEntry => e.kind === 'action')
}

describe('the "Show more" row menu', () => {
  it('offers one page, a custom count, and everything', () => {
    const labels = actions(buildTreeMenu(moreRow, vi.fn(), vi.fn())).map(e => e.label)
    expect(labels).toEqual([
      `Show ${CHILD_PAGE_SIZE} more`,
      'Show a specific number…',
      'Show all children',
    ])
  })

  it('raises the limit by one page, and to everything', () => {
    const entries = actions(buildTreeMenu(moreRow, vi.fn(), vi.fn()))
    entries[0].onSelect()
    expect(useExplorerStore.getState().childPageLimits.get('hier:P')).toBe(CHILD_PAGE_SIZE * 2)

    entries[2].onSelect()
    expect(useExplorerStore.getState().childPageLimits.get('hier:P')).toBe(Infinity)
  })

  it('hands the custom count off to the view rather than prompting itself', () => {
    const prompt = vi.fn()
    actions(buildTreeMenu(moreRow, vi.fn(), prompt))[1].onSelect()
    expect(prompt).toHaveBeenCalledWith('hier:P', 950)
    // Nothing revealed yet: the dialog decides.
    expect(useExplorerStore.getState().childPageLimits.has('hier:P')).toBe(false)
  })

  it('never offers more than remains hidden', () => {
    const nearlyDone = { ...moreRow, hidden: 7 }
    const labels = actions(buildTreeMenu(nearlyDone, vi.fn(), vi.fn())).map(e => e.label)
    expect(labels[0]).toBe('Show 7 more')
  })
})

it('expands and collapses cached component subtrees whose parentIds point elsewhere', () => {
  const parent: ObjectInstance = {
    elementId: 'parent', displayName: 'Parent', typeId: 'T',
    parentId: null, namespaceUri: 'urn:test', isComposition: true,
  }
  const remote = { ...parent, elementId: 'remote', parentId: 'elsewhere', sourceRelationship: 'HasComponent' }
  const leaf = { ...remote, elementId: 'leaf', isComposition: false }
  useExplorerStore.getState().setAllObjects([parent])
  useExplorerStore.setState({
    relatedObjects: new Map([['parent', [remote]], ['remote', [leaf]]]),
    childPageLimits: new Map([['hier:parent', 400], ['hier:remote', 400]]),
  })
  const row: NodeRow = {
    kind: 'node', key: 'parent', id: 'hier:parent', nodeType: 'object', data: parent,
    label: 'Parent', depth: 1, parentIndex: 0, hasChildren: true, isExpanded: false,
  }
  const expand = actions(buildTreeMenu(row, vi.fn(), vi.fn())).find(entry => entry.label === 'Expand all')
  expect(expand).toBeDefined()
  expand!.onSelect()
  expect(useExplorerStore.getState().expandedNodes.has('hier:parent')).toBe(true)
  expect(useExplorerStore.getState().expandedNodes.has('hier:remote')).toBe(true)

  const collapse = actions(buildTreeMenu({ ...row, isExpanded: true }, vi.fn(), vi.fn()))
    .find(entry => entry.label === 'Collapse subtree')
  expect(collapse).toBeDefined()
  collapse!.onSelect()
  expect(useExplorerStore.getState().expandedNodes.has('hier:remote')).toBe(false)
  expect(useExplorerStore.getState().childPageLimits.has('hier:remote')).toBe(false)
})

describe('NumberPromptDialog', () => {
  function renderDialog(onConfirm = vi.fn(), onCancel = vi.fn()) {
    render(
      <NumberPromptDialog
        title="Show more children"
        label="How many more to show?"
        initial={200}
        min={1}
        max={950}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    return { input: screen.getByLabelText('How many more to show?'), onConfirm, onCancel }
  }

  it('confirms the typed number', () => {
    const { input, onConfirm } = renderDialog()
    fireEvent.change(input, { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(onConfirm).toHaveBeenCalledWith(300)
  })

  it('confirms on Enter and cancels on Escape', () => {
    const { input, onConfirm } = renderDialog()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledWith(200)

    cleanup()
    const second = renderDialog()
    fireEvent.keyDown(second.input, { key: 'Escape' })
    expect(second.onCancel).toHaveBeenCalled()
  })

  it('refuses a value outside the range', () => {
    const { input, onConfirm } = renderDialog()
    const confirm = screen.getByRole('button', { name: 'Show' })

    fireEvent.change(input, { target: { value: '0' } })
    expect(confirm).toHaveProperty('disabled', true)
    fireEvent.change(input, { target: { value: '9999' } })
    expect(confirm).toHaveProperty('disabled', true)
    fireEvent.change(input, { target: { value: '' } })
    expect(confirm).toHaveProperty('disabled', true)
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '950' } })
    expect(confirm).toHaveProperty('disabled', false)
  })
})
