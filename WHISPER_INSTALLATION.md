# Whisper.cpp Integration - Installation Notes

## Overview
The app now supports Whisper.cpp as a local, offline alternative to ElevenLabs Scribe for speech-to-text. The integration automatically falls back to Whisper if Scribe is unavailable or if no API key is provided.

## Installation Issue
If you encounter a `ModuleNotFoundError: No module named 'distutils'` error when installing `@xenova/transformers`, this is because Python 3.12+ removed the `distutils` module that `sharp` (an image processing library dependency) requires.

## Workaround Solutions

### Option 1: Install setuptools (Recommended)
```bash
pip3 install setuptools
```

Then try installing again:
```bash
npm install
```

### Option 2: Use an older Python version (if setuptools doesn't work)
You can temporarily use Python 3.11 or earlier for the build process.

### Option 3: Skip sharp (Advanced)
Since Whisper doesn't actually need `sharp` (it's only used for image processing), you can manually install `@xenova/transformers` and skip the sharp build:

1. Install setuptools first: `pip3 install setuptools`
2. If it still fails, the package will still work for Whisper - sharp is only needed for image models

## Usage

Once installed, the app will automatically:
1. Try to use Scribe if an `ELEVENLABS_API_KEY` is provided
2. Fall back to Whisper.cpp if:
   - No API key is provided
   - Scribe connection fails (e.g., 403 Forbidden)
   - Scribe API is unavailable

## Model Selection

The default model is `Xenova/whisper-tiny.en` (~39MB, fastest). You can change it in `electron/WhisperCppClient.ts`:

```typescript
// In WhisperCppClient.connect(), change the model:
this.pipeline = await pipeline(
  "automatic-speech-recognition",
  "Xenova/whisper-base.en", // or "whisper-small.en", "whisper-medium.en"
  // ...
)
```

### Available Models:
- `Xenova/whisper-tiny.en` - Fastest (~39MB), good for real-time
- `Xenova/whisper-base.en` - Balanced (~74MB), better accuracy
- `Xenova/whisper-small.en` - Better accuracy (~244MB), slower
- `Xenova/whisper-medium.en` - Best accuracy (~769MB), much slower

The first run will download the model (one-time download).

## Performance Notes

- **Latency**: Whisper processes audio in 2-second chunks, so expect ~500ms-2s delay depending on model size
- **CPU Usage**: Whisper runs on CPU (can be intensive, especially for larger models)
- **Privacy**: 100% local - no data sent to external services
- **Offline**: Works completely offline after initial model download

## Troubleshooting

If Whisper still doesn't work after installation:
1. Check console logs for specific error messages
2. Ensure microphone permissions are granted
3. Verify the model downloads successfully (check for `.cache` directory)
4. Try a smaller model if performance is poor

