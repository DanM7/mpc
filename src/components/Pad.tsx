import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import type { Pad as PadType } from '../types'

const LEADING_SILENCE_THRESHOLD = 0.01
const NOISE_PROFILE_MS = 700
const FADE_IN_MS = 8
const FADE_OUT_MS = 14
const TARGET_PEAK = 0.92
const TARGET_RMS = 0.2
const MAX_NORMALIZE_GAIN = 8
const WAVEFORM_BARS = 96

type DenoiseLevel = 'off' | 'light' | 'strong'

const DENOISE_PROFILE: Record<DenoiseLevel, { highPassHz: number; lowPassHz: number }> = {
  off: { highPassHz: 0, lowPassHz: 0 },
  light: { highPassHz: 120, lowPassHz: 9000 },
  strong: { highPassHz: 170, lowPassHz: 7000 },
}

interface PadProps {
  pad: PadType
  editMode: boolean
}

function encodeWav(audioBuffer: AudioBuffer): Blob {
  const channels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const frameCount = audioBuffer.length
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = frameCount * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  let offset = 0
  const writeString = (value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset, value.charCodeAt(i))
      offset += 1
    }
  }

  writeString('RIFF')
  view.setUint32(offset, 36 + dataSize, true)
  offset += 4
  writeString('WAVE')
  writeString('fmt ')
  view.setUint32(offset, 16, true)
  offset += 4
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint16(offset, channels, true)
  offset += 2
  view.setUint32(offset, sampleRate, true)
  offset += 4
  view.setUint32(offset, byteRate, true)
  offset += 4
  view.setUint16(offset, blockAlign, true)
  offset += 2
  view.setUint16(offset, bitsPerSample, true)
  offset += 2
  writeString('data')
  view.setUint32(offset, dataSize, true)
  offset += 4

  const channelData = Array.from({ length: channels }, (_, index) => audioBuffer.getChannelData(index))
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel]?.[frame] ?? 0))
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      view.setInt16(offset, intSample, true)
      offset += 2
    }
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function trimAndNormalizeBuffer(audioBuffer: AudioBuffer): AudioBuffer {
  const sampleRate = audioBuffer.sampleRate
  const channels = audioBuffer.numberOfChannels
  const fadeInFrames = Math.max(1, Math.round((FADE_IN_MS / 1000) * sampleRate))
  const fadeOutFrames = Math.max(1, Math.round((FADE_OUT_MS / 1000) * sampleRate))
  const noiseProfileLength = Math.min(
    audioBuffer.length,
    Math.max(1, Math.round((NOISE_PROFILE_MS / 1000) * sampleRate)),
  )
  let noiseEnergy = 0
  let noiseCount = 0
  let noisePeak = 0
  for (let frame = 0; frame < noiseProfileLength; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = audioBuffer.getChannelData(channel)?.[frame] ?? 0
      const abs = Math.abs(sample)
      if (abs > noisePeak) {
        noisePeak = abs
      }
      noiseEnergy += sample * sample
      noiseCount += 1
    }
  }
  const noiseFloorRms = noiseCount > 0 ? Math.sqrt(noiseEnergy / noiseCount) : 0
  const trimmedLength = Math.max(1, audioBuffer.length)
  const processed = new AudioBuffer({
    length: trimmedLength,
    numberOfChannels: channels,
    sampleRate,
  })

  let peak = 0
  let rmsEnergy = 0
  let rmsCount = 0
  const gateThreshold = Math.max(noiseFloorRms * 2.5, LEADING_SILENCE_THRESHOLD * 1.2)
  for (let channel = 0; channel < channels; channel += 1) {
    const source = audioBuffer.getChannelData(channel)
    const target = processed.getChannelData(channel)
    for (let i = 0; i < trimmedLength; i += 1) {
      const rawSample = source[i] ?? 0
      const abs = Math.abs(rawSample)
      const gatedSample = abs < gateThreshold ? 0 : rawSample
      target[i] = gatedSample
      rmsEnergy += gatedSample * gatedSample
      rmsCount += 1
      const gatedAbs = Math.abs(gatedSample)
      if (gatedAbs > peak) {
        peak = gatedAbs
      }
    }
  }

  const currentRms = rmsCount > 0 ? Math.sqrt(rmsEnergy / rmsCount) : 0
  const peakGain = peak > 0 ? TARGET_PEAK / peak : 1
  const rmsGain = currentRms > 0 ? TARGET_RMS / currentRms : 1
  const gain = Math.min(MAX_NORMALIZE_GAIN, peakGain, rmsGain)

  for (let channel = 0; channel < channels; channel += 1) {
    const target = processed.getChannelData(channel)
    for (let i = 0; i < trimmedLength; i += 1) {
      const fadeIn = i < fadeInFrames ? i / fadeInFrames : 1
      const fadeOutStart = Math.max(0, trimmedLength - fadeOutFrames)
      const fadeOut = i >= fadeOutStart ? (trimmedLength - i) / fadeOutFrames : 1
      const shapedFade = Math.max(0, Math.min(1, fadeIn * fadeOut))
      target[i] = Math.max(-1, Math.min(1, target[i] * gain * shapedFade))
    }
  }

  return processed
}

