import { useState } from 'react'
import { ChevronDown, ChevronRight, File as FileIcon, Folder as FolderIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface VaultTreeNode {
  name: string
  path: string
  absPath: string
  kind: 'folder' | 'file'
  size?: number
  mtime?: number
  children?: VaultTreeNode[]
}

interface VaultTreeProps {
  nodes: VaultTreeNode[]
  selectedPath: string | null
  onSelect: (node: VaultTreeNode) => void
  tabFilter?: string
}

/** Recursive tree renderer. Folders expand/collapse; files are
 * clickable. When `tabFilter` is set, only children whose `path`
 * starts with that prefix are shown at the root. */
export function VaultTree({
  nodes,
  selectedPath,
  onSelect,
  tabFilter
}: VaultTreeProps): React.JSX.Element {
  const filtered = tabFilter ? nodes.filter((n) => n.path === tabFilter || n.path.startsWith(tabFilter)) : nodes
  return (
    <ul className="flex flex-col">
      {filtered.map((n) => (
        <TreeItem key={n.absPath} node={n} depth={0} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </ul>
  )
}

function TreeItem({
  node,
  depth,
  selectedPath,
  onSelect
}: {
  node: VaultTreeNode
  depth: number
  selectedPath: string | null
  onSelect: (node: VaultTreeNode) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(depth < 1)
  const pad = { paddingLeft: `${8 + depth * 12}px` }

  if (node.kind === 'folder') {
    return (
      <li>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1 rounded px-1 py-[3px] text-[12px] text-muted-foreground hover:bg-att-surface-hover hover:text-foreground"
          style={pad}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <FolderIcon className="h-3.5 w-3.5 shrink-0 text-att-blue/70" />
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children && node.children.length > 0 && (
          <ul>
            {node.children.map((c) => (
              <TreeItem
                key={c.absPath}
                node={c}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const isSelected = selectedPath === node.path
  return (
    <li>
      <button
        onClick={() => onSelect(node)}
        className={cn(
          'flex w-full items-center gap-1 rounded px-1 py-[3px] text-[12px]',
          isSelected
            ? 'bg-att-blue/15 text-att-blue'
            : 'text-muted-foreground hover:bg-att-surface-hover hover:text-foreground'
        )}
        style={pad}
      >
        <span className="w-3 shrink-0" />
        <FileIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  )
}
