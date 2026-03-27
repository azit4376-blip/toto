const SAMPLE_TEXT = `1조합
099무 104승 111패 (10,000원) (8.420배)

2조합
107무 119패 130패 159승 171무 (10,000원) (99.921배)

3조합
011패 061무 072무 077무 185패 203패 289무 305무 319무 344무 (2,000원) (47,287.015배)`;

const STORAGE_KEY = 'toto-slip-final-share-v5';
const MAX_OPTIMIZED_FOLDERS = 10;

const titleInput = document.getElementById('ticketTitle');
const sourceText = document.getElementById('sourceText');
const renderBtn = document.getElementById('renderBtn');
const sampleBtn = document.getElementById('sampleBtn');
const printBtn = document.getElementById('printBtn');
const clearBtn = document.getElementById('clearBtn');
const comboCountEl = document.getElementById('comboCount');
const ignoredCountEl = document.getElementById('ignoredCount');
const statusBox = document.getElementById('statusBox');
const validationList = document.getElementById('validationList');
const ticketList = document.getElementById('ticketList');
const workspaceTitle = document.getElementById('workspaceTitle');

let lastRenderedAt = '';

function loadSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const savedTitle = typeof saved.title === 'string' && saved.title ? saved.title : '프로토 (승부식)';
    titleInput.value = savedTitle.replace('승무식', '승부식');
    sourceText.value = typeof saved.text === 'string' && saved.text ? saved.text : SAMPLE_TEXT;
  } catch (error) {
    titleInput.value = '프로토 (승부식)';
    sourceText.value = SAMPLE_TEXT;
  }
}