function applyDenoiseFilter(audioBuffer: AudioBuffer, denoiseLevel: DenoiseLevel): AudioBuffer {
  const profile = DENOISE_PROFILE[denoiseLevel]
  if (!profile || denoiseLevel === 'off') {
    return audioBuffer
  }

  const denoised = new AudioBuffer({
    length: audioBuffer.length,
    numberOfChannels: audioBuffer.numberOfChannels,
    sampleRate: audioBuffer.sampleRate,
  })

  const dt = 1 / audioBuffer.sampleRate
  const highPassRc = 1 / (2 * Math.PI * profile.highPassHz)
  const highPassAlpha = highPassRc / (highPassRc + dt)
  const lowPassRc = 1 / (2 * Math.PI * profile.lowPassHz)
  const lowPassAlpha = dt / (lowPassRc + dt)

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const source = audioBuffer.getChannelData(channel)
    const target = denoised.getChannelData(channel)
    let previousInput = source[0] ?? 0
    let highPassState = 0
    let lowPassState = 0

    for (let i = 0; i < audioBuffer.length; i += 1) {
      const input = source[i] ?? 0
      highPassState = highPassAlpha * (highPassState + input - previousInput)
      previousInput = input
      lowPassState += lowPassAlpha * (highPassState - lowPassState)
      target[i] = lowPassState
    }
  }

  return denoised
}

function trimBufferRange(audioBuffer: AudioBuffer, trimStartFrames: number, trimEndFrames: number): AudioBuffer {
  const safeTrimStart = Math.max(0, Math.min(trimStartFrames, Math.max(0, audioBuffer.length - 1)))
  const maxEndTrim = Math.max(0, audioBuffer.length - safeTrimStart - 1)
  const safeTrimEnd = Math.max(0, Math.min(trimEndFrames, maxEndTrim))
  const trimmedLength = Math.max(1, audioBuffer.length - safeTrimStart - safeTrimEnd)
  const trimmed = new AudioBuffer({
    length: trimmedLength,
    numberOfChannels: audioBuffer.numberOfChannels,
    sampleRate: audioBuffer.sampleRate,
  })

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const source = audioBuffer.getChannelData(channel)
    const target = trimmed.getChannelData(channel)
    for (let i = 0; i < trimmedLength; i += 1) {
      target[i] = source[i + safeTrimStart] ?? 0
    }
  }

  return trimmed
}

function buildWaveformPeaks(audioBuffer: AudioBuffer, bars: number): number[] {
  if (audioBuffer.length === 0 || bars <= 0) {
    return []
  }

  const channels = audioBuffer.numberOfChannels
  const samplesPerBar = Math.max(1, Math.floor(audioBuffer.length / bars))
  const peaks: number[] = []

  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * samplesPerBar
    const end = Math.min(audioBuffer.length, start + samplesPerBar)
    let peak = 0

    for (let i = start; i < end; i += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.abs(audioBuffer.getChannelData(channel)?.[i] ?? 0)
        if (sample > peak) {
          peak = sample
        }
      }
    }

    peaks.push(peak)
  }

  return peaks
}

