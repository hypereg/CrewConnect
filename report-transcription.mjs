import grpc from '@grpc/grpc-js';
import {loadSync} from '@grpc/proto-loader';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';

const proto = fileURLToPath(new URL('./riva-asr.proto', import.meta.url));
const {RivaSpeechRecognition} = grpc.loadPackageDefinition(loadSync(proto)).nvidia.riva.asr;
const parakeet = new RivaSpeechRecognition('grpc.nvcf.nvidia.com:443', grpc.credentials.createSsl());

function* recognitionMessages(pcm) {
  yield {streamingConfig: {config: {
    encoding: 1, // 16-bit signed little-endian PCM
    sampleRateHertz: 16000,
    languageCode: 'multi',
    maxAlternatives: 1,
    enableAutomaticPunctuation: true
  }}};
  const chunkSize = 3200; // 100 ms of mono PCM at 16 kHz
  for (let offset = 0; offset < pcm.length; offset += chunkSize) {
    yield {audioContent: Buffer.from(pcm.subarray(offset, offset + chunkSize))};
  }
}

export function transcribeReport(pcm, apiKey) {
  const metadata = new grpc.Metadata();
  metadata.set('authorization', 'Bearer ' + apiKey);
  metadata.set('function-id', '71203149-d3b7-4460-8231-1be2543a1fca'); // Parakeet RNNT Multilingual
  const call = parakeet.streamingRecognize(metadata, {deadline: Date.now() + 35000});
  const source = Readable.from(recognitionMessages(pcm));
  return new Promise((resolve, reject) => {
    const segments = [];
    call.on('data', response => {
      for (const result of response.results || []) {
        if (result.isFinal && result.alternatives?.[0]?.transcript) {
          segments.push(result.alternatives[0].transcript);
        }
      }
    });
    call.on('error', error => {
      source.destroy();
      reject(error);
    });
    call.on('end', () => resolve(segments.join(' ').trim()));
    source.pipe(call);
  });
}
