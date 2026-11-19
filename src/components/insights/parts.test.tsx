// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useExplorerStore } from '../../stores/explorer'
import { NameLine, ShowMore, TypeName, capitalize, contextPhrase, formatShare, plural, usePaged } from './parts'

afterEach(() => {
  cleanup()
  useExplorerStore.getState().reset()
})

describe('formatShare', () => {
  it('keeps the decimal where it is the whole story, and drops it elsewhere', () => {
    expect(formatShare(1)).toBe('100%')
    expect(formatShare(0.994)).toBe('99.4%')
    expect(formatShare(0.93)).toBe('93%')
    expect(formatShare(0.004)).toBe('0.4%')
  })
})

describe('wording', () => {
  it('counts with the right noun', () => {
    expect(plural(1, 'exception')).toBe('1 exception')
    expect(plural(1240, 'exception')).toBe('1,240 exceptions')
    expect(plural(2, 'child type', 'child types')).toBe('2 child types')
  })

  it('says where an object sits as a place, not as a code in brackets', () => {
    expect(contextPhrase('Line 4')).toBe('in Line 4')
    expect(contextPhrase('(at root)')).toBe('at the root')
    expect(contextPhrase('(parent not in catalog)')).toBe('under a parent the catalog does not hold')
  })

  it('capitalizes a clause for the start of a line', () => {
    expect(capitalize('under a Bin instead')).toBe('Under a Bin instead')
  })
})

describe('TypeName', () => {
  const pump = { elementId: 'pumpT', displayName: 'Pump', namespaceUri: 'urn:ns', schema: {} }

  it('opens a type the server declares', () => {
    useExplorerStore.getState().setObjectTypes([pump])
    render(<TypeName typeId="pumpT" label="Pump" />)
    fireEvent.click(screen.getByRole('button', { name: 'Pump' }))
    expect(useExplorerStore.getState().selectedItem?.id).toBe('type:pumpT')
  })

  it('is plain text for a type the server does not declare: a button that does nothing is worse', () => {
    render(<TypeName typeId="ghostT" label="ghostT" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('ghostT').getAttribute('title')).toContain('not declared')
  })
})

function PagedList({ items, pageSize }: { items: string[]; pageSize: number }) {
  const paged = usePaged(items, pageSize)
  return (
    <div>
      <ul>
        {paged.shown.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <ShowMore paged={paged} noun="types" />
    </div>
  )
}

const names = (count: number, prefix = 'item') => Array.from({ length: count }, (_, index) => `${prefix}${index}`)

describe('usePaged and ShowMore', () => {
  it('shows the first page and says how many more there are', () => {
    render(<PagedList items={names(25)} pageSize={10} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getByText('15 more types')).toBeTruthy()
  })

  it('shows one more page at a time', () => {
    render(<PagedList items={names(25)} pageSize={10} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show 10 more' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(20)
    expect(screen.getByText('5 more types')).toBeTruthy()
    // What is left fits one page: no need to choose between a page and all of them.
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show them' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(25)
    expect(screen.queryByText(/more types/)).toBeNull()
  })

  it('shows everything at once on request', () => {
    render(<PagedList items={names(25)} pageSize={10} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(25)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('draws nothing when the list fits its first page', () => {
    render(<PagedList items={names(10)} pageSize={10} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('starts a new list from its first page again', () => {
    const { rerender } = render(<PagedList items={names(25)} pageSize={10} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))

    rerender(<PagedList items={names(30, 'other')} pageSize={10} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getByText('20 more types')).toBeTruthy()
  })
})

describe('NameLine', () => {
  it('names what fits, and counts the rest as a button that opens them', () => {
    const onMore = vi.fn()
    render(<NameLine names={['Folder', 'Line', 'Shop', 'Site']} max={2} onMore={onMore} moreLabel="Show everything a Plant contains" />)
    expect(screen.getByText('Folder')).toBeTruthy()
    expect(screen.getByText('Line')).toBeTruthy()
    expect(screen.queryByText('Shop')).toBeNull()

    // Never "and 2 others" as text: the count is the way to them.
    const more = screen.getByRole('button', { name: 'Show everything a Plant contains' })
    expect(more.textContent).toBe('2 more')
    fireEvent.click(more)
    expect(onMore).toHaveBeenCalledOnce()
  })

  it('has no button when every name fits', () => {
    render(<NameLine names={['Folder', 'Line']} max={2} onMore={() => undefined} moreLabel="Show the rest" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
