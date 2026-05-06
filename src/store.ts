import { create } from 'zustand'
import * as Tone from 'tone'
import type { AppState, Pad, Pattern, SoundPack, StepHit } from './types'

const DEFAULT_SOUND_PACKS: SoundPack[] = [
  {
    id: 'basic-kicks',
    name: 'Basic Kicks',
    pads: Array(16).fill('https://tonejs.github.io/audio/drum-samples/CR78/kick.mp3'),
  },
  {
    id: 'hip-hop',
    name: 'Hip Hop',
    pads: [
      'https://tonejs.github.io/audio/drum-samples/CR78/kick.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/snare.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/hihat.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/kick.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/snare.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/hihat.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/kick.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/snare.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/hihat.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/kick.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/snare.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/hihat.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/snare.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/hihat.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/kick.mp3',
      'https://tonejs.github.io/audio/drum-samples/CR78/snare.mp3',
    ],
  },
]

const DEFAULT_PACK = DEFAULT_SOUND_PACKS[1] ?? DEFAULT_SOUND_PACKS[0]

/** Tone.Player.load owns its buffer; keep an unloaded-from-graph keeper per pad so buffers stay valid */
const sampleBuffers: Map<string, { url: string; keeper: Tone.Player }> = new Map()

type PointerVoice =
  | { status: 'loading'; padId: string; pressAt: number; cancelled: boolean }
  | { status: 'sample'; padId: string; pressAt: number; player: Tone.Player }
  | { status: 'synth'; padId: string; pressAt: number; note: string }

const activePointerVoices: Map<number, PointerVoice> = new Map()

const DEFAULT_SEQUENCER_STEPS = 8
let sequencerEventId: number | null = null
let pendingRecording: StepHit[][] | null = null
let recordingStartStep: number | null = null
let playbackStepCursor: number | null = null
const PAD_NOTES = [
  'C2', 'D2', 'E2', 'G2',
  'A2', 'C3', 'D3', 'E3',
  'G3', 'A3', 'C4', 'D4',
  'E4', 'G4', 'A4', 'C5',
]
const fallbackSynth = new Tone.PolySynth(Tone.Synth).toDestination()

function isDrumPad(padIndex: number): boolean {
  return padIndex >= 0 && padIndex < 3
}

function getNoteLabel(index: number): string {
  return PAD_NOTES[index % PAD_NOTES.length]
}

function inferDrumName(soundUrl: string): string {
  const fileName = soundUrl.split('/').pop()?.toLowerCase() ?? ''
  const label = fileName.replace(/\?.*$/, '').replace(/\.[^/.]*$/, '')

  if (label.includes('kick')) return 'Kick'
  if (label.includes('snare')) return 'Snare'
  if (label.includes('hihat') || label.includes('hi-hat') || label.includes('hi_hat')) return 'Hi-Hat'
  if (label.includes('clap')) return 'Clap'
  if (label.includes('tambourine')) return 'Tambourine'
  if (label.includes('conga')) return 'Conga'
  if (label.includes('cowbell')) return 'Cowbell'
  if (label.includes('crash')) return 'Crash'
  if (label.includes('tom')) return 'Tom'
  if (label.includes('rim')) return 'Rim'
  if (label.includes('cabasa')) return 'Cabasa'
  if (label.includes('claves')) return 'Claves'
  if (label.includes('guiro')) return 'Guiro'
  if (label.includes('shaker')) return 'Shaker'
  if (label.includes('timbal')) return 'Timbal'

  return 'Drum'
}

function getPadName(padIndex: number, soundUrl: string | null): string {
  if (isDrumPad(padIndex) && soundUrl) {
    return inferDrumName(soundUrl)
  }

  return `Synth ${getNoteLabel(padIndex)}`
}

function createPadConfig(index: number, soundUrl: string | null): Pad {
  return {
    id: `pad-${index}`,
    color: `hsl(${(index * 360) / 16}, 70%, 50%)`,
    size: 1,
    soundUrl,
    isUserSample: false,
    name: getPadName(index, soundUrl),
  }
}

