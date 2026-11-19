import grpc from '@grpc/grpc-js';
import {loadSync} from '@grpc/proto-loader';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';

const proto = fileURLToPath(new URL('./riva-asr.proto', import.meta.url));
const {RivaSpeechRecognition} = grpc.loadPackageDefinition(loadSync(proto)).nvidia.riva.asr;
const riva = new RivaSpeechRecognition('grpc.nvcf.nvidia.com:443', grpc.credentials.createSsl());

function* recognitionMessages(pcm) {
  yield {streamingConfig: {interimResults: true, config: {
    encoding: 1, // 16-bit signed little-endian PCM
    sampleRateHertz: 16000,
    languageCode: 'multi',
    model: 'parakeet-rnnt-1.1b-unified-ml-cs-universal-multi-asr-streaming',
    maxAlternatives: 1,
    enableAutomaticPunctuation: true
  }}};
  const chunkSize = 3200; // 100 ms of mono PCM at 16 kHz
  for (let offset = 0; offset < pcm.length; offset += chunkSize) {
    yield {audioContent: Buffer.from(pcm.subarray(offset, offset + chunkSize))};
  }
  for (let index = 0; index < 8; index++) yield {audioContent: Buffer.alloc(chunkSize)};
}

function recognitionMetadata(apiKey, functionId) {
  const metadata = new grpc.Metadata();
  metadata.set('authorization', 'Bearer ' + apiKey);
  metadata.set('function-id', functionId);
  return metadata;
}

function streamTranscript(pcm, apiKey) {
  const metadata = recognitionMetadata(apiKey, '71203149-d3b7-4460-8231-1be2543a1fca');
  const call = riva.streamingRecognize(metadata, {deadline: Date.now() + 24000});
  const source = Readable.from(recognitionMessages(pcm));
  return new Promise((resolve, reject) => {
    const segments = [];
    let interim = '';
    call.on('data', response => {
      for (const result of response.results || []) {
        const text = result.alternatives?.[0]?.transcript?.trim();
        if (result.isFinal) {
          if (text || interim) segments.push(text || interim);
          interim = '';
        } else if (text) {
          interim = text;
        }
      }
    });
    call.on('error', error => {
      source.destroy();
      reject(error);
    });
    call.on('end', () => resolve([...segments, interim].filter(Boolean).join(' ')));
    source.pipe(call);
  });
}

export async function transcribeReport(pcm, apiKey) {
  const transcript = await streamTranscript(pcm, apiKey).catch(() => '');
  if (transcript) return transcript;
  const metadata = recognitionMetadata(apiKey, 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d');
  const request = {
    config: {encoding: 1, sampleRateHertz: 16000, languageCode: 'pl', maxAlternatives: 1},
    audio: Buffer.from(pcm)
  };
  return new Promise((resolve, reject) => {
    riva.recognize(request, metadata, {deadline: Date.now() + 24000}, (error, response) => {
      if (error) return reject(error);
      resolve((response.results || []).map(result => result.alternatives?.[0]?.transcript || '').join(' ').trim());
    });
  });
}
