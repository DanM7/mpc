import { create } from 'zustand'
import * as Tone from 'tone'
import type { AppState, Pad, Pattern, SoundPack } from './types'

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

const players: Map<string, Tone.Player> = new Map()
const playerUrls: Map<string, string> = new Map()
const DEFAULT_SEQUENCER_STEPS = 8
let sequencerEventId: number | null = null
let pendingRecording: string[][] | null = null
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

function createEmptyRecording(steps: number): string[][] {
  return Array.from({ length: steps }, () => [] as string[])
}

function cloneRecording(recording: string[][]): string[][] {
  return recording.map((step) => [...step])
}

function disposeCachedPlayers() {
  players.forEach((player) => player.dispose())
  players.clear()
  playerUrls.clear()
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
  playSound: async (padId) => {
    const pad = get().pads.find((p) => p.id === padId)
    if (!pad) return

    const padIndex = getPadIndex(padId)
    const isDrum = isDrumPad(padIndex)
    const shouldPlaySample = (isDrum || pad.isUserSample) && !!pad.soundUrl

    if (shouldPlaySample) {
      let player = players.get(padId)
      const currentUrl = playerUrls.get(padId)

      if (player && currentUrl !== pad.soundUrl) {
        player.dispose()
        players.delete(padId)
        playerUrls.delete(padId)
        player = undefined
      }

      if (!player) {
        player = new Tone.Player().toDestination()
        try {
          await player.load(pad.soundUrl)
          players.set(padId, player)
          playerUrls.set(padId, pad.soundUrl)
        } catch {
          player.dispose()
          set((state) => ({
            recordedPadsByStep: state.recordedPadsByStep.map((stepPads) =>
              stepPads.filter((recordedPadId) => recordedPadId !== padId),
            ),
          }))
          fallbackSynth.triggerAttackRelease(getFallbackNote(padId), '8n')
          return
        }
      }

      player.start()
      return
    }

    // Pads 4+ are intentionally synth voices for a hybrid drum/synth layout.
    fallbackSynth.triggerAttackRelease(getFallbackNote(padId), '8n')
  },
  triggerPad: async (padId) => {
    const { isRecording, currentStep, recordedPadsByStep } = get()
    if (isRecording && pendingRecording) {
      const stepHits = pendingRecording[currentStep]
      if (stepHits && !stepHits.includes(padId)) {
        stepHits.push(padId)
      }

      const updatedRecorded = cloneRecording(recordedPadsByStep)
      const playedPadIds = updatedRecorded[currentStep] ?? []
      if (!playedPadIds.includes(padId)) {
        updatedRecorded[currentStep] = [...playedPadIds, padId]
        set({ recordedPadsByStep: updatedRecorded })
      }
    }

    await get().playSound(padId)
  },
  setPadCustomSound: (padId, soundUrl, name) => {
    set((state) => ({
      pads: state.pads.map((pad) => {
        if (pad.id !== padId) return pad

        if (pad.soundUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(pad.soundUrl)
        }

        if (players.has(pad.id)) {
          players.get(pad.id)?.dispose()
          players.delete(pad.id)
          playerUrls.delete(pad.id)
        }

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
        padsToPlay.forEach((padId) => {
          void playSound(padId)
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