const SAMPLE_TEXT = `1조합 199무 276무 304무 413패 457패 (10,000원) (99.893배)
2조합 201무 286무 292패 320패 461승 (10,000원) (99.157배)
3조합 199무 276무 286무 304무 317승 413패 457패 458무 527승 596무 (2,000원) (13,069.382배)`;

const STORAGE_KEY = 'toto-slip-share-v13';
const BRAND_TEXT = 'PROTO TICKET';

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

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatWon(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${Number(value).toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}원`;
}

function normalizeTicketTitle(title) {
  const normalized = String(title || '').trim().replace(/승무식/g, '승부식');
  return normalized || '프로토 (승부식)';
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

function setStatus(message, type = 'ok') {
  if (!statusBox) return;
  if (!message) {
    statusBox.textContent = '';
    statusBox.className = 'status-box hidden';
    return;
  }
  statusBox.textContent = message;
  statusBox.className = type === 'ok' ? `status-box ${type} hidden` : `status-box ${type}`;
}

function loadSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    titleInput.value = normalizeTicketTitle(saved.title || '프로토 (승부식)');
    sourceText.value = typeof saved.text === 'string' && saved.text ? saved.text : SAMPLE_TEXT;
  } catch (error) {
    titleInput.value = '프로토 (승부식)';
    sourceText.value = SAMPLE_TEXT;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    title: normalizeTicketTitle(titleInput.value),
    text: sourceText.value
  }));
}

function splitEntriesSmart(source) {
  const text = normalizeText(source);
  if (!text) return [];

  const matches = [...text.matchAll(/(?:^|\n)\s*(\d+)\s*조합/g)];
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

function normalizePickSymbol(rawPick) {
  const raw = String(rawPick || '').trim();
  if (['승', '언더', '홀'].includes(raw)) return '승';
  if (['무', '①', '⑤'].includes(raw)) return '무';
  if (['패', '오바', '짝'].includes(raw)) return '패';
  return raw;
}

function extractPicks(text) {
  const regex = /(?:^|\s)(\d{1,4})\s*(승|무|패|①|⑤|언더|오바|홀|짝)(?=\s|$|\(|,)/g;
  return [...text.matchAll(regex)].map((match) => ({
    gameNo: String(match[1]).padStart(3, '0'),
    pick: normalizePickSymbol(match[2])
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
    const value = parseInt(match[1].replace(/,/g, ''), 10);
    candidates.push({ value, text: `${value.toLocaleString()}원`, score: 500, index: match.index ?? 0 });
  });

  [...text.matchAll(/([\d,]+)\s*원/g)].forEach((match) => {
    const value = parseInt(match[1].replace(/,/g, ''), 10);
    candidates.push({ value, text: `${value.toLocaleString()}원`, score: 400, index: match.index ?? 0 });
  });

  const best = pickBestCandidate(candidates);
  return best ? { value: best.value, text: best.text } : { value: null, text: '-' };
}

function extractOdds(text) {
  const candidates = [];
  const pushCandidate = (rawValue, score, index) => {
    const numeric = parseFloat(String(rawValue).replace(/,/g, ''));
    if (Number.isNaN(numeric)) return;
    candidates.push({ value: numeric, text: formatOddsLabel(rawValue), score, index: index ?? 0 });
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

function parseNumberValue(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/,/g, '').replace(/원|배/g, '').trim();
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function isDetailedEntry(rawEntry) {
  const text = normalizeText(rawEntry);
  return /(배팅금\s*,|총배당\s*,|예상적중금\s*,)/.test(text) || /\d+\s*,\s*[^,]+\s*,\s*[\d.]+\s*,\s*[^,]+\s*,\s*[^,]+\s*,\s*[^,]+\s*,/.test(text);
}

function parseMatchDescriptor(matchText, market = '') {
  const rawText = String(matchText || '').trim();
  const [leftRaw = '', rightRaw = ''] = rawText.split(/\s*:\s*/, 2);
  let home = leftRaw.trim();
  const away = rightRaw.trim();
  const marketText = String(market || '').trim();

  let flag = '';
  let bridge = ':';

  const handicapMatch = home.match(/^(.*)\s+H\s*([+-]?\d+(?:\.\d+)?)$/i);
  const totalMatch = home.match(/^(.*)\s+U\/O\s*([+-]?\d+(?:\.\d+)?)$/i);

  if (handicapMatch) {
    home = handicapMatch[1].trim();
    flag = 'H';
    bridge = `${handicapMatch[2]} :`;
  } else if (totalMatch) {
    home = totalMatch[1].trim();
    flag = 'U/O';
    bridge = `${totalMatch[2]} :`;
  } else if (/핸디캡/i.test(marketText)) {
    flag = 'H';
  } else if (/언더오버/i.test(marketText)) {
    flag = 'U/O';
  }

  return {
    flag,
    home: home || '-',
    away: away || '-',
    bridge,
    original: rawText
  };
}

function parseDetailedEntry(rawEntry, lineNo, fallbackComboNo, ordinal) {
  const text = normalizeText(rawEntry);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { ignored: true, reason: '빈 입력입니다.', raw: rawEntry, lineNo };

  const comboMatch = lines[0].match(/^(\d+)\s*조합$/);
  const comboNo = comboMatch ? comboMatch[1] : String(fallbackComboNo || lineNo);
  const detailRows = [];
  let amountValue = null;
  let oddsValue = null;
  let expectedValue = null;

  for (const line of lines.slice(comboMatch ? 1 : 0)) {
    if (!line) continue;

    const amountMatch = line.match(/^배팅금\s*,\s*(.+)$/i);
    if (amountMatch) {
      amountValue = parseNumberValue(amountMatch[1]);
      continue;
    }

    const oddsMatch = line.match(/^총배당\s*,\s*(.+)$/i);
    if (oddsMatch) {
      oddsValue = parseNumberValue(oddsMatch[1]);
      continue;
    }

    const expectedMatch = line.match(/^예상적중금\s*,\s*(.+)$/i);
    if (expectedMatch) {
      expectedValue = parseNumberValue(expectedMatch[1]);
      continue;
    }

    const parts = line.split(',');
    if (parts.length < 7) continue;

    const [gameNoRaw, pickRaw, oddsRaw, sportRaw, leagueRaw, marketRaw, ...matchParts] = parts;
    const gameNo = String(gameNoRaw || '').trim().padStart(3, '0');
    const pick = String(pickRaw || '').trim();
    const rowOddsValue = parseNumberValue(oddsRaw);
    const sport = String(sportRaw || '').trim();
    const league = String(leagueRaw || '').trim();
    const market = String(marketRaw || '').trim();
    const match = parseMatchDescriptor(matchParts.join(',').trim(), market);

    if (!gameNo || !pick) continue;

    detailRows.push({
      gameNo,
      pick,
      oddsValue: rowOddsValue,
      oddsText: rowOddsValue !== null ? rowOddsValue.toFixed(rowOddsValue % 1 === 0 ? 0 : 2).replace(/\.00$/, '') : '-',
      sport,
      league,
      market,
      ...match
    });
  }

  if (!detailRows.length) {
    return { ignored: true, reason: '상세 조합 행을 찾지 못했습니다.', raw: rawEntry, lineNo };
  }

  if (expectedValue === null && amountValue !== null && oddsValue !== null) {
    expectedValue = amountValue * oddsValue;
  }

  const uid = `ticket-${comboNo}-${ordinal}`;

  return {
    ignored: false,
    uid,
    comboNo,
    displayComboLabel: `${comboNo}조합`,
    mode: 'detailed',
    amountValue,
    amountText: amountValue !== null ? `${amountValue.toLocaleString('ko-KR')}원` : '-',
    oddsValue,
    oddsText: oddsValue !== null ? formatOddsLabel(String(oddsValue)) : '-',
    expectedValue,
    expectedText: expectedValue !== null
      ? formatWon(expectedValue, Number.isInteger(expectedValue) ? 0 : 2)
      : '-',
    detailRows,
    picks: detailRows.map((row) => ({ gameNo: row.gameNo, pick: row.pick })),
    raw: text,
    lineNo
  };
}

function parseEntrySmart(rawEntry, lineNo, fallbackComboNo, ordinal) {
  if (isDetailedEntry(rawEntry)) {
    return parseDetailedEntry(rawEntry, lineNo, fallbackComboNo, ordinal);
  }

  const text = normalizeText(rawEntry).replace(/\s+/g, ' ').trim();
  if (!text) return { ignored: true, reason: '빈 입력입니다.', raw: rawEntry, lineNo };

  const comboMatch = text.match(/(\d+)\s*조합(?:\s|$)/);
  const picks = extractPicks(text);
  const amount = extractAmount(text);
  const odds = extractOdds(text);
  const comboNo = comboMatch ? comboMatch[1] : String(fallbackComboNo || lineNo);

  if (!picks.length) {
    return { ignored: true, reason: '경기번호+선택 패턴을 찾지 못했습니다.', raw: text, lineNo };
  }

  const expectedNumber = amount.value && odds.value ? Math.round(amount.value * odds.value) : null;
  const uid = `ticket-${comboNo}-${ordinal}`;

  return {
    ignored: false,
    uid,
    comboNo,
    displayComboLabel: `${comboNo}조합`,
    mode: 'simple',
    amountText: amount.text,
    amountValue: amount.value,
    oddsText: odds.text,
    oddsValue: odds.value,
    expectedText: expectedNumber ? formatWon(expectedNumber) : '-',
    expectedValue: expectedNumber,
    picks,
    raw: text,
    lineNo
  };
}

function getSimpleTicketHeight(pickCount) {
  const safeCount = Math.max(1, Number(pickCount) || 0);
  return 340 + safeCount * 44;
}

function getDetailedTicketHeight(rowCount) {
  const safeCount = Math.max(1, Number(rowCount) || 0);
  return 460 + safeCount * 56;
}

function formatFilenameTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function createClassicPickRow(item) {
  return `
    <div class="score-row">
      <div class="score-row-game">*${escapeHtml(item.gameNo)}</div>
      <div class="score-row-pick">${escapeHtml(item.pick)}</div>
    </div>
  `;
}

function createRibbonStack() {
  return Array.from({ length: 6 }, () => `<span class="score-ribbon-text">${escapeHtml(BRAND_TEXT)}</span>`).join('');
}

function createSimpleTicket(combo) {
  const title = escapeHtml(normalizeTicketTitle(titleInput.value));
  const rows = combo.picks.map((pick) => createClassicPickRow(pick)).join('');
  const ticketHeight = getSimpleTicketHeight(combo.picks.length);

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

      <article id="${combo.uid}" class="ticket score-ticket" style="--ticket-height:${ticketHeight}px;">
        <div class="score-ribbon" aria-hidden="true">
          <div class="score-ribbon-stack">
            ${createRibbonStack()}
          </div>
        </div>

        <div class="score-layout">
          <div class="score-header">
            <div>
              <div class="score-top-brand">${escapeHtml(BRAND_TEXT)}</div>
              <div class="score-main-title">${title}</div>
              <div class="score-saved-at">저장일시 : ${escapeHtml(lastRenderedAt)}</div>
            </div>
            <div class="score-header-side">
              <div class="score-combo-no">${escapeHtml(combo.displayComboLabel)}</div>
              <div class="score-game-count">${combo.picks.length}경기 선택</div>
            </div>
          </div>

          <div class="score-divider"></div>

          <div class="score-content-grid simple-grid">
            <div class="score-table-wrap">
              <div class="score-table-head simple">
                <div>경기</div>
                <div>예상</div>
              </div>
              <div class="score-table-body">${rows}</div>
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

function createDetailedRow(row) {
  const flagText = row.flag || '';
  const flagClass = row.flag ? 'is-visible' : '';
  const bridgeText = row.bridge || ':';
  const pickClass = ['승', '패', '무', '①', '⑤', '언더', '오바'].includes(row.pick) ? `pick-${row.pick}` : '';

  return `
    <div class="score-detail-row">
      <div class="score-detail-flag ${flagClass}">${escapeHtml(flagText)}</div>
      <div class="score-detail-game">*${escapeHtml(row.gameNo)}</div>
      <div class="score-detail-home" title="${escapeHtml(row.home)}">${escapeHtml(row.home)}</div>
      <div class="score-detail-bridge">${escapeHtml(bridgeText)}</div>
      <div class="score-detail-away" title="${escapeHtml(row.away)}">${escapeHtml(row.away)}</div>
      <div class="score-detail-pick ${pickClass}">${escapeHtml(row.pick)}</div>
      <div class="score-detail-odds">${escapeHtml(row.oddsText)}</div>
    </div>
  `;
}

function createDetailedTicket(combo) {
  const title = escapeHtml(normalizeTicketTitle(titleInput.value));
  const rows = combo.detailRows.map((row) => createDetailedRow(row)).join('');
  const ticketHeight = getDetailedTicketHeight(combo.detailRows.length);

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

      <article id="${combo.uid}" class="ticket score-ticket score-ticket--detailed" style="--ticket-height:${ticketHeight}px;">
        <div class="score-ribbon" aria-hidden="true">
          <div class="score-ribbon-stack">
            ${createRibbonStack()}
          </div>
        </div>

        <div class="score-layout">
          <div class="score-header">
            <div>
              <div class="score-top-brand">${escapeHtml(BRAND_TEXT)}</div>
              <div class="score-main-title">${title}</div>
              <div class="score-saved-at">저장일시 : ${escapeHtml(lastRenderedAt)}</div>
            </div>
            <div class="score-header-side">
              <div class="score-combo-no">${escapeHtml(combo.displayComboLabel)}</div>
              <div class="score-game-count">${combo.detailRows.length}경기 선택</div>
            </div>
          </div>

          <div class="score-divider"></div>

          <div class="score-detail-table">
            <div class="score-detail-head">
              <div></div>
              <div>경기</div>
              <div>홈 팀</div>
              <div></div>
              <div>원정팀</div>
              <div>예상</div>
              <div>배당률</div>
            </div>
            <div class="score-detail-body">${rows}</div>
          </div>

          <div class="score-divider score-divider-bottom"></div>

          <div class="score-summary-block">
            <div class="score-summary-line">
              <span class="score-summary-label">예상 적중배당률</span>
              <span class="score-summary-colon">:</span>
              <strong class="score-summary-value">${escapeHtml(combo.oddsText)}</strong>
            </div>
            <div class="score-summary-line">
              <span class="score-summary-label">구입 금액</span>
              <span class="score-summary-colon">:</span>
              <strong class="score-summary-value">${escapeHtml(combo.amountText)}</strong>
            </div>
            <div class="score-summary-line is-total">
              <span class="score-summary-label">예상 적중금</span>
              <span class="score-summary-colon">:</span>
              <strong class="score-summary-value">${escapeHtml(combo.expectedText)}</strong>
            </div>
          </div>
        </div>
      </article>
    </section>
  `;
}