const DEFAULT_PADS: Pad[] = Array.from(
  { length: 16 },
  (_, i) => createPadConfig(i, DEFAULT_PACK?.pads[i] ?? null),
)

function getFallbackNote(padId: string): string {
  const index = Number.parseInt(padId.replace('pad-', ''), 10)
  if (Number.isNaN(index)) return PAD_NOTES[0]
  return PAD_NOTES[index % PAD_NOTES.length]
}

function getPadIndex(padId: string): number {
  const index = Number.parseInt(padId.replace('pad-', ''), 10)
  return Number.isNaN(index) ? -1 : index
}

function normalizeStepHit(hit: StepHit | string): StepHit {
  if (typeof hit === 'string') return { padId: hit }
  return {
    padId: hit.padId,
    ...(hit.duration !== undefined ? { duration: hit.duration } : {}),
    ...(hit.velocity !== undefined ? { velocity: hit.velocity } : {}),
  }
}

function getHitPadId(hit: StepHit | string): string {
  return typeof hit === 'string' ? hit : hit.padId
}

function createEmptyRecording(steps: number): StepHit[][] {
  return Array.from({ length: steps }, () => [] as StepHit[])
}

function cloneRecording(recording: (StepHit | string)[][]): StepHit[][] {
  return recording.map((step) => step.map((hit) => normalizeStepHit(hit)))
}

function disposeCachedPlayers() {
  activePointerVoices.forEach((voice) => {
    if (voice.status === 'sample') {
      voice.player.stop()
      voice.player.dispose()
    }
    if (voice.status === 'synth') {
      fallbackSynth.triggerRelease(voice.note)
    }
  })
  activePointerVoices.clear()

  sampleBuffers.forEach(({ keeper }) => keeper.dispose())
  sampleBuffers.clear()
}

function disposePadSampleCache(padId: string) {
  const entry = sampleBuffers.get(padId)
  if (entry) {
    entry.keeper.dispose()
    sampleBuffers.delete(padId)
  }
}

async function ensureSampleBuffer(padId: string, soundUrl: string): Promise<Tone.ToneAudioBuffer | null> {
  const cached = sampleBuffers.get(padId)
  if (cached && cached.url === soundUrl) {
    return cached.keeper.buffer
  }

  if (cached) {
    cached.keeper.dispose()
    sampleBuffers.delete(padId)
  }

  const keeper = new Tone.Player().toDestination()
  try {
    await keeper.load(soundUrl)
  } catch {
    keeper.dispose()
    return null
  }

  keeper.disconnect()
  sampleBuffers.set(padId, { url: soundUrl, keeper })
  return keeper.buffer
}

function upsertStepHit(step: StepHit[], hit: StepHit) {
  const normalized = normalizeStepHit(hit)
  const idx = step.findIndex((h) => getHitPadId(h) === normalized.padId)
  if (idx >= 0) {
    step[idx] = normalized
  } else {
    step.push(normalized)
  }
}

function releasePointerVoice(pointerId: number, padId: string): number | null {
  const voice = activePointerVoices.get(pointerId)
  if (!voice || voice.padId !== padId) {
    return null
  }

  if (voice.status === 'loading') {
    if (voice.cancelled) return null
    voice.cancelled = true
    return Math.max(0, Tone.now() - voice.pressAt)
  }

  activePointerVoices.delete(pointerId)

  if (voice.status === 'sample') {
    try {
      voice.player.stop()
    } catch {
      /* ignore */
    }
    voice.player.dispose()
    return Math.max(0, Tone.now() - voice.pressAt)
  }

  fallbackSynth.triggerRelease(voice.note)
  return Math.max(0, Tone.now() - voice.pressAt)
}

const MAX_SEQUENCER_STEPS = 16

function resetPendingRecordingSession() {
  pendingRecording = null
  recordingStartStep = null
  playbackStepCursor = null
}

