import { describe, expect, it, vi } from 'vitest'
import type { LastKnownValue } from '../../api/types'
import type { BulkOutcome } from '../../api/normalize'
import { COMPONENT_LOOKUP_ATTEMPTS, registerItem } from './registerItem'

const composition = { elementId: 'line', isComposition: true }

const composedValue: LastKnownValue = {
  elementId: 'line',
  parentId: null,
  namespaceUri: 'urn:x',
  value: {},
  components: { 'line:count': { value: 1 }, 'line:mode': { value: 'Auto' } },
}

function fakeClient(getValue: () => Promise<LastKnownValue | null>) {
  const accept = async (_id: string, elementIds: string[]): Promise<BulkOutcome> => ({ accepted: elementIds, rejected: [] })
  return {
    registerMonitoredItems: vi.fn(accept),
    unregisterMonitoredItems: vi.fn(accept),
    getValue: vi.fn(getValue),
  }
}

const noWait = async () => {}

describe('registerItem', () => {
  it('registers a composition with its whole tree and lists its components', async () => {
    const client = fakeClient(async () => composedValue)

    await expect(registerItem(client, 's', composition, null, noWait)).resolves.toEqual({
      maxDepth: 0,
      components: ['line:count', 'line:mode'],
    })
    expect(client.registerMonitoredItems).toHaveBeenCalledWith('s', ['line'], 0)
  })

  it('reuses a value already read with its components', async () => {
    const client = fakeClient(async () => null)

    await registerItem(client, 's', composition, composedValue, noWait)

    expect(client.getValue).not.toHaveBeenCalled()
  })

  it('retries a failed component lookup', async () => {
    let calls = 0
    const client = fakeClient(async () => {
      calls++
      if (calls < COMPONENT_LOOKUP_ATTEMPTS) throw new Error('timeout')
      return composedValue
    })

    const result = await registerItem(client, 's', composition, null, noWait)

    expect(client.getValue).toHaveBeenCalledTimes(COMPONENT_LOOKUP_ATTEMPTS)
    expect(result.components).toEqual(['line:count', 'line:mode'])
  })

  it('undoes the registration and fails when the components cannot be read', async () => {
    const client = fakeClient(async () => {
      throw new Error('timeout')
    })

    await expect(registerItem(client, 's', composition, null, noWait)).rejects.toThrow(
      'Could not read the components of line, so it was not subscribed: timeout'
    )
    expect(client.getValue).toHaveBeenCalledTimes(COMPONENT_LOOKUP_ATTEMPTS)
    expect(client.unregisterMonitoredItems).toHaveBeenCalledWith('s', ['line'], 0)
  })

  it('reads nothing more for a plain object', async () => {
    const client = fakeClient(async () => composedValue)

    await expect(registerItem(client, 's', { elementId: 'pump', isComposition: false }, null, noWait)).resolves.toEqual({
      maxDepth: 1,
    })
    expect(client.getValue).not.toHaveBeenCalled()
  })

  it('fails without looking up components when the server rejects the registration', async () => {
    const client = fakeClient(async () => composedValue)
    client.registerMonitoredItems.mockResolvedValue({ accepted: [], rejected: [{ elementId: 'line', message: 'not found' }] })

    await expect(registerItem(client, 's', composition, null, noWait)).rejects.toThrow('line: not found')
    expect(client.getValue).not.toHaveBeenCalled()
  })
})
