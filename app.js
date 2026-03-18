const SAMPLE_TEXT = `1조합 099무 104승 111패 122무 148승 (10,000원) (99.464배)
2조합 107무 119패 130패 159승 171무 (10,000원) (99.921배)`;

const STORAGE_KEY = 'toto-slip-final-share-v1';

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

function loadSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    titleInput.value = typeof saved.title === 'string' && saved.title ? saved.title : '토토 슬립';
    sourceText.value = typeof saved.text === 'string' && saved.text ? saved.text : SAMPLE_TEXT;
  } catch (error) {
    titleInput.value = '토토 슬립';
    sourceText.value = SAMPLE_TEXT;
  }
}

function saveState() {
  const payload = {
    title: titleInput.value,
    text: sourceText.value
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function setStatus(message, type = 'ok') {
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

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
    const rawEntry = text.slice(start, end).trim();
    const lineNo = text.slice(0, start).split('\n').length;
    return { rawEntry, lineNo };
  }).filter((item) => item.rawEntry);
}

function extractPicks(text) {
  const regex = /(?:^|\s)(\d{2,4})\s*(승|무|패)(?=\s|$|\(|,)/g;
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
    candidates.push({
      value,
      text: formatWon(value),
      score: 300,
      index: match.index ?? 0
    });
  });

  [...text.matchAll(/(\d+(?:\.\d+)?)\s*만원/g)].forEach((match) => {
    const value = Math.round(parseFloat(match[1]) * 10000);
    candidates.push({
      value,
      text: formatWon(value),
      score: 250,
      index: match.index ?? 0
    });
  });

  [...text.matchAll(/(^|[^\d])(만원)(?=\s|$|\(|,)/g)].forEach((match) => {
    candidates.push({
      value: 10000,
      text: '10,000원',
      score: 180,
      index: match.index ?? 0
    });
  });

  const best = pickBestCandidate(candidates);
  return best ? { value: best.value, text: best.text } : { value: null, text: '-' };
}

function extractOdds(text) {
  const candidates = [];

  [...text.matchAll(/\(\s*(\d+(?:\.\d+)?)\s*배\s*\)/g)].forEach((match) => {
    candidates.push({
      value: parseFloat(match[1]),
      text: `${match[1]}배`,
      score: 500,
      index: match.index ?? 0
    });
  });

  [...text.matchAll(/(\d+\.\d+)\s*배/g)].forEach((match) => {
    candidates.push({
      value: parseFloat(match[1]),
      text: `${match[1]}배`,
      score: 400,
      index: match.index ?? 0
    });
  });

  [...text.matchAll(/(\d+)\s*배/g)].forEach((match) => {
    candidates.push({
      value: parseFloat(match[1]),
      text: `${match[1]}배`,
      score: 300,
      index: match.index ?? 0
    });
  });

  const best = pickBestCandidate(candidates);
  return best ? { value: best.value, text: best.text } : { value: null, text: '-' };
}