function reorderPadRows(pads: Pad[], columns: number, fromRow: number, toRow: number): Pad[] {
  if (columns <= 0) return pads
  const maxRows = Math.floor(pads.length / columns)
  if (maxRows <= 1) return pads
  const safeFrom = Math.max(0, Math.min(fromRow, maxRows - 1))
  const safeTo = Math.max(0, Math.min(toRow, maxRows - 1))
  if (safeFrom === safeTo) return pads

  const rowChunks: Pad[][] = Array.from({ length: maxRows }, (_, rowIndex) =>
    pads.slice(rowIndex * columns, rowIndex * columns + columns),
  )
  const [moved] = rowChunks.splice(safeFrom, 1)
  if (!moved) return pads
  rowChunks.splice(safeTo, 0, moved)

  const flattenedRows = rowChunks.flat()
  const remainder = pads.slice(maxRows * columns)
  return [...flattenedRows, ...remainder]
}

export const useStore = create<AppState>((set, get) => ({
  // Grid
  gridSize: 3,
  gridRows: 3,
  setGridSize: (size) =>
    set((state) => {
      const safeSize = Math.max(1, size)
      const maxRows = Math.max(1, Math.floor(state.pads.length / safeSize))
      return {
        gridSize: safeSize,
        gridRows: Math.min(state.gridRows, maxRows),
      }
    }),
  addGridRow: () =>
    set((state) => {
      const maxRows = Math.max(1, Math.floor(state.pads.length / state.gridSize))
      return { gridRows: Math.min(maxRows, state.gridRows + 1) }
    }),
  deleteGridRow: (rowIndex) =>
    set((state) => {
      if (state.gridRows <= 1) return {}
      const safeRowIndex = Math.max(0, Math.min(rowIndex, state.gridRows - 1))
      const nextPads = reorderPadRows(state.pads, state.gridSize, safeRowIndex, state.gridRows - 1)
      return {
        pads: nextPads,
        gridRows: state.gridRows - 1,
      }
    }),
  moveGridRow: (fromRow, toRow) =>
    set((state) => {
      const maxRows = Math.min(
        state.gridRows,
        Math.max(1, Math.floor(state.pads.length / state.gridSize)),
      )
      if (maxRows <= 1) return {}
      const safeFrom = Math.max(0, Math.min(fromRow, maxRows - 1))
      const safeTo = Math.max(0, Math.min(toRow, maxRows - 1))
      if (safeFrom === safeTo) return {}
      const nextPads = reorderPadRows(state.pads, state.gridSize, safeFrom, safeTo)
      return { pads: nextPads }
    }),

  // Pads
  pads: DEFAULT_PADS,
  updatePad: (id, updates) =>
    set((state) => ({
      pads: state.pads.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    })),
  resetPads: () => set({ pads: DEFAULT_PADS }),

  // Background
  backgroundColor: '#1a1a1a',
  setBackgroundColor: (color) => set({ backgroundColor: color }),

  // Sound Packs
  soundPacks: DEFAULT_SOUND_PACKS,
  loadSoundPack: (pack) =>
    set((state) => {
      // Invalidate cached players so changed pad URLs always play the selected pack.
      disposeCachedPlayers()
      return {
        pads: state.pads.map((pad, i) => ({
          ...pad,
          soundUrl: pack.pads[i] || null,
          isUserSample: false,
          name: getPadName(i, pack.pads[i] || null),
        })),
      }
    }),

  // Patterns
  patterns: [],
  savePattern: (name) => {
    const { pads, bpm, gridSize, gridRows } = get()
    const pattern: Pattern = {
      id: `pattern-${Date.now()}`,
      name,
      bpm,
      gridSize,
      gridRows,
      pads: [...pads],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    set((state) => ({ patterns: [...state.patterns, pattern] }))
  },
  loadPattern: (id) => {
    const pattern = get().patterns.find((p) => p.id === id)
    if (pattern) {
      const maxRows = Math.max(1, Math.floor(pattern.pads.length / pattern.gridSize))
      set({
        pads: pattern.pads,
        bpm: pattern.bpm,
        gridSize: pattern.gridSize,
        gridRows: Math.min(pattern.gridRows ?? pattern.gridSize, maxRows),
      })
    }
  },
  deletePattern: (id) =>
    set((state) => ({ patterns: state.patterns.filter((p) => p.id !== id) })),

  // Audio
  audioInitialized: false,
  initAudio: async () => {
    await Tone.start()
    const transport = Tone.getTransport()
    transport.stop()
    transport.position = 0
    sequencerEventId = null
    pendingRecording = null
    recordingStartStep = null
    playbackStepCursor = null
    disposeCachedPlayers()
    Tone.getTransport().bpm.value = get().bpm
    set((state) => ({
      audioInitialized: true,
      isPlaying: false,
      isRecording: false,
      currentStep: 0,
      recordedPadsByStep: createEmptyRecording(state.sequencerSteps),
    }))
  },
  playSound: async (padId, opts) => {
    const pad = get().pads.find((p) => p.id === padId)
    if (!pad) return

    const padIndex = getPadIndex(padId)
    const isDrum = isDrumPad(padIndex)
    const shouldPlaySample = (isDrum || pad.isUserSample) && !!pad.soundUrl
    const durationSec = opts?.durationSec

    if (shouldPlaySample) {
      const buffer = await ensureSampleBuffer(padId, pad.soundUrl!)
      if (!buffer) {
        set((state) => ({
          recordedPadsByStep: state.recordedPadsByStep.map((stepPads) =>
            stepPads.filter((hit) => getHitPadId(hit) !== padId),
          ),
        }))
        fallbackSynth.triggerAttackRelease(getFallbackNote(padId), '8n')
        return
      }

      const bufDur = buffer.duration
      const playFor =
        durationSec === undefined ? bufDur : Math.min(Math.max(0, durationSec), bufDur)
      const voice = new Tone.Player(buffer).toDestination()
      const now = Tone.now()
      voice.start(now)
      voice.stop(now + playFor)
      window.setTimeout(() => {
        try {
          voice.dispose()
        } catch {
          /* ignore */
        }
      }, playFor * 1000 + 80)
      return
    }

    const note = getFallbackNote(padId)
    const playFor =
      durationSec === undefined ? Tone.Time('8n').toSeconds() : Math.max(0.02, durationSec)
    fallbackSynth.triggerAttack(note)
    window.setTimeout(() => {
      fallbackSynth.triggerRelease(note)
    }, playFor * 1000)
  },

  triggerPadPress: async (padId, pointerId) => {
    if (activePointerVoices.has(pointerId)) {
      return
    }

    const pad = get().pads.find((p) => p.id === padId)
    if (!pad) return

    const padIndex = getPadIndex(padId)
    const isDrum = isDrumPad(padIndex)
    const shouldPlaySample = (isDrum || pad.isUserSample) && !!pad.soundUrl

    if (shouldPlaySample) {
      activePointerVoices.set(pointerId, {
        status: 'loading',
        padId,
        pressAt: Tone.now(),
        cancelled: false,
      })

      const buffer = await ensureSampleBuffer(padId, pad.soundUrl!)
      const entry = activePointerVoices.get(pointerId)

      if (!buffer) {
        activePointerVoices.delete(pointerId)
        set((state) => ({
          recordedPadsByStep: state.recordedPadsByStep.map((stepPads) =>
            stepPads.filter((hit) => getHitPadId(hit) !== padId),
          ),
        }))
        fallbackSynth.triggerAttackRelease(getFallbackNote(padId), '8n')
        return
      }

      if (!entry || entry.status !== 'loading' || entry.padId !== padId) {
        return
      }
      if (entry.cancelled) {
        activePointerVoices.delete(pointerId)
        return
      }

      const player = new Tone.Player(buffer).toDestination()
      player.start()
      activePointerVoices.set(pointerId, {
        status: 'sample',
        padId,
        pressAt: entry.pressAt,
        player,
      })
      return
    }

    const note = getFallbackNote(padId)
    fallbackSynth.triggerAttack(note)
    activePointerVoices.set(pointerId, {
      status: 'synth',
      padId,
      pressAt: Tone.now(),
      note,
    })
  },

  triggerPadRelease: (padId, pointerId) => {
    const held = releasePointerVoice(pointerId, padId)
    if (held === null) {
      return
    }

    const { isRecording, currentStep, recordedPadsByStep } = get()
    if (!isRecording || !pendingRecording) {
      return
    }

    const hit: StepHit = { padId, duration: held }
    const pendingStep = pendingRecording[currentStep]
    if (pendingStep) {
      upsertStepHit(pendingStep, hit)
    }

    const updatedRecorded = cloneRecording(recordedPadsByStep)
    const step = updatedRecorded[currentStep]
    if (step) {
      upsertStepHit(step, hit)
      set({ recordedPadsByStep: updatedRecorded })
    }
  },
  setPadCustomSound: (padId, soundUrl, name) => {
    set((state) => ({
      pads: state.pads.map((pad) => {
        if (pad.id !== padId) return pad

        if (pad.soundUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(pad.soundUrl)
        }

        disposePadSampleCache(pad.id)

        // TODO(azure-blob): Once recorded samples are uploaded, soundUrl should
        // be a durable Azure Blob URL so custom pads survive refresh/reload.
        return {
          ...pad,
          soundUrl,
          isUserSample: true,
          name: name.trim() || `User FX ${pad.id}`,
        }
      }),
    }))
  },
  
  // Sequencer
  sequencerSteps: DEFAULT_SEQUENCER_STEPS,
  setSequencerSteps: (steps) => {
    const safeSteps = Math.max(1, Math.min(steps, MAX_SEQUENCER_STEPS))
    resetPendingRecordingSession()
    set({
      sequencerSteps: safeSteps,
      currentStep: 0,
      isRecording: false,
      recordedPadsByStep: createEmptyRecording(safeSteps),
    })
  },
  addSequencerStep: () =>
    set((state) => {
      if (state.sequencerSteps >= MAX_SEQUENCER_STEPS) return {}
      resetPendingRecordingSession()
      return {
        sequencerSteps: state.sequencerSteps + 1,
        recordedPadsByStep: [...cloneRecording(state.recordedPadsByStep), []],
        isRecording: false,
      }
    }),
  deleteSequencerStep: (stepIndex) =>
    set((state) => {
      if (state.sequencerSteps <= 1) return {}
      const idx = Math.max(0, Math.min(stepIndex, state.sequencerSteps - 1))
      resetPendingRecordingSession()
      const nextRecorded = cloneRecording(state.recordedPadsByStep)
      nextRecorded.splice(idx, 1)
      let nextCurrent = state.currentStep
      if (idx < nextCurrent) {
        nextCurrent -= 1
      } else if (idx === nextCurrent) {
        nextCurrent = Math.min(nextCurrent, nextRecorded.length - 1)
      }
      nextCurrent = Math.max(0, Math.min(nextCurrent, nextRecorded.length - 1))
      return {
        sequencerSteps: state.sequencerSteps - 1,
        recordedPadsByStep: nextRecorded,
        currentStep: nextCurrent,
        isRecording: false,
      }
    }),
  moveSequencerStep: (fromIndex, toIndex) =>
    set((state) => {
      const n = state.sequencerSteps
      if (n <= 1) return {}
      const safeFrom = Math.max(0, Math.min(fromIndex, n - 1))
      const safeTo = Math.max(0, Math.min(toIndex, n - 1))
      if (safeFrom === safeTo) return {}

      resetPendingRecordingSession()

      const nextRecorded = cloneRecording(state.recordedPadsByStep)
      const [moved] = nextRecorded.splice(safeFrom, 1)
      nextRecorded.splice(safeTo, 0, moved ?? [])

      let nextCurrent = state.currentStep
      if (nextCurrent === safeFrom) {
        nextCurrent = safeTo
      } else if (safeFrom < safeTo) {
        if (nextCurrent > safeFrom && nextCurrent <= safeTo) {
          nextCurrent -= 1
        }
      } else if (safeFrom > safeTo) {
        if (nextCurrent >= safeTo && nextCurrent < safeFrom) {
          nextCurrent += 1
        }
      }

      return {
        recordedPadsByStep: nextRecorded,
        currentStep: nextCurrent,
        isRecording: false,
      }
    }),
  currentStep: 0,
  isPlaying: false,
  isRecording: false,
  recordedPadsByStep: createEmptyRecording(DEFAULT_SEQUENCER_STEPS),
  playSequencer: () => {
    if (playbackStepCursor === null) {
      playbackStepCursor = get().currentStep
    }

    if (sequencerEventId === null) {
      sequencerEventId = Tone.getTransport().scheduleRepeat(() => {
        const {
          sequencerSteps,
          recordedPadsByStep,
          isRecording,
          playSound,
        } = get()

        const stepToPlay = ((playbackStepCursor ?? 0) % sequencerSteps + sequencerSteps) % sequencerSteps
        const nextStep = (stepToPlay + 1) % sequencerSteps
        const updates: Partial<AppState> = { currentStep: stepToPlay }

        const padsToPlay = recordedPadsByStep[stepToPlay] ?? []
        padsToPlay.forEach((hit) => {
          const h = normalizeStepHit(hit)
          void playSound(h.padId, { durationSec: h.duration })
        })

        if (isRecording && pendingRecording && recordingStartStep !== null && nextStep === recordingStartStep) {
          updates.recordedPadsByStep = cloneRecording(pendingRecording)
          pendingRecording = cloneRecording(pendingRecording)
          recordingStartStep = nextStep
        }

        playbackStepCursor = nextStep
        set(updates)
      }, '16n')
    }

    Tone.getTransport().start()
    set({ isPlaying: true })
  },
  pauseSequencer: () => {
    Tone.getTransport().pause()
    set({ isPlaying: false })
  },
  stopSequencer: () => {
    Tone.getTransport().stop()
    Tone.getTransport().position = 0
    pendingRecording = null
    recordingStartStep = null
    playbackStepCursor = null
    set({ isPlaying: false, isRecording: false, currentStep: 0 })
  },
  jumpToStep: (step) => {
    const { sequencerSteps } = get()
    const normalizedStep = ((step % sequencerSteps) + sequencerSteps) % sequencerSteps
    playbackStepCursor = normalizedStep
    set({ currentStep: normalizedStep })
  },
  startRecording: () => {
    pendingRecording = cloneRecording(get().recordedPadsByStep)
    recordingStartStep = get().currentStep
    set({ isRecording: true })
  },
  stopRecording: () => {
    pendingRecording = null
    recordingStartStep = null
    set({ isRecording: false })
  },
  clearCurrentStep: () => {
    const { currentStep, isRecording, recordedPadsByStep } = get()
    const clearedRecorded = cloneRecording(recordedPadsByStep)
    if (clearedRecorded[currentStep]) {
      clearedRecorded[currentStep] = []
    }

    if (isRecording) {
      if (!pendingRecording) {
        pendingRecording = cloneRecording(clearedRecorded)
      }
      if (pendingRecording[currentStep]) {
        pendingRecording[currentStep] = []
      }
    }

    set({ recordedPadsByStep: clearedRecorded })
  },
  resetRecording: () => {
    pendingRecording = null
    recordingStartStep = null
    disposeCachedPlayers()
    set({
      isRecording: false,
      recordedPadsByStep: createEmptyRecording(get().sequencerSteps),
    })
  },

  // BPM
  bpm: 45,
  setBpm: (bpm) => {
    Tone.getTransport().bpm.value = bpm
    set({ bpm })
  },
}))