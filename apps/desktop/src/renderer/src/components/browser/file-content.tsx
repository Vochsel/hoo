import type { FileNodeConfig } from './file-node'
import { FileEditorContent } from './file-editor-content'

interface FileContentProps {
  nodeId: string
  config: FileNodeConfig
  onUpdateConfig: (config: FileNodeConfig) => void
}

export function FileContent({ nodeId, config, onUpdateConfig }: FileContentProps): React.ReactElement {
  return (
    <FileEditorContent
      nodeId={nodeId}
      config={config}
      onUpdateConfig={onUpdateConfig}
    />
  )
}
