import { useEffect, useState } from 'react'
import PadGrid from './components/PadGrid'
import SettingsPanel from './components/SettingsPanel'
import { useStore } from './store'
import * as Tone from 'tone'

function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [isAudioReady, setIsAudioReady] = useState(false)
  const [isEditingPads, setIsEditingPads] = useState(false)
  const backgroundColor = useStore((state) => state.backgroundColor)
  const initAudio = useStore((state) => state.initAudio)
  const isPlaying = useStore((state) => state.isPlaying)
  const isRecording = useStore((state) => state.isRecording)
  const gridRows = useStore((state) => state.gridRows)
  const currentStep = useStore((state) => state.currentStep)
  const sequencerSteps = useStore((state) => state.sequencerSteps)
  const recordedPadsByStep = useStore((state) => state.recordedPadsByStep)
  const playSequencer = useStore((state) => state.playSequencer)
  const pauseSequencer = useStore((state) => state.pauseSequencer)
  const stopSequencer = useStore((state) => state.stopSequencer)
  const jumpToStep = useStore((state) => state.jumpToStep)
  const startRecording = useStore((state) => state.startRecording)
  const stopRecording = useStore((state) => state.stopRecording)
  const clearCurrentStep = useStore((state) => state.clearCurrentStep)
  const resetRecording = useStore((state) => state.resetRecording)
  const addGridRow = useStore((state) => state.addGridRow)
  const deleteGridRow = useStore((state) => state.deleteGridRow)
  const moveGridRow = useStore((state) => state.moveGridRow)
  const addSequencerStep = useStore((state) => state.addSequencerStep)
  const deleteSequencerStep = useStore((state) => state.deleteSequencerStep)
  const moveSequencerStep = useStore((state) => state.moveSequencerStep)
  const [selectedRow, setSelectedRow] = useState(0)
  const [selectedStepIndex, setSelectedStepIndex] = useState(0)
  const [showControls, setShowControls] = useState(false)
  const [controlsTab, setControlsTab] = useState<'pad' | 'step'>('pad')

  const handleStart = async () => {
    await Tone.start()
    await initAudio()
    setIsAudioReady(true)
  }

  const handleRecord = () => {
    if (isRecording) {
      stopRecording()
      return
    }
    startRecording()
  }

  useEffect(() => {
    setSelectedRow((current) => Math.max(0, Math.min(current, gridRows - 1)))
  }, [gridRows])

  useEffect(() => {
    setSelectedStepIndex((current) => Math.max(0, Math.min(current, sequencerSteps - 1)))
  }, [sequencerSteps])

  return (
    <div 
      className="mpc-shell h-full w-full flex flex-col"
      style={{ backgroundColor }}
    >
      {!isAudioReady ? (
        <div className="flex-1 flex items-center justify-center">
          <button
            onClick={handleStart}
            className="mpc-btn px-8 py-4 text-xl font-bold"
          >
            Tap to Start
          </button>
        </div>
      ) : (
        <>
          <header className="mpc-panel flex-none h-12 flex items-center justify-between px-4">
            <h1 className="text-lg font-bold tracking-wide text-zinc-200">MPC Pads</h1>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="mpc-btn px-3 py-1.5 text-sm"
            >
              Settings
            </button>
          </header>
          
          <main className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col items-center justify-start gap-3 p-2">
            <div className="mpc-panel w-full max-w-[560px] p-3">
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={stopSequencer}
                  className="mpc-btn px-3 py-2 text-white"
                >
                  Stop
                </button>
                <button
                  onClick={() => (isPlaying ? pauseSequencer() : playSequencer())}
                  className={`mpc-led-btn px-3 py-2 text-white ${isPlaying ? 'is-on' : ''}`}
                >
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  onClick={handleRecord}
                  className={`mpc-led-btn px-3 py-2 text-white ${
                    isRecording ? 'is-rec' : ''
                  }`}
                >
                  {isRecording ? 'Recording...' : 'Record'}
                </button>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button
                  onClick={() => setIsEditingPads((editing) => !editing)}
                  aria-pressed={isEditingPads}
                  className={`mpc-btn px-3 py-2 text-white ${
                    isEditingPads ? 'ring-1 ring-cyan-300/70' : ''
                  }`}
                >
                  {isEditingPads ? 'Done Editing' : 'Edit Pad'}
                </button>
                <button
                  onClick={clearCurrentStep}
                  className="mpc-btn px-3 py-2 text-white"
                >
                  Clear Step
                </button>
                <button
                  onClick={resetRecording}
                  className="mpc-btn px-3 py-2 text-white"
                >
                  Reset All Steps
                </button>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 justify-items-center sm:grid-cols-8">
                {Array.from({ length: sequencerSteps }, (_, stepIndex) => {
                  const hasSound =
                    (recordedPadsByStep[stepIndex]?.length ?? 0) > 0
                  const isCurrent = stepIndex === currentStep
                  return (
                    <button
                      key={`step-${stepIndex}`}
                      type="button"
                      onClick={() => {
                        if (!isPlaying) {
                          jumpToStep(stepIndex)
                        }
                      }}
                      disabled={isPlaying}
                      aria-label={`Step ${stepIndex + 1}`}
                      className={`box-border flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sm font-bold text-zinc-100 ${
                        hasSound ? 'bg-cyan-500/70 shadow-[0_0_8px_rgba(34,211,238,0.45)]' : 'bg-zinc-700/90'
                      } ${
                        isCurrent
                          ? 'shadow-[inset_0_0_0_2px_rgba(255,255,255,0.9),0_0_12px_rgba(34,211,238,0.5)]'
                          : ''
                      } ${
                        isPlaying ? 'cursor-default' : 'cursor-pointer'
                      }`}
                    >
                      {stepIndex + 1}
                    </button>
                  )
                })}
              </div>
              <div className="mt-3 rounded-md bg-zinc-900/70 p-2 border border-zinc-700/70">
                <button
                  type="button"
                  onClick={() => setShowControls((current) => !current)}
                  className="mpc-btn flex w-full items-center justify-between px-2 py-2 text-xs font-semibold uppercase tracking-wide text-white/80"
                  aria-expanded={showControls}
                >
                  <span>Controls</span>
                  <span>{showControls ? 'Hide' : 'Show'}</span>
                </button>
                {showControls ? (
                  <div className="mt-2">
                    <div
                      className="flex overflow-hidden rounded-lg border border-zinc-600 bg-zinc-950/80"
                      role="tablist"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={controlsTab === 'pad'}
                        onClick={() => {
                          if (controlsTab === 'pad') {
                            setShowControls(false)
                          } else {
                            setControlsTab('pad')
                          }
                        }}
                        className={`flex-1 px-3 py-2.5 text-xs font-bold uppercase tracking-wide transition-colors ${
                          controlsTab === 'pad'
                            ? 'bg-amber-900/55 text-amber-50 ring-1 ring-inset ring-amber-400/40'
                            : 'text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200'
                        }`}
                      >
                        Pad rows
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={controlsTab === 'step'}
                        onClick={() => {
                          if (controlsTab === 'step') {
                            setShowControls(false)
                          } else {
                            setControlsTab('step')
                          }
                        }}
                        className={`flex-1 border-l border-zinc-600 px-3 py-2.5 text-xs font-bold uppercase tracking-wide transition-colors ${
                          controlsTab === 'step'
                            ? 'bg-cyan-950/70 text-cyan-50 ring-1 ring-inset ring-cyan-400/40'
                            : 'text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200'
                        }`}
                      >
                        Steps
                      </button>
                    </div>

                    {controlsTab === 'pad' ? (
                      <div className="mt-3" role="tabpanel">
                        <label className="sr-only" htmlFor="pad-row-select">
                          Pad row
                        </label>
                        <select
                          id="pad-row-select"
                          value={selectedRow}
                          onChange={(event) => setSelectedRow(Number(event.target.value))}
                          className="mb-2 w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-2 text-sm text-white"
                        >
                          {Array.from({ length: gridRows }, (_, rowIndex) => (
                            <option key={`row-option-${rowIndex}`} value={rowIndex}>
                              Pad row {rowIndex + 1}
                            </option>
                          ))}
                        </select>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <button
                            type="button"
                            onClick={() => addGridRow()}
                            className="mpc-btn flex items-center gap-1.5 border-l-2 border-amber-400 px-2 py-2 text-left text-sm text-white"
                          >
                            <span className="text-[10px] font-bold text-amber-300">PAD</span>
                            <span>Add row</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteGridRow(selectedRow)}
                            disabled={gridRows <= 1}
                            className={`flex items-center gap-1.5 border-l-2 border-amber-400 px-2 py-2 text-left text-sm text-white ${
                              gridRows <= 1 ? 'cursor-not-allowed bg-zinc-800/80 text-white/50' : 'mpc-btn'
                            }`}
                          >
                            <span className="text-[10px] font-bold text-amber-300">PAD</span>
                            <span>Delete row</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => moveGridRow(selectedRow, selectedRow - 1)}
                            disabled={selectedRow <= 0}
                            className={`flex items-center gap-1.5 border-l-2 border-amber-400 px-2 py-2 text-left text-sm text-white ${
                              selectedRow <= 0 ? 'cursor-not-allowed bg-zinc-800/80 text-white/50' : 'mpc-btn'
                            }`}
                          >
                            <span className="text-[10px] font-bold text-amber-300">PAD</span>
                            <span>Move ↑</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => moveGridRow(selectedRow, selectedRow + 1)}
                            disabled={selectedRow >= gridRows - 1}
                            className={`flex items-center gap-1.5 border-l-2 border-amber-400 px-2 py-2 text-left text-sm text-white ${
                              selectedRow >= gridRows - 1
                                ? 'cursor-not-allowed bg-zinc-800/80 text-white/50'
                                : 'mpc-btn'
                            }`}
                          >
                            <span className="text-[10px] font-bold text-amber-300">PAD</span>
                            <span>Move ↓</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3" role="tabpanel">
                        <label className="sr-only" htmlFor="step-index-select">
                          Sequencer step
                        </label>
                        <select
                          id="step-index-select"
                          value={selectedStepIndex}
                          onChange={(event) => setSelectedStepIndex(Number(event.target.value))}
                          className="mb-2 w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-2 text-sm text-white"
                        >
                          {Array.from({ length: sequencerSteps }, (_, stepIndex) => (
                            <option key={`step-select-${stepIndex}`} value={stepIndex}>
                              Step {stepIndex + 1}
                            </option>
                          ))}
                        </select>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <button
                            type="button"
                            onClick={() => addSequencerStep()}
                            disabled={sequencerSteps >= 16}
                            className={`flex items-center gap-1.5 border-l-2 border-cyan-400 px-2 py-2 text-left text-sm text-white ${
                              sequencerSteps >= 16 ? 'cursor-not-allowed bg-zinc-800/80 text-white/50' : 'mpc-btn'
                            }`}
                          >
                            <span className="text-[10px] font-bold text-cyan-300">STEP</span>
                            <span>Add step</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSequencerStep(selectedStepIndex)}
                            disabled={sequencerSteps <= 1}
                            className={`flex items-center gap-1.5 border-l-2 border-cyan-400 px-2 py-2 text-left text-sm text-white ${
                              sequencerSteps <= 1 ? 'cursor-not-allowed bg-zinc-800/80 text-white/50' : 'mpc-btn'
                            }`}
                          >
                            <span className="text-[10px] font-bold text-cyan-300">STEP</span>
                            <span>Delete step</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSequencerStep(selectedStepIndex, selectedStepIndex - 1)}
                            disabled={selectedStepIndex <= 0}
                            className={`flex items-center gap-1.5 border-l-2 border-cyan-400 px-2 py-2 text-left text-sm text-white ${
                              selectedStepIndex <= 0 ? 'cursor-not-allowed bg-zinc-800/80 text-white/50' : 'mpc-btn'
                            }`}
                          >
                            <span className="text-[10px] font-bold text-cyan-300">STEP</span>
                            <span>Move ↑</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSequencerStep(selectedStepIndex, selectedStepIndex + 1)}
                            disabled={selectedStepIndex >= sequencerSteps - 1}
                            className={`flex items-center gap-1.5 border-l-2 border-cyan-400 px-2 py-2 text-left text-sm text-white ${
                              selectedStepIndex >= sequencerSteps - 1
                                ? 'cursor-not-allowed bg-zinc-800/80 text-white/50'
                                : 'mpc-btn'
                            }`}
                          >
                            <span className="text-[10px] font-bold text-cyan-300">STEP</span>
                            <span>Move ↓</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            {isEditingPads ? (
              <div className="w-full max-w-[500px] rounded-lg border border-cyan-300/40 bg-cyan-950/45 px-4 py-2 text-center text-sm font-semibold text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.45)]">
                Editing mode is on. Tap a pad to edit it.
              </div>
            ) : null}

            <PadGrid editMode={isEditingPads} />
          </main>
          
          {showSettings && (
            <SettingsPanel onClose={() => setShowSettings(false)} />
          )}
        </>
      )}
    </div>
  )
}

export default App