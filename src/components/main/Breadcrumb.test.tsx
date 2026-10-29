import { describe, expect, it } from 'vitest'
import { collapseCrumbs } from './Breadcrumb'

describe('collapseCrumbs', () => {
  it('returns chains of up to three ancestors unchanged', () => {
    for (const chain of [[], ['a'], ['a', 'b'], ['a', 'b', 'c']]) {
      expect(collapseCrumbs(chain)).toEqual({ shown: chain, hiddenCount: 0 })
    }
  })

  it('folds a four-crumb chain to first, ellipsis, last', () => {
    expect(collapseCrumbs(['a', 'b', 'c', 'd'])).toEqual({
      shown: ['a', null, 'd'],
      hiddenCount: 2,
    })
  })

  it('hides length - 2 crumbs on long chains', () => {
    const chain = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(collapseCrumbs(chain)).toEqual({
      shown: ['a', null, 'g'],
      hiddenCount: chain.length - 2,
    })
  })
})
