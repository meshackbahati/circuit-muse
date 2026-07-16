# Contributing to CircuitMuse

Thanks for your interest in contributing! Here's how to get started.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Create a branch for your feature
4. Make your changes
5. Test your changes
6. Submit a pull request

## Development Setup

### Prerequisites

- Node.js 20+
- Python 3.12+
- Rust (for Tauri desktop build)

### Setup

```bash
# Install app dependencies
cd app
npm install

# Install engine dependencies
cd ../engine
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Running in Development

```bash
# Terminal 1: Frontend
cd app
npm run dev

# Terminal 2: Engine
cd engine
source venv/bin/activate
uvicorn app.main:app --port 8001

# Terminal 3: Desktop (optional)
cd src-tauri
cargo tauri dev
```

## Project Structure

```
circuit-muse/
├── app/                  # React + Vite + TypeScript
├── engine/               # FastAPI + Python
├── src-tauri/            # Rust + Tauri
└── .github/workflows/    # CI/CD
```

## Code Style

- **TypeScript**: ESLint + Prettier
- **Python**: Follow PEP 8
- **Rust**: Use `cargo fmt`

Run linting before submitting:

```bash
cd app
npm run check
```

## Pull Request Process

1. Update documentation if needed
2. Add tests for new features
3. Ensure all checks pass
4. Request a review

## Reporting Issues

- Use GitHub Issues
- Include steps to reproduce
- Include your OS and version
- Include error messages

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
