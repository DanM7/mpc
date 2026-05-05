import { useStore } from '../store'
import Pad from './Pad'

interface PadGridProps {
  editMode: boolean
}

export default function PadGrid({ editMode }: PadGridProps) {
  const gridSize = useStore((state) => state.gridSize)
  const gridRows = useStore((state) => state.gridRows)
  const pads = useStore((state) => state.pads)

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
    gap: '0.5rem',
    width: '100%',
    maxWidth: '500px',
  }

  return (
    <div style={gridStyle}>
      {pads.slice(0, gridSize * gridRows).map((pad) => (
        <Pad key={pad.id} pad={pad} editMode={editMode} />
      ))}
    </div>
  )
}