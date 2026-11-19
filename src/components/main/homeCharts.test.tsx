// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import {
  ColumnChart,
  DataBar,
  Meter,
  ObjectBar,
  ObjectBars,
  RankedBars,
  SegmentedBar,
  compact,
  foldParts,
  foldRows,
  type Part,
} from './homeCharts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const part = (key: string, value: number): Part => ({ key, label: key, value })

/** jsdom lays nothing out, so a bar has no width unless a test gives it one. */
function barWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width } as DOMRect)
}

describe('foldParts', () => {
  it('keeps up to six parts as they are, dropping the empty ones', () => {
    const parts = [part('a', 6), part('b', 5), part('c', 4), part('d', 3), part('e', 2), part('f', 1), part('none', 0)]
    expect(foldParts(parts).map(p => p.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('folds the tail past five into one part that says how many it holds, and keeps what they are', () => {
    const parts = [part('a', 60), part('b', 50), part('c', 40), part('d', 30), part('e', 20), part('f', 3), part('g', 2), part('h', 1)]
    const folded = foldParts(parts)
    expect(folded).toHaveLength(6)
    expect(folded[5]).toEqual({
      key: '__other',
      label: 'Other (3)',
      value: 6,
      isOther: true,
      members: [part('f', 3), part('g', 2), part('h', 1)],
    })
  })
})

describe('SegmentedBar', () => {
  const parts = [part('edc', 700), part('maximo', 290), part('ics', 10)]

  it('names every part with its amount and its share, on the bar and in the legend', () => {
    render(<SegmentedBar parts={parts} unit="instances" label="Instances by source" />)
    const bar = screen.getByRole('group', { name: 'Instances by source' })
    expect(within(bar).getByRole('img', { name: 'edc: 700 instances (70%)' })).toBeTruthy()
    expect(within(bar).getByRole('img', { name: 'ics: 10 instances (1%)' })).toBeTruthy()
    // The legend is the way to every value without hovering.
    expect(screen.getByText('maximo').nextElementSibling?.textContent).toBe('290')
  })

  it('prints a share on its block only where the text fits', () => {
    barWidth(600)
    render(<SegmentedBar parts={parts} unit="instances" label="Instances by source" />)
    expect(screen.getByRole('img', { name: /^edc:/ }).textContent).toBe('70%')
    // 1% of 600px is six pixels: no room, so no label, and nothing is clipped instead.
    expect(screen.getByRole('img', { name: /^ics:/ }).textContent).toBe('')
  })

  it('opens a named part from its block or its legend entry', () => {
    const onSelect = vi.fn()
    render(
      <SegmentedBar
        // A tail that does not say what it holds has nothing to open, so it stays inert.
        parts={[...parts, { key: '__other', label: 'Other (4)', value: 5, isOther: true }]}
        unit="instances"
        label="Instances by source"
        onSelect={onSelect}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^maximo: 290 instances/ }))
    fireEvent.click(screen.getByRole('button', { name: /^edc\s*700$/ }))
    expect(onSelect.mock.calls).toEqual([['maximo'], ['edc']])
    expect(screen.queryByRole('button', { name: /Other/ })).toBeNull()
  })

  it('expands the folded tail into its members, from the legend or the block, and each member opens too', () => {
    const onSelect = vi.fn()
    const folded = foldParts([part('a', 60), part('b', 50), part('c', 40), part('d', 30), part('e', 20), part('f', 3), part('g', 2)])
    render(<SegmentedBar parts={folded} unit="objects" label="Objects by type" onSelect={onSelect} />)
    expect(screen.queryByText('f')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Other \(2\)\s*5$/, expanded: false }))
    expect(screen.getByText('f')).toBeTruthy()
    expect(screen.getByText('g')).toBeTruthy()

    fireEvent.click(screen.getByTitle('f: 3 objects (1%) · click to open'))
    expect(onSelect).toHaveBeenCalledWith('f')

    // The gray block is the same switch.
    fireEvent.click(screen.getByRole('button', { name: 'Other (2): 5 objects (2%)', expanded: true }))
    expect(screen.queryByText('f')).toBeNull()
  })

  it('says so when there is nothing to split', () => {
    render(<SegmentedBar parts={[]} unit="instances" label="Instances by source" />)
    expect(screen.getByText('Nothing to show.')).toBeTruthy()
  })
})

