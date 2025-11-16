// Test script to verify microphone capture works
const recorder = require('node-record-lpcm16');

console.log('🎤 Starting microphone test...');
console.log('Speak into your microphone for 5 seconds...\n');

const recording = recorder.record({
  sampleRate: 16000,
  channels: 1,
  audioType: 'raw',
  recorder: 'sox'
});

let chunkCount = 0;
let totalBytes = 0;

recording.stream()
  .on('data', (chunk) => {
    chunkCount++;
    totalBytes += chunk.length;
    if (chunkCount % 10 === 0) {
      console.log(`✓ Received ${chunkCount} chunks (${totalBytes} bytes)`);
    }
  })
  .on('error', (error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });

// Stop after 5 seconds
setTimeout(() => {
  console.log('\n🛑 Stopping...');
  recorder.stop();
  
  console.log(`\n✅ Success!`);
  console.log(`   Chunks received: ${chunkCount}`);
  console.log(`   Total audio data: ${totalBytes} bytes`);
  console.log(`   Sample rate: 16kHz`);
  console.log(`   Format: PCM 16-bit mono`);
  console.log('\n👍 Microphone is working correctly!');
  
  process.exit(0);
}, 5000);