function formatMs(ms: number): string {
  const safeMs = Math.max(0, Math.floor(ms))
  const totalSeconds = Math.floor(safeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const centiseconds = Math.floor((safeMs % 1000) / 10)
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`
}

export default function Pad({ pad, editMode }: PadProps) {
  const triggerPadPress = useStore((state) => state.triggerPadPress)
  const triggerPadRelease = useStore((state) => state.triggerPadRelease)
  const setPadCustomSound = useStore((state) => state.setPadCustomSound)
  const pads = useStore((state) => state.pads)
  const updatePad = useStore((state) => state.updatePad)
  const currentStep = useStore((state) => state.currentStep)
  const recordedPadsByStep = useStore((state) => state.recordedPadsByStep)

  const assignedToCurrentStep = useMemo(
    () =>
      (recordedPadsByStep[currentStep] ?? []).some((hit) =>
        typeof hit === 'string' ? hit === pad.id : hit.padId === pad.id,
      ),
    [currentStep, pad.id, recordedPadsByStep],
  )

  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessingRecording, setIsProcessingRecording] = useState(false)
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false)
  const [pendingSoundUrl, setPendingSoundUrl] = useState('')
  const [pendingProcessedBuffer, setPendingProcessedBuffer] = useState<AudioBuffer | null>(null)
  const [manualStartMs, setManualStartMs] = useState(0)
  const [manualEndMs, setManualEndMs] = useState(0)
  const [denoiseLevel, setDenoiseLevel] = useState<DenoiseLevel>('light')
  const [customSoundName, setCustomSoundName] = useState('')

  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const mediaStream = useRef<MediaStream | null>(null)
  const chunks = useRef<BlobPart[]>([])
  const previewAudio = useRef<HTMLAudioElement | null>(null)
  const previewAnimationFrame = useRef<number | null>(null)
  const [previewProgress, setPreviewProgress] = useState(0)

  const getNextUserFxName = useCallback((): string => {
    const userFxIndexes = pads
      .map((item) => item.name.match(/^User FX (\d+)$/i)?.[1])
      .filter((value): value is string => !!value)
      .map((value) => Number(value))

    const nextIndex = userFxIndexes.length > 0 ? Math.max(...userFxIndexes) + 1 : 1
    return `User FX ${nextIndex}`
  }, [pads])


  const replacePendingSoundUrl = useCallback((nextUrl: string) => {
    setPendingSoundUrl((prevUrl) => {
      if (prevUrl && prevUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prevUrl)
      }
      return nextUrl
    })
  }, [])

  const clearPendingSound = useCallback(() => {
    setPendingSoundUrl((prevUrl) => {
      if (prevUrl && prevUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prevUrl)
      }
      return ''
    })
    setPendingProcessedBuffer(null)
    setManualStartMs(0)
    setManualEndMs(0)
  }, [])

  const applyManualTrim = useCallback((sourceBuffer: AudioBuffer, startMs: number, endMs: number, denoise: DenoiseLevel): string => {
    const durationMs = sourceBuffer.duration * 1000
    const safeStartMs = Math.max(0, Math.min(startMs, durationMs))
    const safeEndMs = Math.max(safeStartMs, Math.min(endMs, durationMs))
    const trimStartFrames = Math.round((safeStartMs / 1000) * sourceBuffer.sampleRate)
    const trimEndFrames = Math.round(((durationMs - safeEndMs) / 1000) * sourceBuffer.sampleRate)
    const trimmedBuffer = trimBufferRange(sourceBuffer, trimStartFrames, trimEndFrames)
    const denoisedBuffer = applyDenoiseFilter(trimmedBuffer, denoise)
    const trimmedBlob = encodeWav(denoisedBuffer)
    return URL.createObjectURL(trimmedBlob)
  }, [])

  const waveformPeaks = useMemo(
    () => (pendingProcessedBuffer ? buildWaveformPeaks(pendingProcessedBuffer, WAVEFORM_BARS) : []),
    [pendingProcessedBuffer],
  )
  const clipDurationMs = pendingProcessedBuffer
    ? Math.max(0, Math.floor(pendingProcessedBuffer.duration * 1000))
    : 0

  useEffect(() => {
    if (!pendingProcessedBuffer) {
      return
    }
    const nextUrl = applyManualTrim(pendingProcessedBuffer, manualStartMs, manualEndMs, denoiseLevel)
    replacePendingSoundUrl(nextUrl)
  }, [applyManualTrim, denoiseLevel, manualEndMs, manualStartMs, pendingProcessedBuffer, replacePendingSoundUrl])

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
        void (async () => {
        const recordedChunks = chunks.current
        chunks.current = []
        setIsProcessingRecording(true)

        if (recordedChunks.length === 0) {
          clearPendingSound()
          setCustomSoundName('')
          setIsProcessingRecording(false)
          return
        }

        try {
          const sourceBlob = new Blob(recordedChunks, { type: 'audio/webm' })
          const arrayBuffer = await sourceBlob.arrayBuffer()
          const audioContext = new AudioContext()
          try {
            const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0))
            const processedBuffer = trimAndNormalizeBuffer(decoded)
            const fullDurationMs = Math.max(0, Math.floor(processedBuffer.duration * 1000))
            const soundUrl = applyManualTrim(processedBuffer, 0, fullDurationMs, denoiseLevel)

            // TODO(azure-blob): Upload this Blob to the sounds endpoint and keep the
            // returned Azure Blob URL instead of this temporary in-memory object URL.
            setIsRecording(false)
            const defaultName = getNextUserFxName()
            setPendingProcessedBuffer(processedBuffer)
            setManualStartMs(0)
            setManualEndMs(fullDurationMs)
            replacePendingSoundUrl(soundUrl)
            setCustomSoundName(defaultName)
          } finally {
            await audioContext.close()
          }
        } catch (error) {
          console.error('Failed to process recorded audio, falling back to raw sample.', error)
          const fallbackBlob = new Blob(recordedChunks, { type: 'audio/webm' })
          const soundUrl = URL.createObjectURL(fallbackBlob)
          setIsRecording(false)
          const defaultName = getNextUserFxName()
          setPendingProcessedBuffer(null)
          setManualStartMs(0)
          setManualEndMs(0)
          replacePendingSoundUrl(soundUrl)
          setCustomSoundName(defaultName)
        } finally {
          setIsProcessingRecording(false)
        }
      })()
      }

      recorder.start()
      setIsRecording(true)
      setIsProcessingRecording(false)
      clearPendingSound()
      setCustomSoundName('')
    } catch (error) {
      setIsRecording(false)
      setIsProcessingRecording(false)
      window.alert('Unable to access the microphone. Please allow microphone permissions.')
      console.error(error)
    }
  }, [applyManualTrim, clearPendingSound, denoiseLevel, getNextUserFxName, replacePendingSoundUrl])

  const openMenu = useCallback(() => {
    setIsMenuOpen(true)
  }, [])

  const stopPreview = useCallback(() => {
    if (previewAnimationFrame.current !== null) {
      cancelAnimationFrame(previewAnimationFrame.current)
      previewAnimationFrame.current = null
    }
    const audio = previewAudio.current
    if (!audio) {
      return
    }
    audio.pause()
    audio.currentTime = 0
    previewAudio.current = null
    setIsPreviewPlaying(false)
    setPreviewProgress(0)
  }, [])

  const handlePreviewSound = useCallback(async () => {
    const urlToPreview = pendingSoundUrl || pad.soundUrl
    if (!urlToPreview || isRecording || isProcessingRecording) {
      return
    }

    stopPreview()
    try {
      const audio = new Audio(urlToPreview)
      previewAudio.current = audio

      const updatePreviewProgress = () => {
        const duration = audio.duration
        if (Number.isFinite(duration) && duration > 0) {
          const progress = Math.max(0, Math.min(1, audio.currentTime / duration))
          setPreviewProgress(progress)
        }
        if (!audio.paused && !audio.ended) {
          previewAnimationFrame.current = requestAnimationFrame(updatePreviewProgress)
        }
      }

      audio.onended = () => {
        if (previewAnimationFrame.current !== null) {
          cancelAnimationFrame(previewAnimationFrame.current)
          previewAnimationFrame.current = null
        }
        setIsPreviewPlaying(false)
        previewAudio.current = null
        setPreviewProgress(1)
      }
      audio.onerror = () => {
        if (previewAnimationFrame.current !== null) {
          cancelAnimationFrame(previewAnimationFrame.current)
          previewAnimationFrame.current = null
        }
        setIsPreviewPlaying(false)
        previewAudio.current = null
        setPreviewProgress(0)
      }
      setPreviewProgress(0)
      setIsPreviewPlaying(true)
      await audio.play()
      previewAnimationFrame.current = requestAnimationFrame(updatePreviewProgress)
    } catch (error) {
      console.error('Unable to preview sound.', error)
      setIsPreviewPlaying(false)
      previewAudio.current = null
      setPreviewProgress(0)
    }
  }, [isProcessingRecording, isRecording, pad.soundUrl, pendingSoundUrl, stopPreview])

  const closeMenu = useCallback((options?: { keepPendingSound?: boolean }) => {
    stopPreview()
    setIsMenuOpen(false)
    if (options?.keepPendingSound) {
      setIsProcessingRecording(false)
      return
    }
    clearPendingSound()
    setCustomSoundName('')
    setIsProcessingRecording(false)
    if (isRecording) {
      stopMediaCapture()
      setIsRecording(false)
    }
  }, [clearPendingSound, isRecording, stopMediaCapture, stopPreview])

  const handlePointerUp = useCallback(
    async (pointerId: number) => {
      if (editMode) {
        stopPreview()
        clearPendingSound()
        setCustomSoundName('')
        openMenu()
        return
      }

      triggerPadRelease(pad.id, pointerId)
    },
    [clearPendingSound, editMode, openMenu, pad.id, stopPreview, triggerPadRelease],
  )

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
    if (isRecording || isProcessingRecording) {
      return
    }

    if (!pendingSoundUrl) {
      closeMenu()
      return
    }

    const finalName = customSoundName.trim() || getNextUserFxName()
    // TODO(azure-blob): Save should await the Azure upload result before closing,
    // then pass the persistent blob URL to setPadCustomSound.
    setPadCustomSound(pad.id, pendingSoundUrl, finalName)
    closeMenu({ keepPendingSound: true })
  }, [
    closeMenu,
    customSoundName,
    getNextUserFxName,
    isProcessingRecording,
    isRecording,
    pad.id,
    pendingSoundUrl,
    setPadCustomSound,
  ])

  const handleStartTimeChange = useCallback((nextStartMs: number) => {
    if (!pendingProcessedBuffer) {
      return
    }
    const clampedStartMs = Math.max(0, Math.min(nextStartMs, clipDurationMs))
    setManualStartMs(clampedStartMs)
  }, [clipDurationMs, pendingProcessedBuffer])

  const handleEndTimeChange = useCallback((nextEndMs: number) => {
    if (!pendingProcessedBuffer) {
      return
    }
    const clampedEndMs = Math.max(0, Math.min(nextEndMs, clipDurationMs))
    setManualEndMs(clampedEndMs)
  }, [clipDurationMs, pendingProcessedBuffer])

  const rangeStartRatio = clipDurationMs > 0 ? Math.max(0, Math.min(1, manualStartMs / clipDurationMs)) : 0
  const rangeEndRatio = clipDurationMs > 0 ? Math.max(rangeStartRatio, Math.min(1, manualEndMs / clipDurationMs)) : 1
  const previewLineRatio = pendingProcessedBuffer
    ? rangeStartRatio + (rangeEndRatio - rangeStartRatio) * previewProgress
    : previewProgress

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

          <button
            onClick={isPreviewPlaying ? stopPreview : () => void handlePreviewSound()}
            disabled={isRecording || isProcessingRecording || (!pendingSoundUrl && !pad.soundUrl)}
            className={`rounded-lg px-4 py-3 text-left ${
              isRecording || isProcessingRecording || (!pendingSoundUrl && !pad.soundUrl)
                ? 'cursor-not-allowed bg-gray-800 text-white/60'
                : 'bg-indigo-700 hover:bg-indigo-600'
            }`}
          >
            {isPreviewPlaying ? 'Stop preview' : 'Preview sound'}
          </button>

          {pendingProcessedBuffer ? (
            <div className="rounded-lg bg-gray-800/60 p-3">
              <div className="mb-2 text-sm font-semibold text-white/90">Denoise</div>
              <div className="grid grid-cols-3 gap-2">
                {(['off', 'light', 'strong'] as DenoiseLevel[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDenoiseLevel(level)}
                    className={`rounded px-2 py-2 text-sm font-semibold capitalize ${
                      denoiseLevel === level
                        ? 'bg-cyan-600 text-white'
                        : 'bg-gray-700 text-white/85 hover:bg-gray-600'
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {pendingSoundUrl ? (
            <div className="space-y-2">
              {pendingProcessedBuffer ? (
                <div className="space-y-2 rounded-lg bg-gray-800/60 p-3">
                  <div className="text-sm font-semibold text-white/90">Trim range</div>
                  <div className="relative h-20 w-full overflow-hidden rounded bg-gray-950/80">
                    <div className="absolute inset-0 flex items-end gap-[1px] px-1 py-1">
                      {waveformPeaks.map((peak, index) => {
                        const heightPercent = Math.max(4, Math.round(peak * 100))
                        return (
                          <div
                            key={`wave-${index}`}
                            className="w-full rounded-[1px] bg-emerald-400/85"
                            style={{ height: `${heightPercent}%` }}
                          />
                        )
                      })}
                    </div>
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 bg-red-500/20"
                      style={{
                        width: `${clipDurationMs > 0 ? (manualStartMs / clipDurationMs) * 100 : 0}%`,
                      }}
                    />
                    <div
                      className="pointer-events-none absolute inset-y-0 right-0 bg-amber-500/20"
                      style={{
                        width: `${clipDurationMs > 0 ? ((clipDurationMs - manualEndMs) / clipDurationMs) * 100 : 0}%`,
                      }}
                    />
                    <div
                      className="pointer-events-none absolute inset-y-0 w-[2px] bg-cyan-300/90 shadow-[0_0_6px_rgba(34,211,238,0.9)]"
                      style={{
                        left: `${Math.max(0, Math.min(100, previewLineRatio * 100))}%`,
                        transform: 'translateX(-50%)',
                        opacity: isPreviewPlaying ? 1 : 0.55,
                      }}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={clipDurationMs}
                    value={Math.min(manualStartMs, clipDurationMs)}
                    onChange={(event) => handleStartTimeChange(Number(event.target.value))}
                    className="w-full accent-emerald-500"
                  />
                  <div className="text-xs text-white/80">
                    Start time: {formatMs(manualStartMs)}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={clipDurationMs}
                    value={Math.min(manualEndMs, clipDurationMs)}
                    onChange={(event) => handleEndTimeChange(Number(event.target.value))}
                    className="w-full accent-amber-500"
                  />
                  <div className="text-xs text-white/80">
                    End time: {formatMs(manualEndMs)}
                  </div>
                </div>
              ) : null}
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
            disabled={isRecording || isProcessingRecording || !pendingSoundUrl}
            className={`mt-3 rounded-lg px-4 py-3 text-lg font-semibold ${
              isRecording || isProcessingRecording || !pendingSoundUrl
                ? 'cursor-not-allowed bg-emerald-900/60 text-white/60'
                : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            {isProcessingRecording ? 'Processing...' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  ) : null

  const handlePointerDownWithEvent = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) {
        return
      }

      e.preventDefault()
      setIsPressed(true)
      if (!editMode) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* unsupported */
        }
        void triggerPadPress(pad.id, e.pointerId)
      }
    },
    [editMode, pad.id, triggerPadPress],
  )

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  const mixStrong = isPressed ? 92 : assignedToCurrentStep ? 78 : 48
  const mixSoft = isPressed ? 78 : assignedToCurrentStep ? 62 : 38

  const stepAssignedGlow =
    assignedToCurrentStep && !isPressed
      ? ', 0 0 18px rgba(34,211,238,0.45), 0 0 6px rgba(34,211,238,0.38)'
      : ''

  const style: React.CSSProperties = {
    borderRadius: '8px',
    aspectRatio: '1',
    cursor: 'pointer',
    transition: 'box-shadow 0.12s ease, filter 0.12s ease',
    display: 'flex',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'clamp(8px, 2vw, 14px)',
    fontWeight: 700,
    letterSpacing: '0.03em',
    color: isPressed ? 'rgba(248,250,252,0.98)' : 'rgba(226,232,240,0.94)',
    textShadow: isPressed
      ? `0 1px 2px rgba(0,0,0,0.65), 0 0 10px color-mix(in srgb, ${pad.color} 70%, transparent)`
      : `0 1px 2px rgba(0,0,0,0.55), 0 0 6px color-mix(in srgb, ${pad.color} 45%, transparent)`,
    border: '1px solid rgba(148, 163, 184, 0.22)',
    backgroundImage: [
      'linear-gradient(180deg, rgba(255,255,255,0.13) 0%, transparent 38%, rgba(0,0,0,0.28) 100%)',
      'repeating-linear-gradient(135deg, rgba(255,255,255,0.04) 0px, transparent 1px, transparent 3px)',
      `linear-gradient(165deg, color-mix(in srgb, ${pad.color} ${mixStrong}%, transparent) 0%, color-mix(in srgb, ${pad.color} ${mixSoft}%, transparent) 100%)`,
      'linear-gradient(180deg, #4a4f58 0%, #2f343d 56%, #252932 100%)',
    ].join(', '),
    boxShadow: editMode
      ? `inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.45), inset 0 0 0 2px rgba(34,211,238,0.75), 0 0 0 2px rgba(34,211,238,0.28), 0 0 14px color-mix(in srgb, ${pad.color} 55%, transparent), 0 4px 10px rgba(0,0,0,0.5)${stepAssignedGlow}`
      : isPressed
        ? `inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.48), 0 0 16px color-mix(in srgb, ${pad.color} 65%, transparent), 0 4px 10px rgba(0,0,0,0.5)`
        : `inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.45), 0 3px 8px rgba(0,0,0,0.42)${stepAssignedGlow}`,
    userSelect: 'none',
    WebkitUserSelect: 'none',
    filter: isPressed
      ? 'brightness(1.06) saturate(1.08)'
      : assignedToCurrentStep
        ? 'brightness(1.07) saturate(1.14)'
        : 'brightness(1) saturate(1)',
  }

  return (
    <div
      style={style}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDownWithEvent}
      onPointerUp={async (e) => {
        try {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        } catch {
          /* ignore */
        }
        setIsPressed(false)
        await handlePointerUp(e.pointerId)
      }}
      onPointerCancel={(e) => {
        try {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        } catch {
          /* ignore */
        }
        setIsPressed(false)
        if (!editMode) {
          triggerPadRelease(pad.id, e.pointerId)
        }
      }}
    >
      {modal ? createPortal(modal, document.body) : null}
      <span className="pointer-events-none relative z-[1]">{pad.name}</span>
      {editMode ? (
        <span className="absolute bottom-1 right-1 rounded bg-cyan-950/80 px-1.5 py-0.5 text-[10px] font-bold text-cyan-200 border border-cyan-400/50">
          EDIT
        </span>
      ) : null}
    </div>
  )
}