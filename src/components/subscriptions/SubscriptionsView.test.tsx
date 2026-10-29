// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SubscriptionsView } from './SubscriptionsView'
import { SubscriptionTransportProvider } from './SubscriptionTransport'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { useConnectionStore } from '../../stores/connection'
import { installJsdomLayout, TEST_ROW_HEIGHT } from '../../testing/jsdomLayout'

beforeAll(installJsdomLayout)
afterEach(cleanup)
beforeEach(() => {
  // The transport provider clears every subscription while disconnected.
  useConnectionStore.setState({ isConnected: true })
  useSubscriptionsStore.getState().clearAll()
})

function renderComposition(componentCount: number) {
  const components = Array.from({ length: componentCount }, (_, i) => `line:c${i}`)
  useSubscriptionsStore.getState().addSubscription({
    id: 's',
    createdAt: '',
    monitoredItems: ['line'],
    isStreaming: false,
    monitoredDepth: { line: 0 },
    components: { line: components },
  })
  const view = render(
    <SubscriptionTransportProvider>
      <SubscriptionsView />
    </SubscriptionTransportProvider>
  )
  const scroller = view.container.querySelector('[data-windowed-list]') as HTMLElement
  return { scroller }
}

describe('SubscriptionsView', () => {
  it('mounts only a window of rows for a composition with 10,000 components', () => {
    const { scroller } = renderComposition(10_000)

    const mounted = scroller.querySelectorAll('tbody[data-index]').length
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThan(100)
    expect(screen.getByText('line')).toBeDefined()
    expect(screen.getByText('10000 components')).toBeDefined()
  })

  it('reserves the whole list height so the last component can be scrolled to', () => {
    const { scroller } = renderComposition(10_000)

    const table = scroller.querySelector('table') as HTMLElement
    expect(parseFloat(table.style.minHeight)).toBeGreaterThanOrEqual(10_001 * TEST_ROW_HEIGHT)
  })
})
