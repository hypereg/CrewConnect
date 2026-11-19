const maxReportSeconds = 30;

function voiceFields() {
  return `<fieldset class="voice-box">
    <legend>Raport głosowy</legend>
    <p class="muted">Nagraj do 30 sekund. Przycisk „Przygotuj szkic” wysyła nagranie do NVIDIA.</p>
    <div class="duty-actions">
      <button type="button" class="secondary" data-record>Nagraj</button>
      <button type="button" class="secondary" data-stop hidden>Zatrzymaj</button>
      <button type="button" class="secondary" data-draft hidden>Przygotuj szkic</button>
    </div>
    <audio data-playback controls hidden aria-label="Odsłuch nagrania"></audio>
    <p data-voice-status role="status" hidden></p>
    <div data-suggestion hidden>
      <p class="report-notes" data-suggestion-text></p>
      <button type="button" class="secondary" data-use-draft>Wstaw do raportu</button>
    </div>
  </fieldset>`;
}

async function reportWav(recording) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const sampleRate = 16000;
    const size = Math.max(1, Math.min(sampleRate * maxReportSeconds, Math.round(decoded.duration * sampleRate)));
    const mono = new OfflineAudioContext(1, size, sampleRate);
    const source = mono.createBufferSource();
    source.buffer = decoded;
    source.connect(mono.destination);
    source.start();
    const samples = (await mono.startRendering()).getChannelData(0);
    const buffer = new ArrayBuffer(44 + size * 2);
    const view = new DataView(buffer);
    view.setUint32(0, 0x52494646); // RIFF
    view.setUint32(4, buffer.byteLength - 8, true);
    view.setUint32(8, 0x57415645); // WAVE
    view.setUint32(12, 0x666d7420); // fmt
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 0x64617461); // data
    view.setUint32(40, size * 2, true);
    for (let index = 0; index < size; index++) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(44 + index * 2, sample * (sample < 0 ? 32768 : 32767), true);
    }
    return new Blob([buffer], {type: 'audio/wav'});
  } finally {
    await context.close();
  }
}

function bindVoice(form) {
  const record = form.querySelector('[data-record]');
  const stop = form.querySelector('[data-stop]');
  const draft = form.querySelector('[data-draft]');
  const playback = form.querySelector('[data-playback]');
  const status = form.querySelector('[data-voice-status]');
  const suggestion = form.querySelector('[data-suggestion]');
  const suggestionText = form.querySelector('[data-suggestion-text]');
  const useDraft = form.querySelector('[data-use-draft]');
  let stream;
  let recorder;
  let timer;
  let recording;
  let audioUrl;
  const lifetime = new AbortController();
  const active = () => !lifetime.signal.aborted && dialog.open && form.isConnected;
  const message = value => {
    status.hidden = !value;
    status.textContent = value;
  };
  const releaseMicrophone = () => {
    clearTimeout(timer);
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
  };
  dialog.addEventListener('close', () => {
    lifetime.abort();
    if (recorder?.state === 'recording') recorder.stop();
    releaseMicrophone();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    playback.removeAttribute('src');
    playback.load();
  }, {once: true});

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.AudioContext || !window.OfflineAudioContext) {
    record.disabled = true;
    message('Nagrywanie jest niedostępne w tej przeglądarce. Wpisz raport w polu poniżej.');
    return;
  }

  record.onclick = async () => {
    record.disabled = true;
    draft.disabled = true;
    message('Oczekiwanie na dostęp do mikrofonu…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio: true});
      if (!active()) {
        releaseMicrophone();
        return;
      }
      recorder = new MediaRecorder(stream);
      const parts = [];
      let failed = false;
      recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
      recorder.onerror = () => { failed = true; };
      recorder.onstop = () => {
        releaseMicrophone();
        if (!active()) return;
        stop.hidden = true;
        record.disabled = false;
        draft.disabled = false;
        if (failed || !parts.length) {
          message('Nie udało się nagrać dźwięku. Spróbuj ponownie.');
          return;
        }
        recording = new Blob(parts, {type: recorder.mimeType});
        audioUrl = URL.createObjectURL(recording);
        playback.src = audioUrl;
        playback.hidden = false;
        draft.hidden = false;
        record.textContent = 'Nagraj ponownie';
        message('Nagranie gotowe do odsłuchania.');
      };
      recorder.start();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      playback.removeAttribute('src');
      playback.load();
      audioUrl = null;
      recording = null;
      playback.hidden = true;
      draft.hidden = true;
      suggestion.hidden = true;
      stop.hidden = false;
      message('Nagrywanie…');
      timer = setTimeout(() => stop.click(), maxReportSeconds * 1000);
    } catch {
      releaseMicrophone();
      if (active()) {
        record.disabled = false;
        draft.disabled = false;
        message('Nie udało się uruchomić mikrofonu. Sprawdź uprawnienia w przeglądarce.');
      }
    }
  };
  stop.onclick = () => {
    if (recorder?.state === 'recording') recorder.stop();
  };
  draft.onclick = async () => {
    if (!recording) return;
    draft.disabled = true;
    record.disabled = true;
    suggestion.hidden = true;
    message('NVIDIA przygotowuje szkic…');
    try {
      const wav = await reportWav(recording);
      if (!active()) return;
      const result = await dutyRequest('/api/reports/draft', wav, lifetime.signal);
      if (!active()) return;
      suggestionText.textContent = result.notes;
      suggestion.hidden = false;
      message('Sprawdź szkic przed wstawieniem go do raportu.');
    } catch (error) {
      if (active()) message(error instanceof DOMException ? 'Nie udało się odczytać nagrania.' : error.message);
    } finally {
      if (active()) {
        draft.disabled = false;
        record.disabled = false;
      }
    }
  };
  useDraft.onclick = () => {
    form.elements.notes.value = suggestionText.textContent;
    form.elements.notes.focus();
    suggestion.hidden = true;
    message('Szkic wstawiony. Możesz go poprawić przed zapisem.');
  };
}
