const reportSampleRate = 16000;
const reportChunkSize = reportSampleRate * 45;

function voiceFields(enabled, unavailable, demo) {
  return `<fieldset class="voice-box">
    <legend>Raport głosowy</legend>
    <p class="muted">${enabled ? 'Po zakończeniu nagranie trafi do NVIDIA, a gotowy szkic pojawi się w formularzu.' : unavailable}</p>
    ${enabled && demo ? `<label data-voice-access${dutySession ? ' hidden' : ''}>Hasło załogi
      <input type="password" name="voicePassword" maxlength="150" autocomplete="current-password"></label>` : ''}
    <div class="duty-actions">
      <button type="button" class="primary" data-record${enabled ? '' : ' disabled'}>Nagraj raport</button>
      <button type="button" class="primary" data-stop hidden>Zakończ i wyślij do AI</button>
      <button type="button" class="primary" data-draft hidden>Ponów wysyłanie do AI</button>
    </div>
    <p data-voice-status role="status" hidden></p>
    <div data-suggestion hidden>
      <p class="report-notes" data-suggestion-text></p>
      <button type="button" class="secondary" data-use-draft>Zastąp treść szkicem</button>
    </div>
  </fieldset>`;
}

async function reportSamples(recording) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const size = Math.max(1, Math.round(decoded.length * reportSampleRate / decoded.sampleRate));
    const mono = new OfflineAudioContext(1, size, reportSampleRate);
    const source = mono.createBufferSource();
    source.buffer = decoded;
    source.connect(mono.destination);
    source.start();
    return (await mono.startRendering()).getChannelData(0);
  } finally {
    await context.close();
  }
}

function reportWav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  view.setUint32(0, 0x52494646); // RIFF
  view.setUint32(4, buffer.byteLength - 8, true);
  view.setUint32(8, 0x57415645); // WAVE
  view.setUint32(12, 0x666d7420); // fmt
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, reportSampleRate, true);
  view.setUint32(28, reportSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461); // data
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample * (sample < 0 ? 32768 : 32767), true);
  }
  return new Blob([buffer], {type: 'audio/wav'});
}

async function generateVoiceDraft(recording, signal, session, message) {
  const samples = await reportSamples(recording);
  signal.throwIfAborted();
  const count = Math.ceil(samples.length / reportChunkSize);
  const transcripts = [];
  for (let index = 0; index < count; index++) {
    const offset = index * reportChunkSize;
    message(`Rozpoznawanie mowy · część ${index + 1} z ${count}…`);
    const {transcript} = await dutyRequest('/api/reports/transcript',
      reportWav(samples.subarray(offset, offset + reportChunkSize)), signal, session);
    transcripts.push(transcript);
  }
  message('NVIDIA przygotowuje szkic…');
  return dutyRequest('/api/reports/draft', {transcript: transcripts.filter(Boolean).join('\n')}, signal, session);
}

function bindVoice(form) {
  const record = form.querySelector('[data-record]');
  const stop = form.querySelector('[data-stop]');
  const draft = form.querySelector('[data-draft]');
  const status = form.querySelector('[data-voice-status]');
  const suggestion = form.querySelector('[data-suggestion]');
  const suggestionText = form.querySelector('[data-suggestion-text]');
  const useDraft = form.querySelector('[data-use-draft]');
  const access = form.querySelector('[data-voice-access]');
  const password = form.elements.voicePassword;
  const notes = form.elements.notes;
  const submit = form.querySelector('[type=submit]');
  let stream;
  let recorder;
  let recording;
  const lifetime = new AbortController();
  const active = () => !lifetime.signal.aborted && dialog.open && form.isConnected;
  const message = value => {
    status.hidden = !value;
    status.textContent = value;
  };
  const releaseMicrophone = () => {
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
  };
  function voiceSession() {
    if (dutySession) return dutySession;
    if (password?.value) return {member: '', password: password.value};
    message(access ? 'Wpisz wspólne hasło załogi, aby użyć raportu głosowego.' :
      'Zaloguj się ponownie do harmonogramu, aby użyć raportu głosowego.');
    password?.focus();
    return null;
  }
  dialog.addEventListener('close', () => {
    lifetime.abort();
    if (recorder?.state === 'recording') recorder.stop();
    releaseMicrophone();
  }, {once: true});

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.AudioContext || !window.OfflineAudioContext) {
    record.disabled = true;
    message('Nagrywanie jest niedostępne w tej przeglądarce. Wpisz raport w polu poniżej.');
    return;
  }

  record.onclick = async () => {
    if (submit.disabled || !voiceSession()) return;
    record.disabled = true;
    draft.disabled = true;
    submit.disabled = true;
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
        submit.disabled = false;
        if (failed || !parts.length) {
          message('Nie udało się nagrać dźwięku. Spróbuj ponownie.');
          return;
        }
        recording = new Blob(parts, {type: recorder.mimeType});
        record.textContent = 'Nagraj ponownie';
        void sendRecording();
      };
      recorder.start();
      recording = null;
      draft.hidden = true;
      suggestion.hidden = true;
      stop.hidden = false;
      message('Nagrywanie…');
      stop.focus();
    } catch {
      releaseMicrophone();
      if (active()) {
        record.disabled = false;
        draft.disabled = false;
        submit.disabled = false;
        message('Nie udało się uruchomić mikrofonu. Sprawdź uprawnienia w przeglądarce.');
      }
    }
  };
  stop.onclick = () => {
    if (recorder?.state !== 'recording') return;
    recorder.stop();
  };
  async function sendRecording() {
    if (!recording || submit.disabled) return;
    const session = voiceSession();
    if (!session) return;
    draft.disabled = true;
    record.disabled = true;
    submit.disabled = true;
    suggestion.hidden = true;
    message('NVIDIA przygotowuje szkic…');
    try {
      const result = await generateVoiceDraft(recording, lifetime.signal, session, message);
      if (!active()) return;
      if (access && !dutySession) {
        storeDutySession(session.password, session.member);
        password.value = '';
        access.hidden = true;
      }
      draft.hidden = true;
      if (notes.value.trim()) {
        suggestionText.textContent = result.notes;
        suggestion.hidden = false;
        message('Szkic AI jest gotowy. Możesz zastąpić nim wpisaną treść.');
        useDraft.focus();
      } else {
        fillReport(result.notes);
      }
    } catch (error) {
      if (!active()) return;
      draft.hidden = false;
      if (error.status === 401 && access) {
        clearDutySession();
        access.hidden = false;
        password.focus();
      }
      message(error instanceof DOMException ? 'Nie udało się odczytać nagrania.' : error.message);
    } finally {
      if (active()) {
        draft.disabled = false;
        record.disabled = false;
        submit.disabled = false;
      }
    }
  }
  function fillReport(text) {
    notes.value = text;
    notes.focus();
    suggestion.hidden = true;
    message('Szkic AI jest w treści raportu. Sprawdź go przed zapisem.');
  }
  draft.onclick = sendRecording;
  useDraft.onclick = () => fillReport(suggestionText.textContent);
}
