// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { BulkOutcome } from '../../api/normalize'
import { useConnectionStore } from '../../stores/connection'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { SubscriptionTransportProvider, useSubscriptionTransport } from './SubscriptionTransport'

type BulkCall = (subscriptionId: string, elementIds: string[], maxDepth?: number) => Promise<BulkOutcome>

const fakeClient = {
  registerMonitoredItems: vi.fn<BulkCall>(),
  unregisterMonitoredItems: vi.fn<BulkCall>(),
  getCapabilities: () => null,
}

vi.mock('../../api/client', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getClient: () => fakeClient,
}))

const accept: BulkCall = async (_id, elementIds) => ({ accepted: elementIds, rejected: [] })
const refuse: BulkCall = async (_id, elementIds) => ({
  accepted: [],
  rejected: elementIds.map(elementId => ({ elementId, message: 'operation refused' })),
})

function renderTransport() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SubscriptionTransportProvider>{children}</SubscriptionTransportProvider>
  )
  return renderHook(() => useSubscriptionTransport(), { wrapper }).result.current
}

const subscription = () => useSubscriptionsStore.getState().subscriptions.get('s')!

beforeEach(() => {
  // The provider clears every subscription while disconnected.
  useConnectionStore.setState({ isConnected: true })
  useSubscriptionsStore.getState().clearAll()
  useSubscriptionsStore.getState().addSubscription({ id: 's', createdAt: '', monitoredItems: [], isStreaming: true })
  useSubscriptionsStore.getState().addMonitoredItem('s', 'line', { maxDepth: 0, components: ['line:count'] })
  useSubscriptionsStore.getState().addMonitoredItem('s', 'pump')
  fakeClient.registerMonitoredItems.mockReset().mockImplementation(accept)
  fakeClient.unregisterMonitoredItems.mockReset().mockImplementation(accept)
})

afterEach(cleanup)

describe('subscription item actions', () => {
  it('stops an accepted item, unregistering it at its registration depth', async () => {
    await renderTransport().stopItem('s', 'line')

    expect(fakeClient.unregisterMonitoredItems).toHaveBeenCalledWith('s', ['line'], 0)
    expect(subscription().stoppedItems).toEqual(['line'])
  })

  it('leaves an item running when the server refuses to stop it', async () => {
    fakeClient.unregisterMonitoredItems.mockImplementation(refuse)

    await expect(renderTransport().stopItem('s', 'line')).rejects.toThrow('line: operation refused')
    expect(subscription().stoppedItems ?? []).toEqual([])
  })

  it('keeps an item listed when the server refuses to delete it', async () => {
    fakeClient.unregisterMonitoredItems.mockImplementation(refuse)

    await expect(renderTransport().deleteItem('s', 'pump')).rejects.toThrow('pump: operation refused')
    expect(subscription().monitoredItems).toEqual(['line', 'pump'])
  })

  it('starts only the items the server accepted', async () => {
    useSubscriptionsStore.getState().setItemStopped('s', 'line', true)
    useSubscriptionsStore.getState().setItemStopped('s', 'pump', true)
    fakeClient.registerMonitoredItems.mockImplementation(async (_id, elementIds) =>
      elementIds.includes('pump') ? refuse(_id, elementIds) : accept(_id, elementIds)
    )

    await expect(renderTransport().startItems('s', ['line', 'pump'])).rejects.toThrow('pump: operation refused')
    expect(fakeClient.registerMonitoredItems).toHaveBeenCalledWith('s', ['line'], 0)
    expect(fakeClient.registerMonitoredItems).toHaveBeenCalledWith('s', ['pump'], 1)
    expect(subscription().stoppedItems).toEqual(['pump'])
  })
})