function parseEntrySmart(rawEntry, lineNo, fallbackComboNo, ordinal) {
  const text = normalizeText(rawEntry).replace(/\s+/g, ' ').trim();
  if (!text) {
    return { ignored: true, reason: '빈 입력입니다.', raw: rawEntry, lineNo };
  }

  const comboMatch = text.match(/(\d+)\s*조합(?:\s|$)/);
  const picks = extractPicks(text);
  const amount = extractAmount(text);
  const odds = extractOdds(text);
  const comboNo = comboMatch ? comboMatch[1] : String(fallbackComboNo || lineNo);

  if (!picks.length) {
    return {
      ignored: true,
      reason: '경기번호+승무패 패턴을 찾지 못했습니다.',
      raw: text,
      lineNo
    };
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

function createMark(label, active, isEmpty) {
  const cls = ['mark'];
  if (active) cls.push('active');
  if (isEmpty) cls.push('empty');
  return `<div class="${cls.join(' ')}">${label}</div>`;
}

function createCheck(active) {
  return `<div class="check-mark ${active ? 'active' : ''}">${active ? '✓' : ''}</div>`;
}

function createPickRow(item) {
  const isEmpty = !item;
  const gameNo = item ? escapeHtml(item.gameNo) : '---';
  const pick = item ? item.pick : '';

  return `
    <div class="pick-row">
      <div class="game-no">${gameNo}</div>
      ${createMark('승', pick === '승', isEmpty)}
      ${createMark('무', pick === '무', isEmpty)}
      ${createMark('패', pick === '패', isEmpty)}
      ${createCheck(Boolean(item))}
    </div>
  `;
}

function createTicket(combo) {
  const title = escapeHtml(titleInput.value.trim() || '토토 슬립');
  const rows = Array.from({ length: 5 }, (_, idx) => createPickRow(combo.picks[idx])).join('');
  const firstGame = combo.picks[0]?.gameNo || '-';
  const lastGame = combo.picks[combo.picks.length - 1]?.gameNo || '-';

  return `
    <section class="ticket-shell">
      <div class="ticket-toolbar no-print">
        <div class="ticket-toolbar-left">
          <span class="ticket-badge">${escapeHtml(combo.displayComboLabel)}</span>
          <span class="ticket-toolbar-note">공유용 티켓 이미지로 복사하거나 저장할 수 있습니다.</span>
        </div>
        <div class="ticket-toolbar-actions">
          <button class="toolbar-btn primary" type="button" onclick="copyTicket('${combo.uid}')">슬립 복사</button>
          <button class="toolbar-btn secondary" type="button" onclick="downloadTicket('${combo.uid}', '${combo.comboNo}')">PNG 저장</button>
        </div>
      </div>

      <article id="${combo.uid}" class="ticket">
        <div class="ticket-topbar"></div>
        <div class="ticket-head">
          <div class="ticket-title-block">
            <div class="ticket-eyebrow">${title}</div>
            <div class="ticket-title">${escapeHtml(combo.displayComboLabel)}</div>
          </div>
          <div class="ticket-odds">
            <div class="ticket-odds-label">배당</div>
            <div class="ticket-odds-value">${escapeHtml(combo.oddsText)}</div>
          </div>
        </div>

        <div class="ticket-summary">
          <div class="summary-card">
            <div class="summary-card-label">배팅금</div>
            <div class="summary-card-value">${escapeHtml(combo.amountText)}</div>
          </div>
          <div class="summary-card">
            <div class="summary-card-label">예상금</div>
            <div class="summary-card-value">${escapeHtml(combo.expectedText)}</div>
          </div>
          <div class="summary-card">
            <div class="summary-card-label">픽 수</div>
            <div class="summary-card-value">${combo.picks.length}개</div>
          </div>
        </div>

        <div class="pick-table">
          <div class="pick-head">
            <div>경기번호</div>
            <div style="text-align:center;">승</div>
            <div style="text-align:center;">무</div>
            <div style="text-align:center;">패</div>
            <div style="text-align:center;">체크</div>
          </div>
          ${rows}
        </div>

        <div class="ticket-footer">
          <div class="footer-box">
            <span><strong>${escapeHtml(combo.displayComboLabel)}</strong> · ${combo.picks.length}폴더</span>
            <span>${escapeHtml(firstGame)} ~ ${escapeHtml(lastGame)}</span>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderValidation(items) {
  validationList.innerHTML = items.map((item) => `
    <div class="validation-item ${item.type === 'error' ? 'error' : ''}">
      <strong>${escapeHtml(item.title)}</strong><br />${escapeHtml(item.message)}
    </div>
  `).join('');
}

function renderEmpty() {
  ticketList.innerHTML = `
    <section class="empty-state">
      <h3>표시할 슬립이 없습니다.</h3>
      <p>한 줄 입력, 조합번호 다음 줄 입력, 1만원 / 10,000원 / 99배 / 99.99배 / (99.90배) 같은 형식을 폭넓게 인식합니다.</p>
    </section>
  `;
}

function renderTickets() {
  saveState();
  workspaceTitle.textContent = titleInput.value.trim() || '토토 슬립';

  const entries = splitEntriesSmart(sourceText.value);
  const parsed = entries.map((entry, idx) => parseEntrySmart(entry.rawEntry, entry.lineNo, idx + 1, idx + 1));
  const combos = parsed.filter((item) => !item.ignored);
  const ignored = parsed.filter((item) => item.ignored);

  comboCountEl.textContent = String(combos.length);
  ignoredCountEl.textContent = String(ignored.length);

  if (!combos.length) {
    renderValidation([{ type: 'error', title: '입력 인식 실패', message: '정상적으로 파싱된 조합이 없습니다. 입력 형식을 확인해주세요.' }]);
    renderEmpty();
    setStatus('정상적으로 파싱된 조합이 없습니다. 입력 형식을 확인해주세요.', 'warn');
    return;
  }

  const validationItems = ignored.length
    ? ignored.map((item) => ({
        type: 'error',
        title: `${item.lineNo}번째 입력 제외`,
        message: `${item.reason} / 내용: ${item.raw}`
      }))
    : [{
        type: 'ok',
        title: '입력 검증 완료',
        message: '조합을 정상적으로 인식했습니다. 같은 조합 번호가 반복되어도 순서대로 슬립이 생성됩니다.'
      }];

  renderValidation(validationItems);
  ticketList.innerHTML = combos.map(createTicket).join('');
  setStatus(`${combos.length}개 조합을 슬립 형태로 생성했습니다.`, 'ok');
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
titleInput.addEventListener('input', renderTickets);
sourceText.addEventListener('input', saveState);

loadSavedState();
renderTickets();
