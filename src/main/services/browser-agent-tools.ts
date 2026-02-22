import { tool } from 'ai'
import { z } from 'zod'

const TAG = '[browser-tools]'

export interface BrowserAction {
  type: 'click' | 'fill' | 'navigate' | 'scroll' | 'getText' | 'getElements'
  index?: number
  value?: string
  url?: string
  direction?: 'up' | 'down'
  amount?: number
}

export function createBrowserTools(): {
  tools: Record<string, ReturnType<typeof tool>>
  getActions: () => BrowserAction[]
} {
  const actions: BrowserAction[] = []

  const tools = {
    clickElement: tool({
      description:
        'Click on an interactive element by its index from the elements list.',
      inputSchema: z.object({
        index: z.number().describe('The index of the element to click from the elements list')
      }),
      execute: async ({ index }) => {
        console.log(`${TAG} clickElement(index=${index})`)
        actions.push({ type: 'click', index })
        return `Will click element at index ${index}. The click will be executed after this response.`
      }
    }),

    fillInput: tool({
      description: 'Fill an input, textarea, or select element with a value by its index.',
      inputSchema: z.object({
        index: z.number().describe('The index of the input element from the elements list'),
        value: z.string().describe('The value to fill in')
      }),
      execute: async ({ index, value }) => {
        console.log(`${TAG} fillInput(index=${index}, value="${value.slice(0, 50)}")`)
        actions.push({ type: 'fill', index, value })
        return `Will fill element at index ${index} with "${value}". The fill will be executed after this response.`
      }
    }),

    navigate: tool({
      description: 'Navigate the browser to a URL.',
      inputSchema: z.object({
        url: z.string().describe('The URL to navigate to')
      }),
      execute: async ({ url }) => {
        console.log(`${TAG} navigate(url=${url})`)
        actions.push({ type: 'navigate', url })
        return `Will navigate to ${url}. Navigation will happen after this response.`
      }
    }),

    scrollPage: tool({
      description: 'Scroll the page up or down.',
      inputSchema: z.object({
        direction: z.enum(['up', 'down']).describe('Direction to scroll'),
        amount: z.number().optional().describe('Pixels to scroll (default 500)')
      }),
      execute: async ({ direction, amount }) => {
        console.log(`${TAG} scrollPage(dir=${direction}, amount=${amount ?? 500})`)
        actions.push({ type: 'scroll', direction, amount: amount ?? 500 })
        return `Will scroll ${direction} by ${amount ?? 500}px. Scrolling will happen after this response.`
      }
    })
  }

  return { tools, getActions: () => actions }
}
