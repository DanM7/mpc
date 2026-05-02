import { useState } from 'react'
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

  return (
    <div 
      className="h-full w-full flex flex-col"
      style={{ backgroundColor }}
    >
      {!isAudioReady ? (
        <div className="flex-1 flex items-center justify-center">
          <button
            onClick={handleStart}
            className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white text-xl font-bold rounded-lg transition-colors"
          >
            Tap to Start
          </button>
        </div>
      ) : (
        <>
          <header className="flex-none h-12 flex items-center justify-between px-4 bg-black/30">
            <h1 className="text-lg font-bold">MPC Pads</h1>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            >
              ⚙️
            </button>
          </header>
          
          <main className="flex-1 flex flex-col items-center justify-center gap-3 p-2">
            <div className="w-full max-w-[560px] rounded-lg bg-black/30 p-3">
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={stopSequencer}
                  className="rounded-lg bg-gray-700 px-3 py-2 text-white hover:bg-gray-600"
                >
                  Stop
                </button>
                <button
                  onClick={() => (isPlaying ? pauseSequencer() : playSequencer())}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-white hover:bg-blue-500"
                >
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  onClick={handleRecord}
                  className={`rounded-lg px-3 py-2 text-white ${
                    isRecording ? 'bg-red-600' : 'bg-red-500 hover:bg-red-400'
                  }`}
                >
                  {isRecording ? 'Recording...' : 'Record'}
                </button>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button
                  onClick={() => setIsEditingPads((editing) => !editing)}
                  aria-pressed={isEditingPads}
                  className={`rounded-lg px-3 py-2 text-white ${
                    isEditingPads ? 'bg-purple-600' : 'bg-purple-700 hover:bg-purple-600'
                  }`}
                >
                  Edit Pad
                </button>
                <button
                  onClick={clearCurrentStep}
                  className="rounded-lg bg-amber-700 px-3 py-2 text-white hover:bg-amber-600"
                >
                  Clear Step
                </button>
                <button
                  onClick={resetRecording}
                  className="rounded-lg bg-gray-800 px-3 py-2 text-white hover:bg-gray-700"
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
                      className={`box-border flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white ${
                        hasSound ? 'bg-teal-400' : 'bg-gray-600'
                      } ${
                        isCurrent
                          ? 'shadow-[inset_0_0_0_4px_rgba(255,255,255,0.95)]'
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
            </div>

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