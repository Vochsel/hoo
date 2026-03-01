import { createContext, useContext } from 'react'
import { Position } from '@xyflow/react'

export type FlowDirection = 'horizontal' | 'vertical'

export const FlowDirectionContext = createContext<FlowDirection>('horizontal')

export function useFlowDirection(): FlowDirection {
  return useContext(FlowDirectionContext)
}

export function getSourcePosition(direction: FlowDirection): Position {
  return direction === 'vertical' ? Position.Bottom : Position.Right
}

export function getTargetPosition(direction: FlowDirection): Position {
  return direction === 'vertical' ? Position.Top : Position.Left
}
