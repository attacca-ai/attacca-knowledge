import { useState, useRef, useCallback } from 'react'
import { useAgentStore } from '@/stores/agent-store'
import { gatewayClient } from '@/lib/gateway-client'
import { useGatewayStore } from '@/stores/gateway-store'
import { Button } from '@/components/ui/button'
import { FileText, Upload, Clipboard, Loader2 } from 'lucide-react'

const SUPPORTED_TYPES = ['.txt', '.md', '.docx', '.pdf', '.vtt', '.srt']

export function TranscriptUpload(): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const addTask = useAgentStore((s) => s.addTask)
  const addActivity = useAgentStore((s) => s.addActivity)
  const [dragOver, setDragOver] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const processTranscript = async (content: string, filename?: string): Promise<void> => {
    setProcessing(true)
    addActivity({
      type: 'info',
      description: `Processing transcript${filename ? `: ${filename}` : ''}...`
    })
    addTask(`Process transcript${filename ? ` from ${filename}` : ''}: Extract action items, create tasks, draft deliverables`)

    if (connectionState === 'connected') {
      try {
        await gatewayClient.rpc('agent.request', {
          prompt: `Process this meeting transcript. Extract: (1) action items assigned to the user, (2) action items assigned to others, (3) calendar events to create or modify, (4) deliverables with deadlines. Create tasks in connected PM tools and calendar events as needed.\n\nTranscript:\n${content}`
        })
      } catch {
        addActivity({ type: 'error', description: 'Failed to send transcript to agent' })
      }
    }
    setProcessing(false)
  }

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)

      const files = Array.from(e.dataTransfer.files)
      for (const file of files) {
        const ext = '.' + file.name.split('.').pop()?.toLowerCase()
        if (!SUPPORTED_TYPES.includes(ext)) {
          addActivity({
            type: 'error',
            description: `Unsupported file type: ${file.name}. Supported: ${SUPPORTED_TYPES.join(', ')}`
          })
          continue
        }

        const content = await file.text()
        await processTranscript(content, file.name)
      }
    },
    [connectionState] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files || [])
    for (const file of files) {
      const content = await file.text()
      await processTranscript(content, file.name)
    }
    e.target.value = ''
  }

  const handlePasteSubmit = async (): Promise<void> => {
    if (!pasteText.trim()) return
    await processTranscript(pasteText.trim())
    setPasteText('')
    setPasteMode(false)
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <h2 className="mb-2 text-xl font-semibold text-foreground">Process Transcript</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Upload or paste a meeting transcript. Your assistant will extract action items,
        create tasks, and draft deliverables.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-8 transition-colors ${
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-muted-foreground/30'
        }`}
      >
        {processing ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Processing transcript...</p>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Drop transcript files here or use the buttons below
            </p>
            <p className="text-xs text-muted-foreground">
              Supported: {SUPPORTED_TYPES.join(', ')}
            </p>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="mt-4 flex gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept={SUPPORTED_TYPES.join(',')}
          onChange={handleFileSelect}
          className="hidden"
          multiple
        />
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={processing}
        >
          <FileText className="h-4 w-4" />
          Browse Files
        </Button>
        <Button
          variant="outline"
          onClick={() => setPasteMode(!pasteMode)}
          disabled={processing}
        >
          <Clipboard className="h-4 w-4" />
          Paste Text
        </Button>
      </div>

      {/* Paste text area */}
      {pasteMode && (
        <div className="mt-4 flex flex-col gap-3">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste your meeting transcript here..."
            className="min-h-[200px] w-full resize-y rounded-md border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPasteMode(false)}>
              Cancel
            </Button>
            <Button onClick={handlePasteSubmit} disabled={!pasteText.trim()}>
              Process Transcript
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
