export interface Pad {
  id: string
  color: string
  size: number
  soundUrl: string | null
  name: string
  isUserSample?: boolean
}

export interface SoundPack {
  id: string
  name: string
  pads: string[]
}

export interface Pattern {
  id: string
  name: string
  bpm: number
  gridSize: number
  gridRows?: number
  pads: Pad[]
  createdAt: string
  updatedAt: string
}

export interface AppState {
  // Grid
  gridSize: number
  gridRows: number
  setGridSize: (size: number) => void
  addGridRow: () => void
  deleteGridRow: (rowIndex: number) => void
  moveGridRow: (fromRow: number, toRow: number) => void
  
  // Pads
  pads: Pad[]
  updatePad: (id: string, updates: Partial<Pad>) => void
  resetPads: () => void
  
  // Background
  backgroundColor: string
  setBackgroundColor: (color: string) => void
  
  // Sound Packs
  soundPacks: SoundPack[]
  loadSoundPack: (pack: SoundPack) => void
  
  // Patterns
  patterns: Pattern[]
  savePattern: (name: string) => void
  loadPattern: (id: string) => void
  deletePattern: (id: string) => void
  
  // Audio
  audioInitialized: boolean
  initAudio: () => Promise<void>
  playSound: (padId: string) => Promise<void>
  triggerPad: (padId: string) => Promise<void>
  setPadCustomSound: (padId: string, soundUrl: string, name: string) => void
  
  // Sequencer
  sequencerSteps: number
  setSequencerSteps: (steps: number) => void
  addSequencerStep: () => void
  deleteSequencerStep: (stepIndex: number) => void
  moveSequencerStep: (fromIndex: number, toIndex: number) => void
  currentStep: number
  isPlaying: boolean
  isRecording: boolean
  recordedPadsByStep: string[][]
  playSequencer: () => void
  pauseSequencer: () => void
  stopSequencer: () => void
  jumpToStep: (step: number) => void
  startRecording: () => void
  stopRecording: () => void
  clearCurrentStep: () => void
  resetRecording: () => void
  
  // BPM
  bpm: number
  setBpm: (bpm: number) => void
}