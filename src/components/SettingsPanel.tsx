import { useState } from 'react'
import { useStore } from '../store'

interface SettingsPanelProps {
  onClose: () => void
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<'pads' | 'sounds' | 'pattern'>('pads')
  
  const gridSize = useStore((state) => state.gridSize)
  const setGridSize = useStore((state) => state.setGridSize)
  const backgroundColor = useStore((state) => state.backgroundColor)
  const setBackgroundColor = useStore((state) => state.setBackgroundColor)
  const bpm = useStore((state) => state.bpm)
  const setBpm = useStore((state) => state.setBpm)
  const sequencerSteps = useStore((state) => state.sequencerSteps)
  const setSequencerSteps = useStore((state) => state.setSequencerSteps)
  const soundPacks = useStore((state) => state.soundPacks)
  const loadSoundPack = useStore((state) => state.loadSoundPack)
  const pads = useStore((state) => state.pads)
  const updatePad = useStore((state) => state.updatePad)
  const patterns = useStore((state) => state.patterns)
  const savePattern = useStore((state) => state.savePattern)
  const loadPattern = useStore((state) => state.loadPattern)
  const deletePattern = useStore((state) => state.deletePattern)
  const resetPads = useStore((state) => state.resetPads)

  const [patternName, setPatternName] = useState('')

  const handleSavePattern = () => {
    if (patternName.trim()) {
      savePattern(patternName.trim())
      setPatternName('')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-end z-50">
      <div className="w-full bg-gray-900 rounded-t-2xl max-h-[70vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-none flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-bold">Settings</h2>
          <button onClick={onClose} className="p-2 text-gray-400">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex-none flex border-b border-gray-700">
          {(['pads', 'sounds', 'pattern'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-sm font-medium capitalize ${
                activeTab === tab 
                  ? 'text-blue-500 border-b-2 border-blue-500' 
                  : 'text-gray-400'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'pads' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Grid Size</label>
                <select
                  value={gridSize}
                  onChange={(e) => setGridSize(Number(e.target.value))}
                  className="w-full bg-gray-800 text-white p-3 rounded-lg"
                >
                  <option value={2}>2×2 (4 pads)</option>
                  <option value={3}>3×3 (9 pads)</option>
                  <option value={4}>4×4 (16 pads)</option>
                  <option value={5}>5×5 (25 pads)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Background Color</label>
                <input
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="w-full h-12 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">BPM</label>
                <input
                  type="range"
                  min={30}
                  max={200}
                  value={bpm}
                  onChange={(e) => setBpm(Number(e.target.value))}
                  className="w-full"
                />
                <div className="text-center text-white">{bpm} BPM</div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Sequencer Steps</label>
                <select
                  value={sequencerSteps}
                  onChange={(e) => setSequencerSteps(Number(e.target.value))}
                  className="w-full bg-gray-800 text-white p-3 rounded-lg"
                >
                  {Array.from({ length: 16 }, (_, index) => {
                    const steps = index + 1
                    return (
                      <option key={`steps-option-${steps}`} value={steps}>
                        {steps} Step{steps > 1 ? 's' : ''}
                      </option>
                    )
                  })}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Pad Colors (tap pad to change)</label>
                <div className="grid grid-cols-4 gap-2">
                  {pads.map((pad, i) => (
                    <button
                      key={pad.id}
                      onClick={() => updatePad(pad.id, { color: `hsl(${i * 22.5}, 70%, 50%)` })}
                      className="w-full aspect-square rounded-lg"
                      style={{ backgroundColor: pad.color }}
                    />
                  ))}
                </div>
              </div>

              <button
                onClick={resetPads}
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg"
              >
                Reset Pads
              </button>
            </div>
          )}

          {activeTab === 'sounds' && (
            <div className="space-y-4">
              <label className="block text-sm text-gray-400 mb-2">Sound Packs</label>
              {soundPacks.map((pack) => (
                <button
                  key={pack.id}
                  onClick={() => loadSoundPack(pack)}
                  className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-left px-4"
                >
                  {pack.name}
                </button>
              ))}
              
              <div className="pt-4 border-t border-gray-700">
                <p className="text-sm text-gray-400 mb-2">Custom Sound URL</p>
                <input
                  type="text"
                  placeholder="https://example.com/sound.mp3"
                  className="w-full bg-gray-800 text-white p-3 rounded-lg mb-2"
                />
                <p className="text-xs text-gray-500">Enter a URL to load a sound for all pads</p>
              </div>
            </div>
          )}

          {activeTab === 'pattern' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Save Current Pattern</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={patternName}
                    onChange={(e) => setPatternName(e.target.value)}
                    placeholder="Pattern name"
                    className="flex-1 bg-gray-800 text-white p-3 rounded-lg"
                  />
                  <button
                    onClick={handleSavePattern}
                    disabled={!patternName.trim()}
                    className="px-4 bg-blue-600 disabled:bg-gray-600 text-white rounded-lg"
                  >
                    Save
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Saved Patterns</label>
                {patterns.length === 0 ? (
                  <p className="text-gray-500 text-sm">No saved patterns yet</p>
                ) : (
                  <div className="space-y-2">
                    {patterns.map((pattern) => (
                      <div
                        key={pattern.id}
                        className="flex items-center justify-between bg-gray-800 p-3 rounded-lg"
                      >
                        <span className="text-white">{pattern.name}</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => loadPattern(pattern.id)}
                            className="px-3 py-1 bg-blue-600 text-white rounded text-sm"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => deletePattern(pattern.id)}
                            className="px-3 py-1 bg-red-600 text-white rounded text-sm"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-gray-700">
                <p className="text-sm text-gray-400 mb-2">Azure Sync (Coming Soon)</p>
                <p className="text-xs text-gray-500">
                  Sign in to save patterns and sound packs to your Azure account.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}