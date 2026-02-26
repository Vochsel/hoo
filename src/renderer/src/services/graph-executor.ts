import type { Node, Edge } from '@xyflow/react'

type UpdateNodeData = (id: string, updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void

type ExecuteBrowserTab = (tabId: string, inputData?: string, runId?: string) => Promise<string | undefined>
const GRAPH_EXEC_TAG = '[graph-exec]'
const FILE_PREVIEW_LIMIT = 600

type InputSourceInfo = {
  sourceId: string
  label: string
  source: 'run-output' | 'cached' | 'unavailable'
  length: number
  used: boolean
}

function preview(value: string | undefined, max = 140): string {
  if (!value) return ''
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max)}...`
}

function sourceSummary(sources: InputSourceInfo[]): string {
  if (sources.length === 0) return 'none'
  return sources
    .map((s) => `${preview(s.label, 24)}(${s.sourceId}):${s.source}:${s.used ? 'used' : 'skip'}:${s.length}`)
    .join(',')
}

/**
 * Read static/cached data from a node that has NOT executed in this run.
 * Returns undefined when the node type has no meaningful cached output.
 */
function getCachedOutput(node: Node): string | undefined {
  const config = (node.data as { config?: Record<string, unknown> }).config
  if (!config) return undefined

  if (node.type === 'text') return (config.text as string) ?? undefined
  if (node.type === 'formTrigger') return (config.lastSubmission as string) ?? undefined
  if (node.type === 'aiPrompt') return (config.lastOutput as string) ?? undefined
  if (node.type === 'output') return (config.markdown as string) ?? undefined
  if (node.type === 'file') return (config.lastReadPreview as string) ?? undefined
  if (node.type === 'terminal') return (config.lastOutput as string) ?? undefined
  return undefined
}

/**
 * For a given node, gather input strings from ALL incoming edges.
 * Checks the shared `outputs` map first (node already ran), then falls back
 * to `getCachedOutput` for static / previously-computed data.
 *
 * Returns:
 *  - undefined  → no inputs available
 *  - raw string → exactly one input
 *  - formatted  → 2+ inputs with "[From: label]" headers
 */
function gatherInputs(
  nodeId: string,
  incomingEdges: Map<string, string[]>,
  nodeById: Map<string, Node>,
  outputs: Map<string, string>
): { value?: string; sources: InputSourceInfo[] } {
  const sources = incomingEdges.get(nodeId) ?? []
  const parts: Array<{ label: string; content: string }> = []
  const sourceInfo: InputSourceInfo[] = []

  for (const srcId of sources) {
    const srcNode = nodeById.get(srcId)
    const label =
      (srcNode?.data as { label?: string })?.label ||
      (srcNode?.data as { title?: string })?.title ||
      srcId
    let content: string | undefined
    let source: InputSourceInfo['source'] = 'unavailable'

    // Prefer output from this execution run
    if (outputs.has(srcId)) {
      content = outputs.get(srcId)
      source = 'run-output'
    } else {
      // Fall back to cached / static data
      if (srcNode) content = getCachedOutput(srcNode)
      if (content !== undefined) source = 'cached'
    }

    if (content === undefined || content === '') {
      sourceInfo.push({
        sourceId: srcId,
        label,
        source,
        length: content?.length ?? 0,
        used: false
      })
      continue
    }

    sourceInfo.push({
      sourceId: srcId,
      label,
      source,
      length: content.length,
      used: true
    })
    parts.push({ label, content })
  }

  if (parts.length === 0) return { value: undefined, sources: sourceInfo }
  if (parts.length === 1) return { value: parts[0].content, sources: sourceInfo }
  return {
    value: parts.map((p) => `[From: ${p.label}]\n${p.content}`).join('\n\n'),
    sources: sourceInfo
  }
}

export async function executeFromTrigger(
  triggerId: string,
  edges: Edge[],
  nodes: Node[],
  updateNodeData: UpdateNodeData,
  initialInput?: string,
  executeBrowserTab?: ExecuteBrowserTab,
  nodeOutputs?: Map<string, string>,
  runId?: string,
  boardId?: string | null
): Promise<void> {
  const execRunId = runId ?? `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const outputs = nodeOutputs ?? new Map<string, string>()
  const isRootInvocation = runId === undefined

  if (isRootInvocation) {
    console.log(
      `${GRAPH_EXEC_TAG} start run=${execRunId} trigger=${triggerId} nodes=${nodes.length} edges=${edges.length} initialInputLen=${initialInput?.length ?? 0}`
    )
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  // Build forward adjacency list (source → targets)
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const existing = adjacency.get(edge.source) ?? []
    existing.push(edge.target)
    adjacency.set(edge.source, existing)
  }

  // Build reverse adjacency: target → sources
  const incomingEdges = new Map<string, string[]>()
  for (const edge of edges) {
    const existing = incomingEdges.get(edge.target) ?? []
    existing.push(edge.source)
    incomingEdges.set(edge.target, existing)
  }

  // BFS traversal
  const visited = new Set<string>()
  const queue: Array<{ nodeId: string }> = [{ nodeId: triggerId }]
  visited.add(triggerId)

  const setNodeRuntime = (nodeId: string, status: string, isRunning?: boolean, runtimeOutput?: string): void => {
    updateNodeData(nodeId, (prev) => {
      const next: Record<string, unknown> = {
        ...prev,
        runtimeStatus: status,
        runtimeUpdatedAt: Date.now()
      }
      if (isRunning !== undefined) {
        next.isRunning = isRunning
      }
      if (runtimeOutput !== undefined) {
        next.runtimeOutput = runtimeOutput
      }
      return next
    })
  }

  while (queue.length > 0) {
    const current = queue.shift()!
    const node = nodeById.get(current.nodeId)
    if (!node) continue

    const incomingSources = incomingEdges.get(current.nodeId) ?? []
    if (executeBrowserTab && node.type !== 'browserTab' && incomingSources.length > 0) {
      for (const srcId of incomingSources) {
        if (outputs.has(srcId) || srcId === current.nodeId) continue
        const srcNode = nodeById.get(srcId)
        if (!srcNode || srcNode.type !== 'browserTab') continue

        console.log(
          `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} resolving upstream browserTab source=${srcId}`
        )
        try {
          const upstreamOutput = await executeBrowserTab(srcId, undefined, execRunId)
          if (upstreamOutput !== undefined) {
            outputs.set(srcId, upstreamOutput)
            console.log(
              `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} upstream browserTab source=${srcId} outputLen=${upstreamOutput.length}`
            )
          } else {
            console.warn(
              `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} upstream browserTab source=${srcId} returned no output`
            )
          }
        } catch (error) {
          console.error(
            `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} upstream browserTab source=${srcId} failed:`,
            error
          )
        }
      }
    }

    // Gather input from all incoming edges
    const gathered = current.nodeId === triggerId && initialInput !== undefined
      ? {
          value: initialInput,
          sources: [
            {
              sourceId: '(initial)',
              label: '(initial)',
              source: 'run-output' as const,
              length: initialInput.length,
              used: true
            }
          ]
        }
      : gatherInputs(current.nodeId, incomingEdges, nodeById, outputs)
    const inputData = gathered.value
    const nodeLabel =
      (node.data as { label?: string })?.label ||
      (node.data as { title?: string })?.title ||
      current.nodeId
    console.log(
      `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} label="${preview(nodeLabel, 70)}" type=${node.type} queueRemaining=${queue.length} incoming=${incomingSources.length} inputLen=${inputData?.length ?? 0} inputPreview="${preview(inputData)}"`
    )
    if (incomingSources.length > 0 || gathered.sources.length > 0) {
      console.log(
        `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} inputSources=${sourceSummary(gathered.sources)}`
      )
    } else {
      console.log(`${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} inputSources=none`)
    }
    if (incomingSources.length > 0 && inputData === undefined) {
      console.warn(
        `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} incoming edges exist but no usable input resolved`
      )
    }

    // Execute node based on type
    let output: string | undefined
    const nodeType = node.type

    if (nodeType === 'trigger' || nodeType === 'scheduleTrigger' || nodeType === 'formTrigger') {
      // Trigger nodes themselves don't execute, they just release downstream flow.
      if (nodeType === 'formTrigger') {
        const config = (node.data as { config?: { lastSubmission?: string } }).config ?? {}
        output = initialInput ?? config.lastSubmission
        if (initialInput !== undefined) {
          const nextConfig = { ...config, lastSubmission: initialInput }
          updateNodeData(current.nodeId, (prev) => ({
            ...prev,
            config: nextConfig
          }))
          void window.api.graphNodes.update(current.nodeId, {
            config: JSON.stringify(nextConfig)
          }, boardId ?? undefined)
          setNodeRuntime(current.nodeId, `Form submitted (${initialInput.length} chars)`, false)
        } else {
          setNodeRuntime(
            current.nodeId,
            output ? `Form trigger reused (${output.length} chars)` : 'Form trigger fired',
            false
          )
        }
      } else {
        output = initialInput
        setNodeRuntime(current.nodeId, nodeType === 'scheduleTrigger' ? 'Schedule trigger fired' : 'Triggered')
      }
      console.log(`${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} ${nodeType} pass-through`)
    } else if (nodeType === 'text') {
      const config = (node.data as { config?: { text?: string } }).config ?? {}
      if (inputData) {
        // Incoming data overwrites the text content
        output = inputData
        setNodeRuntime(current.nodeId, `Instructions updated (${output.length} chars)`)
        const updatedConfig = { ...config, text: inputData }
        updateNodeData(current.nodeId, (prev) => ({
          ...prev,
          config: updatedConfig
        }))
        // Persist to DB
        window.api.graphNodes.update(current.nodeId, {
          config: JSON.stringify(updatedConfig)
        }, boardId ?? undefined)
        console.log(
          `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} text updated from input outputLen=${output.length}`
        )
      } else {
        output = config.text ?? ''
        setNodeRuntime(current.nodeId, `Instructions ready (${output.length} chars)`)
        console.log(
          `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} text static outputLen=${output.length}`
        )
      }
    } else if (nodeType === 'debug') {
      updateNodeData(current.nodeId, (prev) => ({
        ...prev,
        activated: true
      }))
      // Reset after 5s
      setTimeout(() => {
        updateNodeData(current.nodeId, (prev) => ({
          ...prev,
          activated: false
        }))
      }, 5000)
      setNodeRuntime(current.nodeId, 'Debug pulse')
      console.log(`${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} debug pulse`)
    } else if (nodeType === 'delay') {
      const config = (node.data as { config?: { seconds?: number } }).config ?? {}
      const seconds = config.seconds ?? 1
      setNodeRuntime(current.nodeId, `Delay ${seconds}s`, true)
      await new Promise((r) => setTimeout(r, seconds * 1000))
      setNodeRuntime(current.nodeId, `Delay complete (${seconds}s)`, false)
      output = inputData
      console.log(
        `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} delay waited=${seconds}s pass outputLen=${output?.length ?? 0}`
      )
    } else if (nodeType === 'notification') {
      const config = (node.data as { config?: { title?: string; body?: string; playSound?: boolean } }).config ?? {}
      const title = config.title || 'Notification'
      const body = config.body || ''
      const playSound = config.playSound ?? true
      setNodeRuntime(current.nodeId, `Notify: ${preview(title, 40)}`, true)
      const notifyResult = await window.api.graphNodes.notify(title, body, playSound)
      if (!notifyResult?.success) {
        setNodeRuntime(current.nodeId, `Notify failed: ${preview(notifyResult?.error ?? 'unknown', 60)}`, false)
        console.error(
          `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} notify failed error=${notifyResult?.error ?? 'unknown'}`
        )
      } else {
        setNodeRuntime(current.nodeId, `Notification sent: ${preview(title, 40)}`, false)
      }
      console.log(
        `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} notify sent title="${preview(title)}" bodyLen=${body.length} success=${notifyResult?.success ?? 'unknown'}`
      )
    } else if (nodeType === 'aiPrompt') {
      setNodeRuntime(current.nodeId, 'AI: generating response...', true)
      try {
        console.log(
          `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} aiPrompt request inputLen=${inputData?.length ?? 0}`
        )
        const result = await window.api.graphNodes.executeAiPrompt(current.nodeId, inputData, execRunId, boardId ?? undefined)
        if (result.output) {
          output = result.output
          setNodeRuntime(current.nodeId, `AI complete (${result.output.length} chars)`, false, result.output)
          console.log(
            `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} aiPrompt outputLen=${result.output.length} preview="${preview(result.output)}"`
          )
          updateNodeData(current.nodeId, (prev) => {
            const prevConfig = (prev.config as { prompt?: string; lastOutput?: string }) ?? {}
            return {
              ...prev,
              config: { ...prevConfig, lastOutput: result.output }
            }
          })
        } else {
          setNodeRuntime(current.nodeId, `AI returned no output${result.error ? `: ${preview(result.error, 60)}` : ''}`, false)
          console.warn(
            `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} aiPrompt no output error=${result.error ?? 'none'}`
          )
        }
      } catch (err) {
        setNodeRuntime(current.nodeId, `AI error: ${preview(err instanceof Error ? err.message : String(err), 60)}`, false)
        console.error(`${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} aiPrompt exception:`, err)
      }
    } else if (nodeType === 'browserTab') {
      if (executeBrowserTab) {
        setNodeRuntime(current.nodeId, 'Browser: preparing...', true)
        try {
          console.log(
            `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} browserTab invoke inputLen=${inputData?.length ?? 0}`
          )
          output = await executeBrowserTab(current.nodeId, inputData, execRunId)
          setNodeRuntime(
            current.nodeId,
            output ? `Browser complete (${output.length} chars)` : 'Browser complete (no output)',
            false,
            output ?? undefined
          )
          console.log(
            `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} browserTab outputLen=${output?.length ?? 0} preview="${preview(output)}"`
          )
        } catch (err) {
          setNodeRuntime(current.nodeId, `Browser error: ${preview(err instanceof Error ? err.message : String(err), 60)}`, false)
          console.error(`${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} browserTab failed:`, err)
        }
      } else {
        setNodeRuntime(current.nodeId, 'Browser executor missing')
        console.warn(
          `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} browserTab executor missing; pass-through only`
        )
        output = inputData
      }
    } else if (nodeType === 'output') {
      const config = (node.data as { config?: { markdown?: string } }).config ?? {}
      const markdown = inputData ?? config.markdown ?? ''
      const nextConfig = { ...config, markdown }
      updateNodeData(current.nodeId, (prev) => ({
        ...prev,
        config: nextConfig
      }))
      window.api.graphNodes.update(current.nodeId, {
        config: JSON.stringify(nextConfig)
      }, boardId ?? undefined)
      output = markdown
      setNodeRuntime(current.nodeId, `Output updated (${markdown.length} chars)`)
      console.log(
        `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} output report updated markdownLen=${markdown.length}`
      )
    } else if (nodeType === 'file') {
      const config = (node.data as {
        config?: {
          filePath?: string
          writeMode?: 'overwrite' | 'append'
          lastOperation?: 'read' | 'write'
          lastRunAt?: string
          lastBytes?: number
          lastError?: string | null
          lastReadPreview?: string
        }
      }).config ?? {}
      const filePath = config.filePath?.trim()
      const writeMode: 'overwrite' | 'append' = config.writeMode === 'append' ? 'append' : 'overwrite'
      const runAt = new Date().toISOString()

      const persistConfig = (nextConfig: typeof config): void => {
        updateNodeData(current.nodeId, (prev) => ({
          ...prev,
          config: nextConfig
        }))
        void window.api.graphNodes.update(current.nodeId, {
          config: JSON.stringify(nextConfig)
        }, boardId ?? undefined)
      }

      if (!filePath) {
        const msg = 'No file path configured'
        setNodeRuntime(current.nodeId, msg, false)
        persistConfig({
          ...config,
          lastOperation: inputData === undefined ? 'read' : 'write',
          lastRunAt: runAt,
          lastError: msg
        })
        console.warn(`${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} file node skipped: ${msg}`)
        output = inputData
      } else if (inputData === undefined) {
        setNodeRuntime(current.nodeId, `File read: ${preview(filePath, 40)}`, true)
        const readResult = await window.api.graphNodes.readFile(filePath)
        if (readResult?.success) {
          const content = typeof readResult.content === 'string' ? readResult.content : ''
          output = content
          setNodeRuntime(current.nodeId, `File read complete (${content.length} bytes)`, false)
          persistConfig({
            ...config,
            lastOperation: 'read',
            lastRunAt: runAt,
            lastBytes: content.length,
            lastError: null,
            lastReadPreview: content.slice(0, FILE_PREVIEW_LIMIT)
          })
          console.log(
            `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} file read path="${preview(filePath, 200)}" bytes=${content.length}`
          )
        } else {
          const msg = readResult?.error ?? 'Read failed'
          setNodeRuntime(current.nodeId, `File read failed: ${preview(msg, 60)}`, false)
          persistConfig({
            ...config,
            lastOperation: 'read',
            lastRunAt: runAt,
            lastError: msg
          })
          console.error(
            `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} file read failed path="${preview(filePath, 200)}" error=${msg}`
          )
        }
      } else {
        setNodeRuntime(current.nodeId, `File write (${writeMode}): ${preview(filePath, 40)}`, true)
        const writeResult = await window.api.graphNodes.writeFile(filePath, inputData, writeMode)
        output = inputData

        if (writeResult?.success) {
          const bytes = typeof writeResult.bytes === 'number' ? writeResult.bytes : inputData.length
          setNodeRuntime(current.nodeId, `File write complete (${bytes} bytes)`, false)
          persistConfig({
            ...config,
            lastOperation: 'write',
            lastRunAt: runAt,
            lastBytes: bytes,
            lastError: null
          })
          console.log(
            `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} file write path="${preview(filePath, 200)}" mode=${writeMode} bytes=${bytes}`
          )
        } else {
          const msg = writeResult?.error ?? 'Write failed'
          setNodeRuntime(current.nodeId, `File write failed: ${preview(msg, 60)}`, false)
          persistConfig({
            ...config,
            lastOperation: 'write',
            lastRunAt: runAt,
            lastError: msg
          })
          console.error(
            `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} file write failed path="${preview(filePath, 200)}" mode=${writeMode} error=${msg}`
          )
        }
      }
    } else if (nodeType === 'terminal') {
      const config = (node.data as {
        config?: {
          command?: string
          cwd?: string
          shell?: string
          timeout?: number
          lastOutput?: string
          lastError?: string
          lastExitCode?: number
          lastRunAt?: string
        }
      }).config ?? {}
      const runAt = new Date().toISOString()

      const persistConfig = (nextConfig: typeof config): void => {
        updateNodeData(current.nodeId, (prev) => ({
          ...prev,
          config: nextConfig
        }))
        void window.api.graphNodes.update(current.nodeId, {
          config: JSON.stringify(nextConfig)
        }, boardId ?? undefined)
      }

      let command = config.command?.trim() || ''
      if (!command && inputData) {
        command = inputData.trim()
      } else if (command && inputData) {
        command = `echo ${JSON.stringify(inputData)} | ${command}`
      }

      if (!command) {
        const msg = 'No command configured and no input received'
        setNodeRuntime(current.nodeId, msg, false)
        persistConfig({ ...config, lastRunAt: runAt, lastError: msg })
        console.warn(`${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} terminal skipped: ${msg}`)
      } else {
        setNodeRuntime(current.nodeId, `Terminal: ${preview(command, 40)}`, true)
        console.log(
          `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} terminal execute command="${preview(command, 200)}"`
        )
        try {
          const result = await window.api.terminal.execute(
            command,
            config.cwd || undefined,
            config.shell || undefined,
            config.timeout ?? 30
          )
          output = result.stdout
          const nextConfig = {
            ...config,
            lastOutput: result.stdout,
            lastError: result.error || (result.success ? undefined : `Exit code ${result.exitCode}`),
            lastExitCode: result.exitCode,
            lastRunAt: runAt
          }
          persistConfig(nextConfig)
          if (result.success) {
            setNodeRuntime(current.nodeId, `Terminal complete (exit 0, ${result.stdout.length} chars)`, false, result.stdout)
          } else {
            setNodeRuntime(current.nodeId, `Terminal exit ${result.exitCode}${result.error ? `: ${preview(result.error, 40)}` : ''}`, false)
          }
          console.log(
            `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} terminal done exitCode=${result.exitCode} outputLen=${result.stdout.length}`
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          setNodeRuntime(current.nodeId, `Terminal error: ${preview(msg, 60)}`, false)
          persistConfig({ ...config, lastRunAt: runAt, lastError: msg, lastExitCode: -1 })
          console.error(`${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} terminal exception:`, err)
        }
      }
    } else {
      setNodeRuntime(current.nodeId, `Unsupported node type: ${String(nodeType)}`)
      console.warn(
        `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} unsupported node type=${String(nodeType)}`
      )
    }

    // Store output in shared map
    if (output !== undefined) {
      outputs.set(current.nodeId, output)
      console.log(
        `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} stored outputLen=${output.length}`
      )
    } else {
      console.log(`${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} no output`)
    }

    // Get downstream nodes
    const children = adjacency.get(current.nodeId) ?? []
    const unvisitedChildren = children.filter((c) => !visited.has(c))

    if (unvisitedChildren.length === 0) continue

    // Mark all children visited
    for (const child of unvisitedChildren) {
      visited.add(child)
    }

    if (unvisitedChildren.length === 1) {
      // Sequential: just push to queue
      queue.push({ nodeId: unvisitedChildren[0] })
      console.log(
        `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} next=${unvisitedChildren[0]} mode=sequential queueSize=${queue.length}`
      )
    } else {
      // Parallel branches: execute siblings concurrently, then continue
      console.log(
        `${GRAPH_EXEC_TAG} run=${execRunId} node=${current.nodeId} branches=${unvisitedChildren.join(',')} mode=parallel`
      )
      const branchResults = await Promise.allSettled(
        unvisitedChildren.map((childId) =>
          executeFromTrigger(
            childId,
            edges,
            nodes,
            updateNodeData,
            undefined,
            executeBrowserTab,
            outputs,
            execRunId,
            boardId
          )
        )
      )
      branchResults.forEach((result, index) => {
        const childId = unvisitedChildren[index]
        if (result.status === 'fulfilled') {
          console.log(`${GRAPH_EXEC_TAG} run=${execRunId} branch child=${childId} complete`)
        } else {
          console.error(`${GRAPH_EXEC_TAG} run=${execRunId} branch child=${childId} failed:`, result.reason)
        }
      })
      // Children handled recursively, don't add to queue
    }
  }

  if (isRootInvocation) {
    const outputSummaryText = Array.from(outputs.entries())
      .map(([nodeId, value]) => `${nodeId}:${value.length}`)
      .join(',')
    console.log(
      `${GRAPH_EXEC_TAG} complete run=${execRunId} outputs=${outputs.size} outputSummary="${preview(outputSummaryText, 500)}"`
    )
  }
}