function saveState() {
  const payload = { title: titleInput.value, text: sourceText.value };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function setStatus(message, type = 'ok') {
  if (!statusBox) return;
  statusBox.textContent = message;
  statusBox.className = `status-box ${type}`;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatWon(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${Number(value).toLocaleString()}원`;
}

function normalizeTicketTitle(title) {
  return String(title || '').replace(/승무식/g, '승부식').trim();
}

function formatTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatOddsLabel(raw) {
  const cleaned = String(raw ?? '').trim().replace(/,/g, '');
  if (!cleaned) return '-';

  const [intPart, decPart] = cleaned.split('.');
  const normalizedInt = Number(intPart || 0).toLocaleString('en-US');
  return decPart !== undefined && decPart !== '' ? `${normalizedInt}.${decPart}배` : `${normalizedInt}배`;
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function splitEntriesSmart(source) {
  const text = normalizeText(source);
  if (!text) return [];

  const matches = [...text.matchAll(/\d+\s*조합/g)];
  if (!matches.length) {
    return text
      .split(/\n\s*\n+/)
      .map((chunk, index) => ({ rawEntry: chunk.trim(), lineNo: index + 1 }))
      .filter((item) => item.rawEntry);
  }

  return matches
    .map((match, index) => {
      const start = match.index ?? 0;
      const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
      const rawEntry = text.slice(start, end).trim();
      const lineNo = text.slice(0, start).split('\n').length;
      return { rawEntry, lineNo };
    })
    .filter((item) => item.rawEntry);
}

function extractPicks(text) {
  const regex = /(?:^|\s)(\d{1,4})\s*(승|무|패)(?=\s|$|\(|,)/g;
  return [...text.matchAll(regex)].map((match) => ({
    gameNo: String(match[1]).padStart(3, '0'),
    pick: match[2]
  }));
}

function pickBestCandidate(candidates) {
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.index - a.index;
  });
  return candidates[0];
}

function extractAmount(text) {
  const candidates = [];

  [...text.matchAll(/\(\s*([\d,]+)\s*원\s*\)/g)].forEach((match) => {
    candidates.push({
      value: parseInt(match[1].replace(/,/g, ''), 10),
      text: `${Number(match[1].replace(/,/g, '')).toLocaleString()}원`,
      score: 500,
      index: match.index ?? 0
    });
  });

  [...text.matchAll(/([\d,]+)\s*원/g)].forEach((match) => {
    candidates.push({
      value: parseInt(match[1].replace(/,/g, ''), 10),
      text: `${Number(match[1].replace(/,/g, '')).toLocaleString()}원`,
      score: 400,
      index: match.index ?? 0
    });
  });

  [...text.matchAll(/\(\s*(\d+(?:\.\d+)?)\s*만원\s*\)/g)].forEach((match) => {
    const value = Math.round(parseFloat(match[1]) * 10000);
    candidates.push({ value, text: formatWon(value), score: 300, index: match.index ?? 0 });
  });

  [...text.matchAll(/(\d+(?:\.\d+)?)\s*만원/g)].forEach((match) => {
    const value = Math.round(parseFloat(match[1]) * 10000);
    candidates.push({ value, text: formatWon(value), score: 250, index: match.index ?? 0 });
  });

  [...text.matchAll(/(^|[^\d])(만원)(?=\s|$|\(|,)/g)].forEach((match) => {
    candidates.push({ value: 10000, text: '10,000원', score: 180, index: match.index ?? 0 });
  });

  const best = pickBestCandidate(candidates);
  return best ? { value: best.value, text: best.text } : { value: null, text: '-' };
}

function extractOdds(text) {
  const candidates = [];
  const pushCandidate = (rawValue, score, index) => {
    const numeric = parseFloat(String(rawValue).replace(/,/g, ''));
    if (Number.isNaN(numeric)) return;
    candidates.push({
      value: numeric,
      text: formatOddsLabel(rawValue),
      score,
      index: index ?? 0
    });
  };

  [...text.matchAll(/\(\s*([\d,]+(?:\.\d+)?)\s*배\s*\)/g)].forEach((match) => {
    pushCandidate(match[1], 500, match.index ?? 0);
  });

  [...text.matchAll(/([\d,]+(?:\.\d+)?)\s*배/g)].forEach((match) => {
    pushCandidate(match[1], 400, match.index ?? 0);
  });

  const best = pickBestCandidate(candidates);
  return best ? { value: best.value, text: best.text } : { value: null, text: '-' };
}

function parseEntrySmart(rawEntry, lineNo, fallbackComboNo, ordinal) {
  const text = normalizeText(rawEntry).replace(/\s+/g, ' ').trim();
  if (!text) return { ignored: true, reason: '빈 입력입니다.', raw: rawEntry, lineNo };

  const comboMatch = text.match(/(\d+)\s*조합(?:\s|$)/);
  const picks = extractPicks(text);
  const amount = extractAmount(text);
  const odds = extractOdds(text);
  const comboNo = comboMatch ? comboMatch[1] : String(fallbackComboNo || lineNo);

  if (!picks.length) {
    return { ignored: true, reason: '경기번호+승무패 패턴을 찾지 못했습니다.', raw: text, lineNo };
  }

  const expectedNumber = amount.value && odds.value ? Math.round(amount.value * odds.value) : null;
  const uid = `ticket-${comboNo}-${ordinal}`;

  return {
    ignored: false,
    uid,
    comboNo,
    displayComboLabel: `${comboNo}조합`,
    amountNumber: amount.value,
    amountText: amount.text,
    oddsNumber: odds.value,
    oddsText: odds.text,
    expectedNumber,
    expectedText: expectedNumber ? formatWon(expectedNumber) : '-',
    picks,
    raw: text,
    lineNo
  };
}

function getTicketDensityClass(pickCount) {
  if (pickCount >= 9) return 'ticket--compact';
  if (pickCount >= 7) return 'ticket--dense';
  return '';
}

function createClassicPickRow(item) {
  return `
    <div class="score-row">
      <div class="score-row-game">*${escapeHtml(item.gameNo)}</div>
      <div class="score-row-pick">${escapeHtml(item.pick)}</div>
    </div>
  `;
}

function createTicket(combo) {
  const normalizedTitle = normalizeTicketTitle(titleInput.value) || '프로토 (승부식)';
  const title = escapeHtml(normalizedTitle);
  const rows = combo.picks.map((pick) => createClassicPickRow(pick)).join('');
  const densityClass = getTicketDensityClass(combo.picks.length);

  return `
    <section class="ticket-shell">
      <div class="ticket-toolbar no-print">
        <div class="ticket-toolbar-left">
          <span class="ticket-badge">${escapeHtml(combo.displayComboLabel)}</span>
        </div>
        <div class="ticket-toolbar-actions">
          <button class="toolbar-btn primary" type="button" onclick="copyTicket('${combo.uid}')">슬립 복사</button>
          <button class="toolbar-btn secondary" type="button" onclick="downloadTicket('${combo.uid}', '${combo.comboNo}')">PNG 저장</button>
        </div>
      </div>

      <article id="${combo.uid}" class="ticket score-ticket ${densityClass}">
        <div class="score-ribbon" aria-hidden="true">
          <div class="score-ribbon-stack">
            <span class="score-ribbon-text">PROTO TICKET</span>
            <span class="score-ribbon-text">PROTO TICKET</span>
            <span class="score-ribbon-text">PROTO TICKET</span>
            <span class="score-ribbon-text">PROTO TICKET</span>
          </div>
        </div>

        <div class="score-brand">PROTO TICKET</div>

        <div class="score-layout">
          <div class="score-header">
            <div>
              <div class="score-main-title">${title}</div>
              <div class="score-saved-at">저장일시 : ${escapeHtml(lastRenderedAt)}</div>
            </div>
            <div class="score-header-side">
              <div class="score-combo-no">${escapeHtml(combo.displayComboLabel)}</div>
              <div class="score-game-count">${combo.picks.length}경기 선택</div>
            </div>
          </div>

          <div class="score-divider"></div>

          <div class="score-content-grid">
            <div class="score-table-wrap">
              <div class="score-table-head simple">
                <div>경기</div>
                <div>예상</div>
              </div>

              <div class="score-table-body">
                ${rows}
              </div>
            </div>

            <aside class="score-side-panel">
              <div class="score-side-card">
                <div class="score-side-row">
                  <span class="score-side-label">예상 적중배당률</span>
                  <strong class="score-side-value">${escapeHtml(combo.oddsText)}</strong>
                </div>
                <div class="score-side-row">
                  <span class="score-side-label">구입 금액</span>
                  <strong class="score-side-value">${escapeHtml(combo.amountText)}</strong>
                </div>
              </div>

              <div class="score-side-total-card">
                <span class="score-side-total-label">예상 적중금</span>
                <strong class="score-side-total-value">${escapeHtml(combo.expectedText)}</strong>
              </div>
            </aside>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderValidation(items) {
  if (!validationList) return;
  validationList.innerHTML = items.map((item) => `
    <div class="validation-item ${item.type === 'error' ? 'error' : ''}">
      <strong>${escapeHtml(item.title)}</strong><br />${escapeHtml(item.message)}
    </div>
  `).join('');
}

function renderEmpty() {
  ticketList.innerHTML = `
    <section class="empty-state">
      <h3>슬립이 없습니다.</h3>
      <p>조합을 입력한 뒤 슬립 생성을 눌러주세요.</p>
    </section>
  `;
}

function renderTickets() {
  saveState();
  const normalizedTitle = normalizeTicketTitle(titleInput.value) || '프로토 (승부식)';
  if (titleInput.value !== normalizedTitle) {
    titleInput.value = normalizedTitle;
  }
  if (workspaceTitle) {
    workspaceTitle.textContent = normalizedTitle;
  }
  lastRenderedAt = formatTimestamp(new Date());

  const entries = splitEntriesSmart(sourceText.value);
  const parsed = entries.map((entry, idx) => parseEntrySmart(entry.rawEntry, entry.lineNo, idx + 1, idx + 1));
  const combos = parsed.filter((item) => !item.ignored);
  const ignored = parsed.filter((item) => item.ignored);

  if (comboCountEl) comboCountEl.textContent = String(combos.length);
  if (ignoredCountEl) ignoredCountEl.textContent = String(ignored.length);

  if (!combos.length) {
    renderValidation([{ type: 'error', title: '입력 인식 실패', message: '정상적으로 파싱된 조합이 없습니다. 입력 형식을 확인해주세요.' }]);
    renderEmpty();
    setStatus('정상적으로 파싱된 조합이 없습니다. 입력 형식을 확인해주세요.', 'warn');
    return;
  }

  const validationItems = [];
  if (ignored.length) {
    ignored.forEach((item) => {
      validationItems.push({
        type: 'error',
        title: `${item.lineNo}번째 입력 제외`,
        message: `${item.reason} / 내용: ${item.raw}`
      });
    });
  } else {
    validationItems.push({
      type: 'ok',
      title: '입력 검증 완료',
      message: '콤마가 포함된 배당도 정상 인식합니다.'
    });
  }

  renderValidation(validationItems);
  ticketList.innerHTML = combos.map(createTicket).join('');

  const hasDenseCombo = combos.some((combo) => combo.picks.length > MAX_OPTIMIZED_FOLDERS);
  if (hasDenseCombo) {
    setStatus(`${combos.length}개 조합 생성 완료`, 'warn');
  } else {
    setStatus(`${combos.length}개 조합 생성 완료`, 'ok');
  }
}

async function elementToCanvas(element) {
  return html2canvas(element, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
    logging: false
  });
}

async function copyTicket(uid) {
  try {
    const target = document.getElementById(uid);
    if (!target) throw new Error('복사할 슬립을 찾지 못했습니다.');

    const canvas = await elementToCanvas(target);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('이미지 생성에 실패했습니다.');

    if (!navigator.clipboard || !window.ClipboardItem) {
      throw new Error('현재 브라우저는 이미지 클립보드 복사를 지원하지 않습니다. PNG 저장을 사용해주세요.');
    }

    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    setStatus('슬립 이미지를 클립보드에 복사했습니다.', 'ok');
  } catch (error) {
    setStatus(error.message || '슬립 복사 중 오류가 발생했습니다.', 'error');
  }
}

async function downloadTicket(uid, comboNo) {
  try {
    const target = document.getElementById(uid);
    if (!target) throw new Error('저장할 슬립을 찾지 못했습니다.');

    const canvas = await elementToCanvas(target);
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `toto-slip-${comboNo}.png`;
    link.click();
    setStatus('슬립 PNG를 저장했습니다.', 'ok');
  } catch (error) {
    setStatus(error.message || 'PNG 저장 중 오류가 발생했습니다.', 'error');
  }
}

window.copyTicket = copyTicket;
window.downloadTicket = downloadTicket;

renderBtn.addEventListener('click', renderTickets);
sampleBtn.addEventListener('click', () => {
  sourceText.value = SAMPLE_TEXT;
  renderTickets();
});
printBtn.addEventListener('click', () => window.print());
clearBtn.addEventListener('click', () => {
  sourceText.value = '';
  renderTickets();
});
titleInput.addEventListener('input', () => {
  const normalized = normalizeTicketTitle(titleInput.value);
  if (normalized !== titleInput.value) {
    titleInput.value = normalized;
  }
  renderTickets();
});
sourceText.addEventListener('input', saveState);

loadSavedState();
renderTickets();
