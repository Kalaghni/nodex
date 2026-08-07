# Nodex

A hexagonal grid architecture diagram tool built with React.

## Features

- **Hexagonal Grid**: Infinite, auto-expanding grid layout
- **Nodes**: Create custom nodes with icons, colors, and labels
- **Connections**: Link nodes with labeled, styled connections
- **Zones**: Group cells with rectangular, hexagonal, or circular zones
- **Nested Diagrams**: Shift+click any node to open its child diagram
- **File Operations**: Save/load JSON, export to SVG/PNG

## Quick Start with Docker

```bash
# Build the image
docker build -t nodex .

# Run the container
docker run -p 8080:80 nodex
```

Then open http://localhost:8080 in your browser.

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'
services:
  nodex:
    build: ../../Downloads/nodex
    ports:
      - "8080:80"
    restart: unless-stopped
```

Then run:

```bash
docker-compose up -d
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Shift+Click | Open nested diagram |
| Double-click | Start connecting nodes |
| Delete | Remove selected node/zone |
| Scroll | Zoom in/out |
| Shift+Drag | Pan canvas |
| Esc | Cancel current action |

## License

MIT
