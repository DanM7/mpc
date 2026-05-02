import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import type { Pad as PadType } from '../types'

interface PadProps {
  pad: PadType
  editMode: boolean
}

export default function Pad({ pad, editMode }: PadProps) {
  const triggerPad = useStore((state) => state.triggerPad)
  const setPadCustomSound = useStore((state) => state.setPadCustomSound)
  const pads = useStore((state) => state.pads)
  const updatePad = useStore((state) => state.updatePad)

  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [pendingSoundUrl, setPendingSoundUrl] = useState('')
  const [customSoundName, setCustomSoundName] = useState('')

  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const mediaStream = useRef<MediaStream | null>(null)
  const chunks = useRef<BlobPart[]>([])

  const getNextUserFxName = useCallback((): string => {
    const userFxIndexes = pads
      .map((item) => item.name.match(/^User FX (\d+)$/i)?.[1])
      .filter((value): value is string => !!value)
      .map((value) => Number(value))

    const nextIndex = userFxIndexes.length > 0 ? Math.max(...userFxIndexes) + 1 : 1
    return `User FX ${nextIndex}`
  }, [pads])

  const handlePress = useCallback(async () => {
    await triggerPad(pad.id)
  }, [pad.id, triggerPad])

  const stopMediaCapture = useCallback(() => {
    const recorder = mediaRecorder.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }

    const stream = mediaStream.current
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      mediaStream.current = null
    }

    mediaRecorder.current = null
  }, [])

  const startMediaCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      mediaStream.current = stream
      chunks.current = []
      mediaRecorder.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.current = [...chunks.current, event.data]
        }
      }

      recorder.onstop = () => {
        const recordedChunks = chunks.current
        chunks.current = []

        if (recordedChunks.length === 0) {
          setPendingSoundUrl('')
          return
        }

        const blob = new Blob(recordedChunks, { type: 'audio/webm' })
        // TODO(azure-blob): Upload this Blob to the sounds endpoint and keep the
        // returned Azure Blob URL instead of this temporary in-memory object URL.
        const soundUrl = URL.createObjectURL(blob)
        setIsRecording(false)
        const defaultName = getNextUserFxName()
        setPendingSoundUrl(soundUrl)
        setCustomSoundName(defaultName)
      }

      recorder.start()
      setIsRecording(true)
    } catch (error) {
      setIsRecording(false)
      window.alert('Unable to access the microphone. Please allow microphone permissions.')
      console.error(error)
    }
  }, [getNextUserFxName])

  const openMenu = useCallback(() => {
    setIsMenuOpen(true)
  }, [])

  const closeMenu = useCallback((options?: { keepPendingSound?: boolean }) => {
    setIsMenuOpen(false)
    setPendingSoundUrl('')
    setCustomSoundName('')
    if (!options?.keepPendingSound && pendingSoundUrl && pendingSoundUrl.startsWith('blob:')) {
      URL.revokeObjectURL(pendingSoundUrl)
    }
    if (isRecording) {
      stopMediaCapture()
      setIsRecording(false)
    }
  }, [isRecording, pendingSoundUrl, stopMediaCapture])

  const handlePointerUp = useCallback(async () => {
    if (editMode) {
      setPendingSoundUrl('')
      setCustomSoundName('')
      openMenu()
      return
    }

    await handlePress()
  }, [editMode, handlePress, openMenu])

  const handleChangeColor = useCallback(() => {
    const newColor = `hsl(${Math.random() * 360}, 70%, 50%)`
    updatePad(pad.id, { color: newColor })
    closeMenu()
  }, [closeMenu, pad.id, updatePad])

  const handleToggleRecording = useCallback(async () => {
    if (isRecording) {
      stopMediaCapture()
      return
    }

    try {
      await startMediaCapture()
    } catch (error) {
      console.error(error)
    }
  }, [isRecording, startMediaCapture, stopMediaCapture])

  const handleDone = useCallback(() => {
    if (!pendingSoundUrl) {
      closeMenu()
      return
    }

    const finalName = customSoundName.trim() || getNextUserFxName()
    // TODO(azure-blob): Save should await the Azure upload result before closing,
    // then pass the persistent blob URL to setPadCustomSound.
    setPadCustomSound(pad.id, pendingSoundUrl, finalName)
    closeMenu({ keepPendingSound: true })
  }, [closeMenu, customSoundName, getNextUserFxName, pad.id, pendingSoundUrl, setPadCustomSound])

  const stopModalEvent = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation()
  }, [])

  const modal = isMenuOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4"
      onClick={stopModalEvent}
      onContextMenu={stopModalEvent}
      onPointerDown={stopModalEvent}
      onPointerLeave={stopModalEvent}
      onPointerUp={stopModalEvent}
    >
      <div className="w-[calc(100dvw-1.5rem)] h-[calc(100dvh-1.5rem)] rounded-2xl bg-gray-900 p-6 text-white shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">Pad {pad.name} options</div>
          <button
            aria-label="Close pad menu"
            onClick={() => closeMenu()}
            className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={handleChangeColor}
            className="rounded-lg bg-blue-700 px-4 py-3 text-left hover:bg-blue-600"
          >
            Change Color
          </button>

          <button
            onClick={handleToggleRecording}
            className={`rounded-lg px-4 py-3 text-left ${
              isRecording ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            {isRecording ? 'Stop recording' : 'Record sound'}
          </button>

          {pendingSoundUrl ? (
            <div className="space-y-2">
              <label className="block text-sm text-white/90" htmlFor={`${pad.id}-name`}>
                Name this sound
              </label>
              <input
                id={`${pad.id}-name`}
                value={customSoundName}
                onChange={(e) => setCustomSoundName(e.target.value)}
                className="w-full rounded-lg bg-gray-800 px-3 py-2 text-white"
                placeholder={getNextUserFxName()}
              />
            </div>
          ) : null}

          <button
            onClick={handleDone}
            className="mt-3 rounded-lg bg-emerald-600 px-4 py-3 text-lg font-semibold hover:bg-emerald-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  ) : null

  const handlePointerDownWithEvent = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      return
    }

    e.preventDefault()
    e.currentTarget.style.transform = 'scale(0.95)'
  }, [])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  const style: React.CSSProperties = {
    backgroundColor: pad.color,
    borderRadius: '8px',
    aspectRatio: '1',
    cursor: 'pointer',
    transition: 'transform 0.05s, opacity 0.05s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'clamp(8px, 2vw, 14px)',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.9)',
    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
    boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.3)',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  }

  return (
    <div
      style={style}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDownWithEvent}
      onPointerUp={async (e) => {
        e.currentTarget.style.transform = 'scale(1)'
        await handlePointerUp()
      }}
      onPointerLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)'
      }}
    >
      {modal ? createPortal(modal, document.body) : null}
      {pad.name}
    </div>
  )
}