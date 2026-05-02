# MPC Pad Sampler

A mobile-first MPC-style pad sampler web app built with React, Vite, Tone.js, and Azure integration.

## Features

- 🎵 **16 customizable pads** in a 4×4 grid (configurable)
- 🎨 **Customize pad colors** — long-press or use settings
- 🖼️ **Customize background color**
- 🔊 **Load sound packs** — comes with basic drum kits
- 💾 **Save/load patterns** locally
- 📱 **PWA-enabled** — add to home screen on mobile
- ☁️ **Azure-ready** — backend code included for cloud sync

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React + TypeScript + Vite |
| Audio | Tone.js |
| Styling | Tailwind CSS |
| State | Zustand |
| PWA | vite-plugin-pwa |
| Backend (included) | Azure Functions + Cosmos DB |

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Install & Run

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Build for Production

```bash
npm run build
```

The built files will be in the `dist` folder.

## Usage

1. **Tap "Tap to Start"** — Required to initialize audio context
2. **Tap pads** — Play sounds
3. **Long-press pad** — Change pad color
4. **Tap ⚙️** — Open settings
   - **Pads tab**: Change grid size, background color, BPM
   - **Sounds tab**: Load different sound packs
   - **Pattern tab**: Save/load patterns

## Azure Deployment (Optional)

The `api/` folder contains Azure Functions code for cloud sync:

```bash
cd api
npm install
npm start
```

### Azure Resources Needed

- **Azure Cosmos DB** — For storing patterns & sound packs
- **Azure Blob Storage** — For storing sound files
- **Azure AD B2C** — For user authentication (optional)

### Environment Variables

Set these in your Azure Function App settings:

```
AzureWebJobsCosmosDB=<cosmos-connection-string>
AzureWebJobsStorage=<storage-connection-string>
```

### TODO: Persist Recorded Samples to Azure Blob Storage

- [ ] Create/configure a `sounds` Blob Storage container and decide whether recorded samples are public, private, or served through SAS URLs.
- [ ] Finish the `POST /api/sounds` Azure Function so it uploads the recorded `audio/webm` file to Blob Storage instead of returning a placeholder URL.
- [ ] Generate safe blob names that include user/session metadata, pad id, and a unique suffix.
- [ ] Return the durable Blob URL and saved sample metadata from the upload endpoint.
- [ ] Update the pad recording flow to upload the recorded `Blob` before calling `setPadCustomSound`.
- [ ] Store the returned Blob URL in pad/pattern data so recorded sounds survive refreshes and browser restarts.
- [ ] Add error and loading states in the modal while a recording is uploading.
- [ ] Add cleanup rules for replaced/deleted user samples so unused blobs do not accumulate.

## Project Structure

```
mpc-pad-sampler/
├── src/
│   ├── components/
│   │   ├── Pad.tsx        # Individual pad component
│   │   ├── PadGrid.tsx   # Grid layout
│   │   └── SettingsPanel.tsx  # Settings UI
│   ├── store.ts          # Zustand state management
│   ├── types.ts          # TypeScript types
│   ├── App.tsx           # Main app component
│   ├── main.tsx          # Entry point
│   └── index.css         # Global styles
├── api/                  # Azure Functions (optional)
├── index.html
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

## License

MIT