describe('RankedBars', () => {
  const withTail = [
    { key: 'pump', label: 'Pump', value: 40 },
    {
      key: '__other',
      label: 'Other (2)',
      value: 90,
      isOther: true,
      members: [
        { key: 'valve', label: 'Valve', value: 60 },
        { key: 'fan', label: 'Fan', value: 30 },
      ],
    },
  ]
  /**
   * How long a row's bar is, as a share of the longest. The bar is the first child of the row's second
   * column, and its width is that share times the room there is (jsdom may write the product either way round).
   */
  const lengthOf = (label: string) => {
    const bar = screen.getByText(label).nextElementSibling!.firstElementChild as HTMLElement
    const share = bar.style.width.match(/calc\((?:\(100% - [\d.]+rem\) \* ([\d.]+)|([\d.]+) \* \(100% - [\d.]+rem\))\)/)
    return Number(share?.[1] ?? share?.[2])
  }

  it('replaces the folded tail with its members when it is opened, and folds them back', () => {
    const onSelect = vi.fn()
    render(<RankedBars rows={withTail} unit="objects" total={130} onSelect={onSelect} />)
    expect(screen.queryByText('Valve')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Other \(2\)/, expanded: false }))
    // The sum goes away once its parts are listed: both would draw the same objects twice.
    expect(screen.queryByText('Other (2)')).toBeNull()
    expect(screen.getByText('Fan')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Valve/ }))
    expect(onSelect).toHaveBeenCalledWith('valve')

    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.queryByText('Valve')).toBeNull()
    expect(screen.getByText('Other (2)')).toBeTruthy()
    // The tail itself is a switch, never a thing to open.
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('rescales to what is drawn, so an opened tail’s sum stops dwarfing the bars', () => {
    render(<RankedBars rows={withTail} unit="objects" />)
    // Folded, the tail's 90 sets the scale and Pump's 40 is under half of it.
    expect(lengthOf('Pump')).toBeCloseTo(40 / 90)

    fireEvent.click(screen.getByRole('button', { name: /^Other \(2\)/ }))
    // Opened, the largest thing drawn is Valve's 60.
    expect(lengthOf('Valve')).toBe(1)
    expect(lengthOf('Pump')).toBeCloseTo(40 / 60)
  })

  it('carries keyboard focus to what replaced the pressed row, and leaves a mouse click alone', () => {
    render(<RankedBars rows={withTail} unit="objects" onSelect={() => undefined} />)

    // A click with detail 0 is Enter or Space on the button.
    fireEvent.click(screen.getByRole('button', { name: /^Other \(2\)/ }), { detail: 0 })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Valve/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }), { detail: 0 })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Other \(2\)/ }))

    ;(document.activeElement as HTMLElement).blur()
    fireEvent.click(screen.getByRole('button', { name: /^Other \(2\)/ }), { detail: 1 })
    expect(document.activeElement).toBe(document.body)
  })

  it('prints each value at its bar, and leaves a tail with nothing in it inert', () => {
    const onSelect = vi.fn()
    render(
      <RankedBars
        rows={[
          { key: 'pump', label: 'Pump', value: 120 },
          { key: '__other', label: 'Other (3)', value: 9, isOther: true },
        ]}
        unit="objects"
        total={129}
        onSelect={onSelect}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Pump/ }))
    expect(onSelect).toHaveBeenCalledWith('pump')
    expect(screen.getByTitle('Pump: 120 objects (93%) · click to open')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Other/ })).toBeNull()
    expect(screen.getByTitle('Other (3): 9 objects (7%)').textContent).toContain('9')
  })
})

describe('parts that are not things', () => {
  it('draws an inert part of a segmented bar without making it a button', () => {
    const onSelect = vi.fn()
    render(
      <SegmentedBar
        parts={[
          { key: 'lineT', label: 'Under a Line', value: 90 },
          { key: '(at root)', label: 'At the root', value: 10, inert: true },
        ]}
        unit="instances"
        label="Where stations sit"
        onSelect={onSelect}
      />
    )
    // Drawn and named like any part, on the bar and in the legend...
    expect(screen.getByRole('img', { name: 'At the root: 10 instances (10%)' })).toBeTruthy()
    expect(screen.getByText('At the root')).toBeTruthy()
    // ...but there is no type called "at the root" to open.
    expect(screen.queryByRole('button', { name: /At the root/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /Under a Line/ })).toHaveLength(2)
  })

  it('keeps a member of the folded tail inert too', () => {
    const tail = [
      { key: 'binT', label: 'Under a Bin', value: 2 },
      { key: '(at root)', label: 'At the root', value: 1, inert: true },
    ]
    render(
      <SegmentedBar
        parts={[
          { key: 'lineT', label: 'Under a Line', value: 90 },
          { key: '__other', label: 'Other (2)', value: 3, isOther: true, members: tail },
        ]}
        unit="instances"
        label="Where stations sit"
        onSelect={() => undefined}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^Other \(2\)\s*3/ }))
    expect(screen.getByRole('button', { name: /Under a Bin/ })).toBeTruthy()
    expect(screen.getByText('At the root')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /At the root/ })).toBeNull()
  })

  it('draws an inert ranked bar without making it a button', () => {
    render(
      <RankedBars
        rows={[
          { key: 'lineT', label: 'Line', value: 90 },
          { key: '(at root)', label: 'At the root', value: 10, inert: true },
        ]}
        unit="instances"
        total={100}
        onSelect={() => undefined}
      />
    )
    expect(screen.getByRole('button', { name: /Line/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /At the root/ })).toBeNull()
    // Its tooltip does not promise an opening that isn't there.
    expect(screen.getByTitle('At the root: 10 instances (10%)')).toBeTruthy()
  })
})