function createTicket(combo) {
  return combo.mode === 'detailed' ? createDetailedTicket(combo) : createSimpleTicket(combo);
}

function renderValidation(items) {
  if (!validationList) return;
  const visibleItems = items.filter((item) => item.type === 'error');
  if (!visibleItems.length) {
    validationList.innerHTML = '';
    validationList.className = 'validation-list hidden';
    return;
  }
  validationList.className = 'validation-list';
  validationList.innerHTML = visibleItems.map((item) => `
    <div class="validation-item ${item.type === 'error' ? 'error' : ''}">
      <strong>${escapeHtml(item.title)}</strong><br />${escapeHtml(item.message)}
    </div>
  `).join('');
}

function renderEmpty() {
  if (!ticketList) return;
  ticketList.innerHTML = `
    <section class="empty-state">
      <h3>슬립이 없습니다.</h3>
      <p>조합을 입력한 뒤 슬립 생성을 눌러주세요.</p>
    </section>
  `;
}

function renderTickets() {
  saveState();
  const normalizedTitle = normalizeTicketTitle(titleInput.value);
  titleInput.value = normalizedTitle;
  if (workspaceTitle) workspaceTitle.textContent = normalizedTitle;
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

  const validationItems = ignored.length
    ? ignored.map((item) => ({
        type: 'error',
        title: `${item.lineNo}번째 입력 제외`,
        message: `${item.reason} / 내용: ${item.raw}`
      }))
    : [{
        type: 'ok',
        title: '입력 검증 완료',
        message: '간단 조합 형식과 상세 CSV 형식을 모두 인식합니다.'
      }];

  renderValidation(validationItems);
  ticketList.innerHTML = combos.map(createTicket).join('');
  setStatus(`${combos.length}개 조합 생성 완료`, 'ok');
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
    link.download = `toto-slip-${comboNo}-${formatFilenameTimestamp(new Date())}.png`;
    link.click();
    setStatus('슬립 PNG를 저장했습니다.', 'ok');
  } catch (error) {
    setStatus(error.message || 'PNG 저장 중 오류가 발생했습니다.', 'error');
  }
}

window.copyTicket = copyTicket;
window.downloadTicket = downloadTicket;

renderBtn?.addEventListener('click', renderTickets);
sampleBtn?.addEventListener('click', () => {
  sourceText.value = SAMPLE_TEXT;
  renderTickets();
});
printBtn?.addEventListener('click', () => window.print());
clearBtn?.addEventListener('click', () => {
  sourceText.value = '';
  renderTickets();
});
titleInput?.addEventListener('input', () => {
  titleInput.value = normalizeTicketTitle(titleInput.value);
  renderTickets();
});
sourceText?.addEventListener('input', saveState);

loadSavedState();
renderTickets();