describe('foldRows', () => {
  const row = (key: string, value: number) => ({ key, label: key, value })

  it('leaves a list that fits alone, and a tail of one as itself', () => {
    const rows = [row('a', 3), row('b', 2), row('c', 1)]
    expect(foldRows(rows, 3)).toBe(rows)
    // "Other (1)" would hide a name to save nothing.
    expect(foldRows(rows, 2)).toBe(rows)
  })

  it('folds a longer tail into one row that still holds what it folded', () => {
    const rows = [row('a', 5), row('b', 4), row('c', 3), row('d', 2), row('e', 1)]
    const folded = foldRows(rows, 2)
    expect(folded.map(item => item.label)).toEqual(['a', 'b', 'Other (3)'])
    expect(folded[2]).toMatchObject({ value: 6, isOther: true, members: [row('c', 3), row('d', 2), row('e', 1)] })
  })
})

describe('DataBar', () => {
  const width = (container: HTMLElement) => (container.querySelector('span > span') as HTMLElement).style.width

  it('draws a share of its column, and never less than a visible sliver or more than the column', () => {
    expect(width(render(<DataBar share={0.25} />).container)).toContain('25%')
    expect(width(render(<DataBar share={0} />).container)).toContain('0%')
    expect(width(render(<DataBar share={0} />).container)).toContain('2px')
    expect(width(render(<DataBar share={3} />).container)).toContain('100%')
  })
})

describe('ObjectBar', () => {
  it('is one row of the list, sized against the peak it is given', () => {
    const onSelect = vi.fn()
    render(<ObjectBar row={{ key: 'north', label: 'North', note: 'Site', value: 5, title: 'north' }} peak={20} unit="children" onSelect={onSelect} />)
    const row = screen.getByRole('button', { name: /North/ })
    expect(row.getAttribute('title')).toBe('north: 5 children · click to open')
    expect((row.querySelector('span.block > span') as HTMLElement).style.width).toContain('0.25')
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith('north')
  })
})

describe('ObjectBars', () => {
  it('opens the object a row names', () => {
    const onSelect = vi.fn()
    render(<ObjectBars rows={[{ key: 'a/assets', label: 'Assets', note: 'Folder in North', value: 30, title: 'a/assets' }]} unit="children" onSelect={onSelect} />)
    const row = screen.getByRole('button', { name: /Assets/ })
    expect(row.textContent).toContain('Folder in North')
    expect(row.getAttribute('title')).toBe('a/assets: 30 children · click to open')
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith('a/assets')
  })
})

describe('ColumnChart', () => {
  const levels = (count: number) =>
    Array.from({ length: count }, (_, level) => ({ key: String(level), label: `Level ${level}`, tick: String(level), value: (level + 1) * 1000 }))

  it('puts the figure on every cap while there are few columns', () => {
    render(<ColumnChart columns={levels(4)} unit="objects" label="Objects per level" />)
    expect(screen.getByRole('img', { name: 'Objects per level' })).toBeTruthy()
    expect(screen.getByTitle('Level 2: 3,000 objects').textContent).toBe('3,000')
  })

  it('keeps only the tallest column’s figure once the caps would crowd', () => {
    render(<ColumnChart columns={levels(12)} unit="objects" label="Objects per level" />)
    expect(screen.getByTitle('Level 11: 12,000 objects').textContent).toBe('12K')
    expect(screen.getByTitle('Level 3: 4,000 objects').textContent).toBe('')
  })
})

describe('Meter', () => {
  it('describes the ratio in words and never overflows its track', () => {
    render(<Meter value={15} max={10} label="15 of 10" />)
    const fill = screen.getByRole('img', { name: '15 of 10' }).firstElementChild as HTMLElement
    expect(fill.style.width).toBe('100%')
  })
})

describe('compact', () => {
  it('shortens only what would not fit over a column', () => {
    expect(compact(9999)).toBe('9,999')
    expect(compact(35_846)).toBe('35.8K')
    expect(compact(1_240_000)).toBe('1.2M')
  })
})
