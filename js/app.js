(() => {
  'use strict';

  const app = document.getElementById('app');
  const dialogEl = document.getElementById('dialog');

  // ---- DOM ヘルパー（文字列は textContent で入れるので HTML エスケープ不要） ----

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  // ---- 日付 ----

  const pad = n => String(n).padStart(2, '0');
  const toDateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toTimeStr = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  // 'YYYY-MM-DD' + 'HH:MM' → 'YYYY/MM/DD HH:MM'
  const formatDateTime = (date, time) => `${date.replace(/-/g, '/')} ${time}`;

  // 今日 / 昨日 / YYYY/MM/DD
  function formatDay(date) {
    const d = new Date();
    if (date === toDateStr(d)) return '今日';
    d.setDate(d.getDate() - 1);
    if (date === toDateStr(d)) return '昨日';
    return date.replace(/-/g, '/');
  }

  // 何日前か（今日・昨日は formatDay で表すので null）。未来の日付は「N日後」
  function daysAgo(date) {
    const [y, m, d] = date.split('-').map(Number);
    const now = new Date();
    const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(y, m - 1, d)) / 86400000);
    if (diff >= 2) return `${diff}日前`;
    if (diff < 0) return `${-diff}日後`;
    return null;
  }

  // 'YYYY-MM-DD' → 'YYYY年M月D日'
  function formatDayLong(date) {
    const [y, m, d] = date.split('-').map(Number);
    return `${y}年${m}月${d}日`;
  }

  const categoryHref = id => '#/category/' + encodeURIComponent(id);
  const dayHref = (id, date) => `#/day/${encodeURIComponent(id)}/${date}`;
  const recordHref = id => '#/record/' + encodeURIComponent(id);

  // ---- ダイアログ ----

  // 表示中ダイアログを value で閉じる。close イベントは非表示タブ等で遅れることがあるので直接 resolve する
  let finishDialog = () => {};

  // buttons: [{ label, value, style, autofocus }]。押されたボタンの value を返す（閉じただけなら ''）
  function showDialog({ title, message, content, buttons }) {
    return new Promise(resolve => {
      // novalidate：日付を空にしたときもキャンセルで閉じられるように（入力チェックは各ダイアログで行う）
      // 開いたとき日付欄に自動でフォーカスすると、iPhone でカレンダーが勝手に開くので、
      // ボタンに autofocus がなければダイアログ本体にフォーカスする（入力欄は押したときだけ開く）
      const focusSelf = !buttons.some(b => b.autofocus);
      const form = h('form', { method: 'dialog', class: 'dlg', novalidate: true, tabindex: focusSelf ? '-1' : null, autofocus: focusSelf },
        title && h('h2', { class: 'dlg-title' }, title),
        message && h('p', { class: 'dlg-msg' }, message),
        content,
        h('div', { class: 'dlg-buttons' + (buttons.length > 2 ? ' vertical' : '') },
          buttons.map(b => h('button', {
            type: 'submit',
            value: b.value,
            class: 'btn ' + (b.style || ''),
            autofocus: b.autofocus,
          }, b.label))
        )
      );
      finishDialog = value => {
        finishDialog = () => {};
        dialogEl.oncancel = null;
        if (dialogEl.open) dialogEl.close();
        resolve(value);
      };
      form.addEventListener('submit', e => {
        e.preventDefault();
        finishDialog(e.submitter ? e.submitter.value : '');
      });
      dialogEl.oncancel = e => {
        e.preventDefault();
        finishDialog('');
      };
      dialogEl.replaceChildren(form);
      dialogEl.showModal();
    });
  }

  // 名前の入力ダイアログ（カテゴリ名・家族の名前）。OK なら { action: 'ok', name }、それ以外は { action }
  async function promptName({ title, value = '', okLabel, extraButtons = [], label = 'カテゴリ名', placeholder = '例：掃除' }) {
    const input = h('input', {
      type: 'text',
      class: 'input',
      maxlength: '100',
      placeholder,
      autocomplete: 'off',
      enterkeyhint: 'done',
    });
    input.value = value;

    const buttons = [
      { label: okLabel, value: 'ok', style: 'primary' },
      ...extraButtons,
      { label: 'キャンセル', value: 'cancel' },
    ];
    const p = showDialog({
      title,
      content: h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input),
      buttons,
    });

    const okBtn = dialogEl.querySelector('button[value="ok"]');
    const sync = () => { okBtn.disabled = !input.value.trim(); };
    sync();
    input.addEventListener('input', sync);
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      // 日本語変換の確定 Enter では閉じない（Safari は keyCode 229）
      if (e.isComposing || e.keyCode === 229) return;
      if (input.value.trim()) finishDialog('ok');
    });
    input.focus();

    const action = await p;
    const name = input.value.trim();
    if (action === 'ok' && name) return { action, name };
    return { action: action === 'ok' ? 'cancel' : action };
  }

  // ---- 並び順（表示設定） ----

  const SORT_KEY = 'nanishita.sort';
  const SORT_MODES = [
    ['updated', '更新した順（記録・名前変更したものが上、記録なしは一番下）'],
    ['recent', '最後に記録した日が新しい順'],
    ['oldest', '最後に記録した日が古い順'],
    ['name', 'カテゴリ名順'],
    ['manual', '自分で並べ替えた順'],
  ];

  // 並び順の選択は端末ごとの好みなので localStorage に保存（使えない環境では初期設定のまま）
  function getSortMode() {
    try {
      const v = localStorage.getItem(SORT_KEY);
      if (SORT_MODES.some(([k]) => k === v)) return v;
    } catch {}
    return 'updated';
  }

  function setSortMode(v) {
    try { localStorage.setItem(SORT_KEY, v); } catch {}
  }

  // cats は sortOrder 順で渡される。記録がないカテゴリは日付順のとき末尾（追加順）
  // touched：カテゴリIDごとの記録を最後に追加・編集した時刻（'updated' のときだけ使う）
  function sortCategories(cats, last, mode, touched) {
    if (mode === 'manual') return cats;
    if (mode === 'updated') {
      // 記録があるカテゴリは、名前変更（updatedAt）と記録の追加・編集のうち新しいほう。
      // 記録がないカテゴリは一番下にまとめ、その中は追加・名前変更が新しい順
      const t = c => Math.max(c.createdAt || 0, c.updatedAt || 0, touched[c.id] || 0);
      return cats.sort((a, b) => {
        const ha = a.id in touched, hb = b.id in touched;
        if (ha !== hb) return ha ? -1 : 1;
        return t(b) - t(a);
      });
    }
    if (mode === 'name') return cats.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    const dir = mode === 'oldest' ? 1 : -1;
    return cats.sort((a, b) => {
      const la = last[a.id], lb = last[b.id];
      if (la && lb) return dir * (la.datetime - lb.datetime);
      if (la || lb) return la ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    });
  }

  // ---- 画面: カテゴリ一覧 ----

  async function renderCategories() {
    const mode = getSortMode();
    const [cats, last, touched] = await Promise.all([
      DB.listCategories(),
      DB.getLastRecords(),
      mode === 'updated' ? DB.getRecordTouchedTimes() : {},
    ]);

    sortCategories(cats, last, mode, touched);

    const list = cats.length
      ? h('ul', { class: 'cat-list' }, cats.map(c => {
          const r = last[c.id];
          const ago = r && daysAgo(r.date);
          return h('li', { class: 'cat-row' },
            h('a', { href: categoryHref(c.id), class: 'cat-item' },
              h('span', { class: 'cat-name' }, c.name)
            ),
            r
              ? h('a', { href: dayHref(c.id, r.date), class: 'cat-last', 'aria-label': `最後：${formatDay(r.date)}${ago ? '、' + ago : ''}（その日の詳細）` },
                  h('span', { class: 'cat-last-pill' + (r.date === toDateStr(new Date()) ? ' today' : '') },
                    h('span', { class: 'cat-last-label' }, '最後'),
                    h('span', { class: 'cat-last-date' }, formatDay(r.date)),
                    ago && h('span', { class: 'cat-last-ago' }, ago)
                  )
                )
              : h('a', { href: categoryHref(c.id), class: 'cat-last none' }, '記録なし')
          );
        }))
      : h('p', { class: 'empty' }, 'まだカテゴリがありません。', h('br'), '下のボタンから追加してください。');

    app.replaceChildren(
      h('header', { class: 'page-header' }, h('h1', null, 'いつやった？')),
      list,
      h('button', { type: 'button', class: 'btn add-btn', onclick: addCategory }, '＋ カテゴリを追加')
    );
  }

  async function addCategory() {
    const r = await promptName({ title: 'カテゴリを追加', okLabel: '追加' });
    if (r.action !== 'ok') return;
    await DB.addCategory(r.name);
    route();
  }

  // ---- 画面: カテゴリ詳細 ----

  async function renderCategory(id) {
    const c = await DB.getCategory(id);
    if (!c || c.deletedAt) {
      location.hash = '#/';
      return;
    }
    const records = await DB.getRecordsOfCategory(c.id);
    const r = records[0];

    app.replaceChildren(
      h('header', { class: 'page-header nav' },
        h('a', { href: '#/', class: 'back' }, '‹ ホーム'),
        h('button', { type: 'button', class: 'link-btn', onclick: () => editCategory(c) }, '名前の変更・削除')
      ),
      h('h1', { class: 'cat-title' }, c.name),
      h('div', { class: 'last-box' + (r && r.date === toDateStr(new Date()) ? ' today' : '') },
        h('div', { class: 'last-box-label' }, '最終日'),
        r
          ? h('a', { href: dayHref(c.id, r.date), class: 'last-box-date' }, formatDay(r.date))
          : h('div', { class: 'last-box-date none' }, 'まだ記録がありません'),
        r && daysAgo(r.date) && h('div', { class: 'last-box-ago' }, daysAgo(r.date))
      ),
      h('button', { type: 'button', class: 'btn primary big', onclick: e => recordNow(c, e.currentTarget) }, '今日'),
      h('button', { type: 'button', class: 'btn sub-btn', onclick: () => recordWithDetails(c) }, '＋ 記録（日時・メモを指定）'),
      h('p', { id: 'status', class: 'status', role: 'status' }),
      renderHistoryOfCategory(records)
    );
  }

  // 月ごとの見出しを付けた履歴（records は新しい順）
  function renderHistoryOfCategory(records) {
    const section = h('section', { class: 'history' },
      h('h2', { class: 'section-title' }, '履歴', h('span', { class: 'count' }, `${records.length}件`))
    );
    if (!records.length) {
      section.append(h('p', { class: 'note' }, '「今日」を押すと、ここに履歴がたまっていきます。'));
      return section;
    }

    let month = null;
    let list = null;
    for (const r of records) {
      const [y, m, d] = r.date.split('-').map(Number);
      const key = r.date.slice(0, 7);
      if (key !== month) {
        month = key;
        list = h('ul', { class: 'hist-list' });
        section.append(h('h3', { class: 'month' }, `${y}年${m}月`), list);
      }
      list.append(h('li', null, h('a', { href: recordHref(r.id), class: 'hist-item' },
        h('div', { class: 'hist-date' }, `${m}/${d}`),
        h('div', { class: 'hist-body' },
          h('div', { class: 'hist-time' }, r.time),
          r.memo && h('div', { class: 'hist-memo' }, r.memo)
        ),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')
      )));
    }
    return section;
  }

  // 記録後は「最終日」を更新するため画面を描き直してからメッセージを出す
  async function afterRecord(record) {
    await route();
    const el = document.getElementById('status');
    if (el) el.textContent = `記録しました：${formatDateTime(record.date, record.time)}`;
  }

  // 最短操作：現在日時でそのまま記録
  async function recordNow(c, btn) {
    btn.disabled = true; // 連打による二重記録を防ぐ（描き直し後のボタンも少しの間押せなくする）
    const now = new Date();
    await afterRecord(await DB.addRecord(c.id, { date: toDateStr(now), time: toTimeStr(now) }));
    const newBtn = document.querySelector('.btn.big');
    if (newBtn) {
      newBtn.disabled = true;
      setTimeout(() => { newBtn.disabled = false; }, 800);
    }
  }

  // 日付・時刻・メモの入力ダイアログ（追加・編集で共通）。OK なら { date, time, memo }、それ以外は null
  async function recordForm({ title, date, time, memo = '', okLabel }) {
    const dateIn = h('input', { type: 'date', class: 'input', required: true, value: date });
    const timeIn = h('input', { type: 'time', class: 'input', required: true, value: time });
    const memoIn = h('textarea', { class: 'input memo', rows: '3', maxlength: '1000', placeholder: '例：リビングと寝室を掃除' });
    memoIn.value = memo;

    const p = showDialog({
      title,
      content: h('div', { class: 'fields' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, '日付'), dateIn),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, '時刻'), timeIn),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'メモ（なくてもOK）'), memoIn)
      ),
      buttons: [
        { label: okLabel, value: 'ok', style: 'primary' },
        { label: 'キャンセル', value: 'cancel' },
      ],
    });

    const okBtn = dialogEl.querySelector('button[value="ok"]');
    const sync = () => { okBtn.disabled = !dateIn.value || !timeIn.value; };
    dateIn.addEventListener('input', sync);
    timeIn.addEventListener('input', sync);

    if (await p !== 'ok' || !dateIn.value || !timeIn.value) return null;
    return { date: dateIn.value, time: timeIn.value, memo: memoIn.value.trim() };
  }

  // 日付・時刻・メモを指定して記録（初期値は現在日時）
  async function recordWithDetails(c) {
    const now = new Date();
    const values = await recordForm({
      title: c.name,
      date: toDateStr(now),
      time: toTimeStr(now),
      okLabel: '記録する',
    });
    if (values) await afterRecord(await DB.addRecord(c.id, values));
  }

  async function editCategory(c) {
    const r = await promptName({
      title: 'カテゴリ名の変更',
      value: c.name,
      okLabel: '保存',
      extraButtons: [{ label: 'このカテゴリを削除', value: 'delete', style: 'danger-outline' }],
    });
    if (r.action === 'ok') {
      await DB.renameCategory(c.id, r.name);
      route();
    } else if (r.action === 'delete') {
      await confirmDelete(c);
    }
  }

  async function confirmDelete(c) {
    const count = await DB.countRecords(c.id);
    const buttons = count
      ? [
          { label: 'カテゴリと履歴を削除', value: 'all', style: 'danger' },
          { label: 'カテゴリだけ削除（履歴は残す）', value: 'only', style: 'danger-outline' },
          { label: 'キャンセル', value: 'cancel', autofocus: true },
        ]
      : [
          { label: 'キャンセル', value: 'cancel', autofocus: true },
          { label: '削除', value: 'all', style: 'danger' },
        ];
    const action = await showDialog({
      title: `「${c.name}」を削除しますか？`,
      message: count
        ? `このカテゴリには ${count} 件の記録があります。`
        : 'このカテゴリには記録がありません。',
      buttons,
    });
    if (action !== 'all' && action !== 'only') return;
    await DB.deleteCategory(c.id, action === 'all');
    location.hash = '#/';
  }

  // ---- 画面: 日付詳細（あるカテゴリのある日の記録） ----

  async function renderDay(categoryId, date) {
    const [c, records] = await Promise.all([
      DB.getCategory(categoryId),
      DB.getRecordsOfDay(categoryId, date),
    ]);
    if (!c) {
      location.hash = '#/';
      return;
    }

    app.replaceChildren(
      h('header', { class: 'page-header nav' },
        h('a', { href: categoryHref(c.id), class: 'back', onclick: goBack }, '‹ 戻る')
      ),
      h('h1', { class: 'day-title' }, formatDayLong(date)),
      h('h2', { class: 'day-cat' }, c.name),
      records.length
        ? h('ul', { class: 'day-list' }, records.map(r =>
            h('li', null, h('a', { href: recordHref(r.id), class: 'day-item' },
              h('div', { class: 'day-body' },
                h('div', { class: 'day-time' }, r.time),
                h('div', { class: 'day-memo' + (r.memo ? '' : ' none') }, r.memo || '記録済み')
              ),
              h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')
            ))
          ))
        : h('p', { class: 'note' }, 'この日の記録はありません。')
    );
  }

  // ---- 画面: 記録詳細（編集・削除） ----

  async function renderRecord(id) {
    const r = await DB.getRecord(id);
    if (!r) {
      location.hash = '#/';
      return;
    }
    const c = await DB.getCategory(r.categoryId);

    app.replaceChildren(
      h('header', { class: 'page-header nav' },
        h('a', { href: c && !c.deletedAt ? categoryHref(c.id) : '#/history', class: 'back', onclick: goBack }, '‹ 戻る')
      ),
      h('div', { class: 'record-card' },
        h('div', { class: 'record-date' }, r.date.replace(/-/g, '/')),
        h('div', { class: 'record-cat' }, c ? c.name : '（不明なカテゴリ）',
          c && c.deletedAt && h('span', { class: 'deleted' }, '削除済み')),
        h('div', { class: 'record-time' }, r.time),
        h('div', { class: 'record-memo' + (r.memo ? '' : ' none') }, r.memo || 'メモなし')
      ),
      h('div', { class: 'record-actions' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => editRecord(r, c) }, '日時・メモを編集'),
        h('button', { type: 'button', class: 'btn danger-outline', onclick: () => deleteRecord(r, c) }, 'この記録を削除')
      )
    );
  }

  async function editRecord(r, c) {
    const values = await recordForm({
      title: '記録を編集',
      date: r.date,
      time: r.time,
      memo: r.memo,
      okLabel: '保存',
    });
    if (!values) return;
    await DB.updateRecord(r.id, values);
    route();
  }

  async function deleteRecord(r, c) {
    const action = await showDialog({
      title: 'この記録を削除しますか？',
      message: `${c ? c.name : ''}　${formatDateTime(r.date, r.time)}`,
      buttons: [
        { label: 'キャンセル', value: 'cancel', autofocus: true },
        { label: '削除', value: 'delete', style: 'danger' },
      ],
    });
    if (action !== 'delete') return;
    await DB.deleteRecord(r.id);
    // 記録が消えたので、来た画面（描き直される）へ戻る
    backOr(c && !c.deletedAt ? categoryHref(c.id) : '#/history');
  }

  // 一覧・詳細どちらから来ても元の画面に戻る。直接開いた場合はリンク先へ
  function goBack(e) {
    e.preventDefault();
    backOr(e.currentTarget.getAttribute('href'));
  }

  // 前に表示した画面へ移る（なければ href）。ホーム画面のアプリ（iPhone）では history.back() で
  // 戻れないことがあったので使わず、アプリ内で覚えている画面の順番（navStack）を使う
  function backOr(href) {
    location.hash = navStack[navStack.length - 2] || href;
  }

  // ---- 画面: 履歴・設定（後の Phase で実装） ----

  // ---- 画面: すべての履歴（日付ごと・新しい順） ----

  // q: 検索語（URL の #/history?q=... から。戻ってきたときも検索結果を保つ）
  async function renderHistory(q = '') {
    const [records, cats] = await Promise.all([DB.getAllRecords(), DB.getCategoryMap()]);
    const header = h('header', { class: 'page-header' }, h('h1', null, 'すべての履歴'));

    if (!records.length) {
      app.replaceChildren(header, historyTabs('list'), h('p', { class: 'empty' }, 'まだ記録がありません。'));
      return;
    }

    const input = h('input', {
      type: 'search',
      class: 'input search',
      placeholder: '🔍 カテゴリ名・メモで検索',
      'aria-label': '検索',
      enterkeyhint: 'search',
      autocomplete: 'off',
    });
    input.value = q;
    const results = h('div', { class: 'results' });

    // 入力のたびに結果だけ描き直す（入力欄のフォーカスや変換中の文字を保つ）
    const update = () => {
      const query = input.value.trim();
      replaceHash(query ? '#/history?q=' + encodeURIComponent(query) : '#/history');
      const hits = query ? searchRecords(records, cats, query) : records;
      results.replaceChildren(...[
        query && h('p', { class: 'search-count' },
          hits.length ? `${hits.length}件見つかりました` : '見つかりませんでした'),
        ...historyByDay(hits, cats)
      ].filter(Boolean));
    };
    input.addEventListener('input', update);
    input.addEventListener('keydown', e => {
      // 検索キーでキーボードを閉じる（変換確定の Enter は除く）
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) input.blur();
    });

    app.replaceChildren(header, historyTabs('list'), input, results);
    update();
  }

  // 全履歴の表示切り替え（リスト / カレンダー）
  function historyTabs(active) {
    return h('div', { class: 'seg', role: 'tablist' },
      h('a', { href: '#/history', class: active === 'list' ? 'active' : '', role: 'tab', 'aria-selected': String(active === 'list') }, 'リスト'),
      h('a', { href: '#/calendar', class: active === 'calendar' ? 'active' : '', role: 'tab', 'aria-selected': String(active === 'calendar') }, 'カレンダー')
    );
  }

  // ---- 画面: カレンダー ----
  // month: 'YYYY-MM'、day: 'DD'（URL の #/calendar/2026-10-15 から。記録詳細から戻っても選択を保つ）

  async function renderCalendar(month, day) {
    const [records, cats] = await Promise.all([DB.getAllRecords(), DB.getCategoryMap()]);
    const byDate = {};
    for (const r of records) (byDate[r.date] ||= []).push(r); // 新しい順のまま

    const today = toDateStr(new Date());
    const thisMonth = today.slice(0, 7);
    let ym = month || thisMonth;
    let sel = day ? `${ym}-${day}` : (ym === thisMonth ? today : null);

    const box = h('div', { class: 'calendar' });

    const shift = d => {
      const [y, m] = ym.split('-').map(Number);
      ym = toDateStr(new Date(y, m - 1 + d, 1)).slice(0, 7);
      sel = ym === thisMonth ? today : null;
      draw();
    };

    // 月の移動や日付の選択では画面全体を作り直さず、履歴も増やさない
    const draw = () => {
      replaceHash('#/calendar/' + (sel || ym));
      const [y, m] = ym.split('-').map(Number);
      const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 月曜始まり
      const days = new Date(y, m, 0).getDate();

      const cells = [];
      for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'cal-cell blank' }));
      for (let d = 1; d <= days; d++) {
        const ds = `${ym}-${pad(d)}`;
        const n = (byDate[ds] || []).length;
        const wd = (lead + d - 1) % 7;
        cells.push(h('button', {
          type: 'button',
          class: 'cal-cell' + (n ? ' has' : '') + (ds === today ? ' today' : '') +
            (ds === sel ? ' selected' : '') + (wd === 5 ? ' sat' : wd === 6 ? ' sun' : ''),
          'aria-label': `${m}月${d}日` + (n ? `、記録${n}件` : ''),
          'aria-pressed': String(ds === sel),
          onclick: () => { sel = ds; draw(); },
        },
          h('span', { class: 'cal-day' }, d),
          h('span', { class: 'cal-mark', 'aria-hidden': 'true' }, n ? (n > 1 ? `●${n}` : '●') : '')
        ));
      }

      let detail;
      if (!sel) {
        detail = [h('p', { class: 'note cal-hint' }, '日付をタップすると、その日の記録が表示されます。')];
      } else if (byDate[sel]) {
        detail = historyByDay(byDate[sel], cats);
      } else {
        detail = [
          dayHead(sel),
          h('p', { class: 'note' }, 'この日の記録はありません。'),
        ];
      }

      // replaceChildren は false を文字として表示するので、条件付きの要素は除いてから渡す
      box.replaceChildren(...[
        h('div', { class: 'cal-nav' },
          h('button', { type: 'button', class: 'cal-arrow', 'aria-label': '前の月', onclick: () => shift(-1) }, '‹'),
          h('h2', { class: 'cal-title' }, `${y}年${m}月`),
          h('button', { type: 'button', class: 'cal-arrow', 'aria-label': '次の月', onclick: () => shift(1) }, '›')
        ),
        h('div', { class: 'cal-grid' },
          ['月', '火', '水', '木', '金', '土', '日'].map((w, i) =>
            h('div', { class: 'cal-wd' + (i === 5 ? ' sat' : i === 6 ? ' sun' : '') }, w)),
          cells
        ),
        ym !== thisMonth && h('button', {
          type: 'button',
          class: 'link-btn cal-back',
          onclick: () => { ym = thisMonth; sel = today; draw(); },
        }, '今月に戻る'),
        h('div', { class: 'cal-detail' }, detail),
      ].filter(Boolean));
    };

    app.replaceChildren(
      h('header', { class: 'page-header' }, h('h1', null, 'すべての履歴')),
      historyTabs('calendar'),
      box
    );
    draw();
  }

  // 全角半角・大文字小文字を区別しない。空白区切りの語をすべて含むものに絞る
  const normalize = s => s.normalize('NFKC').toLowerCase();

  function searchRecords(records, cats, query) {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    return records.filter(r => {
      const c = cats[r.categoryId];
      const text = normalize(`${c ? c.name : ''} ${r.memo || ''}`);
      return terms.every(t => text.includes(t));
    });
  }

  // 日付の見出し。今日・昨日はバッジ、それ以外は小さく「N日前」
  function dayHead(date) {
    const rel = formatDay(date);
    const ago = daysAgo(date);
    return h('h2', { class: 'day-head' },
      date.replace(/-/g, '/'),
      rel !== date.replace(/-/g, '/') && h('span', { class: 'day-badge' }, rel),
      ago && h('span', { class: 'day-ago' }, ago)
    );
  }

  // 日付ごとの見出し + 記録リスト（records は新しい順）
  function historyByDay(records, cats) {
    const body = [];
    let day = null;
    let list = null;
    for (const r of records) {
      if (r.date !== day) {
        day = r.date;
        list = h('ul', { class: 'hist-list' });
        body.push(dayHead(r.date), list);
      }
      const c = cats[r.categoryId];
      list.append(h('li', null, h('a', { href: recordHref(r.id), class: 'hist-item' },
        h('div', { class: 'hist-time all' }, r.time),
        h('div', { class: 'hist-body' },
          h('div', { class: 'hist-cat' }, c ? c.name : '（不明なカテゴリ）',
            c && c.deletedAt && h('span', { class: 'deleted' }, '削除済み')),
          r.memo && h('div', { class: 'hist-memo sub' }, r.memo)
        ),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')
      )));
    }
    return body;
  }

  // ---- 画面: できごと（日付・誰の・一行メモ。年ごとに古い順） ----

  const FAMILY = 'family'; // personId：家族みんな
  const eventsHref = (year, person) => `#/events/${year}` + (person ? '?p=' + encodeURIComponent(person) : '');

  // 選択肢：家族みんな＋登録した家族
  const personOptions = people => [
    h('option', { value: FAMILY }, '家族みんな'),
    ...people.map(p => h('option', { value: p.id }, p.name)),
  ];

  function personName(personId, peopleMap) {
    if (personId === FAMILY) return '家族みんな';
    const p = peopleMap[personId];
    return p ? p.name : '（不明）';
  }

  // year: 'YYYY'、person: '' ならすべて（URL の #/events/2026?p=... から。編集後も選択を保つ）
  async function renderEvents(yearStr, personParam = '') {
    const people = await DB.listPeople();
    const thisYear = new Date().getFullYear();
    let year = Number(yearStr) || thisYear;
    let person = personParam === FAMILY || people.some(p => p.id === personParam) ? personParam : '';

    const select = h('select', { class: 'input select', 'aria-label': '誰のできごとを表示するか' },
      h('option', { value: '' }, 'すべて'),
      personOptions(people)
    );
    select.value = person;
    select.addEventListener('change', () => { person = select.value; draw(); });

    // 検索語を入れると、年に関係なくすべてのできごとから探す
    const search = h('input', {
      type: 'search',
      class: 'input search',
      placeholder: '🔍 できごと・名前で検索',
      'aria-label': 'できごとを検索',
      enterkeyhint: 'search',
      autocomplete: 'off',
    });
    search.addEventListener('input', () => draw());
    search.addEventListener('keydown', e => {
      // 検索キーでキーボードを閉じる（変換確定の Enter は除く）
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) search.blur();
    });

    const box = h('div', { class: 'events' });
    let drawing = 0; // 速く切り替えたとき、古い読み込み結果で上書きしないための番号

    const draw = async () => {
      const token = ++drawing;
      replaceHash(eventsHref(year, person));
      const query = search.value.trim();
      const [events, peopleMap] = await Promise.all([
        query ? DB.listAllEvents() : DB.listEventsOfYear(year),
        DB.getPeopleMap(),
      ]);
      if (token !== drawing) return;
      // 誰かを選んだときは、その人のできごと＋家族みんなのできごと
      let shown = !person ? events
        : events.filter(e => e.personId === person || (person !== FAMILY && e.personId === FAMILY));
      if (query) {
        // 全角半角・大文字小文字を区別しない。空白区切りの語をすべて含むものに絞る
        const terms = normalize(query).split(/\s+/).filter(Boolean);
        shown = shown.filter(e => {
          const text = normalize(`${personName(e.personId, peopleMap)} ${e.text}`);
          return terms.every(t => text.includes(t));
        });
      }

      // 通常は月ごと、検索中は年ごとに見出しを付ける
      const body = [];
      let group = null;
      let list = null;
      for (const e of shown) {
        const [y, m, d] = e.date.split('-').map(Number);
        const key = query ? y : m;
        if (key !== group) {
          group = key;
          list = h('ul', { class: 'hist-list' });
          body.push(h('h3', { class: 'month' }, query ? `${y}年` : `${m}月`), list);
        }
        const p = peopleMap[e.personId];
        list.append(h('li', null, h('button', { type: 'button', class: 'hist-item ev-item', onclick: () => editEvent(e) },
          h('div', { class: 'hist-date' }, `${m}/${d}`),
          h('div', { class: 'hist-body' },
            h('span', { class: 'ev-person' + (e.personId === FAMILY ? ' family' : '') }, personName(e.personId, peopleMap)),
            p && p.deletedAt && h('span', { class: 'deleted' }, '削除済み'),
            h('div', { class: 'ev-text' }, e.text)
          ),
          h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')
        )));
      }

      if (query) {
        box.replaceChildren(
          h('p', { class: 'search-count' }, shown.length ? `${shown.length}件見つかりました（すべての年）` : '見つかりませんでした'),
          ...body
        );
        return;
      }

      box.replaceChildren(...[
        h('div', { class: 'cal-nav' },
          h('button', { type: 'button', class: 'cal-arrow', 'aria-label': '前の年', onclick: () => { year--; draw(); } }, '‹'),
          h('h2', { class: 'cal-title' }, `${year}年`, h('span', { class: 'count' }, `　${shown.length}件`)),
          h('button', { type: 'button', class: 'cal-arrow', 'aria-label': '次の年', onclick: () => { year++; draw(); } }, '›')
        ),
        year !== thisYear && h('button', {
          type: 'button',
          class: 'link-btn cal-back',
          onclick: () => { year = thisYear; draw(); },
        }, '今年に戻る'),
        ...(body.length ? body : [h('p', { class: 'note ev-none' }, 'この年のできごとはありません。')]),
      ].filter(Boolean));
    };

    // 追加・編集のあと、そのできごとの年を表示する
    const showYearOf = date => { year = Number(date.slice(0, 4)); draw(); };

    async function addEvent() {
      const values = await eventForm({
        title: 'できごとを追加',
        date: toDateStr(new Date()),
        personId: person,
        people,
        okLabel: '追加',
      });
      if (!values) return;
      await DB.addEvent(values);
      showYearOf(values.date);
    }

    async function editEvent(e) {
      const values = await eventForm({
        title: 'できごとを編集',
        date: e.date,
        personId: e.personId,
        text: e.text,
        people,
        okLabel: '保存',
        extraButtons: [{ label: 'このできごとを削除', value: 'delete', style: 'danger-outline' }],
      });
      if (values === 'delete') {
        const action = await showDialog({
          title: 'このできごとを削除しますか？',
          message: `${formatDayLong(e.date)}　${e.text}`,
          buttons: [
            { label: 'キャンセル', value: 'cancel', autofocus: true },
            { label: '削除', value: 'delete', style: 'danger' },
          ],
        });
        if (action !== 'delete') return;
        await DB.deleteEvent(e.id);
        draw();
      } else if (values) {
        await DB.updateEvent(e.id, values);
        showYearOf(values.date);
      }
    }

    // replaceChildren は null や false を文字として表示するので、条件付きの要素は除いてから渡す
    app.replaceChildren(...[
      h('header', { class: 'page-header' }, h('h1', null, 'できごと')),
      h('label', { class: 'field ev-filter' },
        h('span', { class: 'field-label' }, '誰のできごと'),
        h('span', { class: 'select-wrap' }, select)
      ),
      h('button', { type: 'button', class: 'btn add-btn ev-add', onclick: addEvent }, '＋ できごとを追加'),
      !people.length && h('p', { class: 'note' },
        '家族の名前は「', h('a', { href: '#/settings?to=family', class: 'text-link' }, '設定'), '」の「家族」で登録できます。'),
      search,
      box,
    ].filter(Boolean));
    await draw();
  }

  // できごとの入力ダイアログ。OK なら { date, personId, text }、削除ボタンなら 'delete'、それ以外は null
  async function eventForm({ title, date, personId = '', text = '', people, okLabel, extraButtons = [] }) {
    const dateIn = h('input', { type: 'date', class: 'input', value: date });
    const personIn = h('select', { class: 'input select' },
      h('option', { value: '', disabled: true }, '選んでください'),
      personOptions(people)
    );
    // 削除した家族のできごとを編集するときは、その名前を残しておく
    if (personId && personId !== FAMILY && !people.some(p => p.id === personId)) {
      const map = await DB.getPeopleMap();
      personIn.append(h('option', { value: personId }, personName(personId, map) + '（削除済み）'));
    }
    personIn.value = personId;
    const textIn = h('input', {
      type: 'text',
      class: 'input',
      maxlength: '200',
      placeholder: '例：運転免許を更新した',
      autocomplete: 'off',
      enterkeyhint: 'done',
    });
    textIn.value = text;

    const p = showDialog({
      title,
      content: h('div', { class: 'fields' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, '日付'), dateIn),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, '誰の'), h('span', { class: 'select-wrap' }, personIn)),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'できごと'), textIn)
      ),
      buttons: [
        { label: okLabel, value: 'ok', style: 'primary' },
        ...extraButtons,
        { label: 'キャンセル', value: 'cancel' },
      ],
    });

    const valid = () => dateIn.value && personIn.value && textIn.value.trim();
    const okBtn = dialogEl.querySelector('button[value="ok"]');
    const sync = () => { okBtn.disabled = !valid(); };
    sync();
    [dateIn, personIn, textIn].forEach(el => {
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    });
    textIn.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      // 日本語変換の確定 Enter では閉じない（Safari は keyCode 229）
      if (e.isComposing || e.keyCode === 229) return;
      if (valid()) finishDialog('ok');
    });

    const action = await p;
    if (action === 'delete') return 'delete';
    if (action !== 'ok' || !valid()) return null;
    return { date: dateIn.value, personId: personIn.value, text: textIn.value.trim() };
  }

  // ---- 画面: 設定 ----

  const APP_VERSION = '0.16.3';
  const BACKUP_FORMAT = 'nanishita-backup';

  // to: 'family' なら「家族」の欄まで移動して表示する（できごと画面の案内リンクから）
  async function renderSettings(to) {
    const mode = getSortMode();
    const cats = mode === 'manual' ? await DB.listCategories() : [];
    const people = await DB.listPeople();

    const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    fileIn.addEventListener('change', () => {
      const file = fileIn.files[0];
      fileIn.value = ''; // 同じファイルを続けて選んでも change が起きるように
      if (file) importData(file);
    });

    const item = (label, desc, onclick, cls = '') =>
      h('li', null, h('button', { type: 'button', class: 'setting-item ' + cls, onclick },
        h('span', { class: 'setting-label' }, label),
        desc && h('span', { class: 'setting-desc' }, desc)
      ));

    app.replaceChildren(...[
      h('header', { class: 'page-header' }, h('h1', null, '設定')),
      h('h2', { class: 'setting-group' }, 'バックアップ'),
      h('ul', { class: 'setting-list' },
        item('データを書き出す', 'すべてのカテゴリ・記録・できごと・家族を JSON ファイルに保存します', exportData),
        item('データを読み込む', '書き出した JSON ファイルから復元します', () => fileIn.click())
      ),
      fileIn,
      h('h2', { class: 'setting-group' }, '表示設定'),
      h('div', { class: 'setting-list', role: 'radiogroup', 'aria-label': 'カテゴリの並び順' },
        h('div', { class: 'setting-caption' }, 'カテゴリの並び順'),
        SORT_MODES.map(([value, label]) =>
          h('label', { class: 'radio-item' },
            h('input', {
              type: 'radio',
              name: 'sort',
              value,
              checked: value === mode,
              onchange: () => { setSortMode(value); renderSettings(); },
            }),
            h('span', null, label)
          )
        )
      ),
      mode === 'manual' && renderReorder(cats),
      h('h2', { class: 'setting-group', id: 'settings-family' }, '家族'),
      h('ul', { class: 'setting-list' },
        people.map(p => item(p.name, '押すと名前の変更・削除', () => editPerson(p), 'person')),
        item('＋ 家族を追加', 'できごとで「誰の」を選ぶときに使います', addPerson)
      ),
      h('h2', { class: 'setting-group' }, 'データ'),
      h('ul', { class: 'setting-list' },
        item('データをすべて削除', 'カテゴリ・記録・できごと・家族をすべて消します', deleteAllData, 'danger')
      ),
      h('h2', { class: 'setting-group' }, 'アプリについて'),
      h('ul', { class: 'setting-list' },
        item('最新版に更新', '新しいファイルを取り直して読み込み直します。データは消えません', updateApp)
      ),
      h('div', { class: 'about' },
        h('p', null, h('strong', null, 'いつやった？'), `　バージョン ${APP_VERSION}`),
        h('p', null, 'データはこの端末のブラウザの中だけに保存され、外部には送信されません。'),
        h('p', null, '機種変更やブラウザのデータ削除に備えて、ときどき「データを書き出す」で保存しておくと安心です。')
      ),
      !isStandalone() && h('h2', { class: 'setting-group' }, 'ホーム画面に追加する'),
      !isStandalone() && h('div', { class: 'about' },
        h('ol', { class: 'steps' },
          h('li', null, 'iPhone の Safari でこのページを開く'),
          h('li', null, '画面下の共有ボタン（□に↑）をタップ'),
          h('li', null, '「ホーム画面に追加」をタップ'),
          h('li', null, 'ホーム画面のアイコンから起動すると、アプリのように使えます')
        )
      )
    ].filter(Boolean));

    if (to === 'family') {
      // URL は普通の設定画面に戻しておく（戻る・進むで何度も移動しないように）
      replaceHash('#/settings');
      document.getElementById('settings-family').scrollIntoView({ block: 'start' });
    }
  }

  async function addPerson() {
    const r = await promptName({ title: '家族を追加', okLabel: '追加', label: '名前', placeholder: '例：お母さん' });
    if (r.action !== 'ok') return;
    await DB.addPerson(r.name);
    renderSettings();
  }

  async function editPerson(p) {
    const r = await promptName({
      title: '名前の変更',
      value: p.name,
      okLabel: '保存',
      label: '名前',
      placeholder: '例：お母さん',
      extraButtons: [{ label: 'この人を削除', value: 'delete', style: 'danger-outline' }],
    });
    if (r.action === 'ok') {
      await DB.renamePerson(p.id, r.name);
    } else if (r.action === 'delete') {
      const count = await DB.countEventsOfPerson(p.id);
      const action = await showDialog({
        title: `「${p.name}」を削除しますか？`,
        message: count
          ? `${count} 件のできごとはそのまま残り、「削除済み」と表示されます。`
          : 'この人のできごとはありません。',
        buttons: [
          { label: 'キャンセル', value: 'cancel', autofocus: true },
          { label: '削除', value: 'delete', style: 'danger' },
        ],
      });
      if (action !== 'delete') return;
      await DB.deletePerson(p.id);
    } else {
      return;
    }
    renderSettings();
  }

  // 自分で並べ替え：カテゴリ名を押したまま上下に動かす。↑↓ボタンでも1つずつ動かせる
  function renderReorder(cats) {
    if (!cats.length) return h('p', { class: 'note' }, 'カテゴリがありません。');
    const move = async (i, d) => {
      const ids = cats.map(c => c.id);
      [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
      await DB.reorderCategories(ids);
      await renderSettings();
      // 動かしたカテゴリのボタンにフォーカスを戻し、続けて押せるようにする
      const btn = app.querySelectorAll('.reorder-item')[i + d]?.querySelector(d < 0 ? '.up' : '.down');
      if (btn && !btn.disabled) btn.focus();
    };
    const list = h('ul', { class: 'setting-list reorder' },
      h('li', { class: 'setting-caption' }, 'カテゴリ名を押したまま上下に動かすか、↑↓ で順番を変えられます'),
      cats.map((c, i) =>
      h('li', { class: 'reorder-item', 'data-id': c.id },
        h('span', { class: 'reorder-handle' },
          h('span', { class: 'grip', 'aria-hidden': 'true' }, '≡'),
          h('span', { class: 'reorder-name' }, c.name)
        ),
        h('button', { type: 'button', class: 'move up', disabled: i === 0, 'aria-label': `${c.name}を上へ`, onclick: () => move(i, -1) }, '↑'),
        h('button', { type: 'button', class: 'move down', disabled: i === cats.length - 1, 'aria-label': `${c.name}を下へ`, onclick: () => move(i, 1) }, '↓')
      )
    ));
    enableDragReorder(list, cats.map(c => c.id));
    return list;
  }

  // ドラッグ中の項目を指（マウス）に追従させ、隣の項目の半分を越えたら入れ替える
  function enableDragReorder(list, originalIds) {
    let item = null;
    let startY = 0; // ドラッグ中の項目が今の位置にあるときの指のページ座標

    const pageY = e => e.clientY + window.scrollY;

    list.addEventListener('pointerdown', e => {
      const handle = e.target.closest('.reorder-handle');
      if (!handle || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      item = handle.closest('.reorder-item');
      startY = pageY(e);
      item.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
    });

    list.addEventListener('pointermove', e => {
      if (!item) return;
      // 画面の端に近づいたら自動でスクロールする
      const edge = 70;
      if (e.clientY < edge) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - edge - 70) window.scrollBy(0, 12);

      // 速く動かして一度に何個分も進んだときも、越えた分だけ入れ替える
      let dy;
      for (;;) {
        dy = pageY(e) - startY;
        const prev = item.previousElementSibling;
        const next = item.nextElementSibling;
        if (dy < 0 && prev && prev.classList.contains('reorder-item') && -dy > prev.offsetHeight / 2) {
          list.insertBefore(item, prev);
          startY -= prev.offsetHeight;
        } else if (dy > 0 && next && dy > next.offsetHeight / 2) {
          list.insertBefore(next, item);
          startY += next.offsetHeight;
        } else {
          break;
        }
      }
      item.style.transform = `translateY(${dy}px)`;
    });

    const end = async () => {
      if (!item) return;
      item.classList.remove('dragging');
      item.style.transform = '';
      item = null;
      const ids = [...list.querySelectorAll('.reorder-item')].map(li => li.dataset.id);
      if (ids.join() === originalIds.join()) return;
      await DB.reorderCategories(ids);
      await renderSettings(); // ↑↓ボタンの状態を新しい順番に合わせる
    };
    list.addEventListener('pointerup', end);
    list.addEventListener('pointercancel', end);
  }

  function alertDialog(title, message) {
    return showDialog({ title, message, buttons: [{ label: 'OK', value: 'ok', style: 'primary' }] });
  }

  // ホーム画面から起動しているか
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  const isIOS = () =>
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  async function exportData() {
    const { categories, records, people, events } = await DB.exportAll();
    const data = {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { sort: getSortMode() },
      categories,
      records,
      people,
      events,
    };
    const name = `itsuyatta-backup-${toDateStr(new Date())}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });

    // iPhone のホーム画面アプリではダウンロードが使いにくいので共有シート（「ファイルに保存」など）を使う
    if (isIOS() && navigator.canShare) {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
        } catch (e) {
          if (e.name !== 'AbortError') alertDialog('書き出せませんでした', String(e.message || e));
        }
        return;
      }
    }

    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // 読み込んだ JSON を検査して、保存できる形に整える。おかしければ Error を投げる
  function parseBackup(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('JSON ファイルとして読めませんでした。');
    }
    if (!data || data.format !== BACKUP_FORMAT || !Array.isArray(data.categories) || !Array.isArray(data.records)) {
      throw new Error('このアプリで書き出したバックアップファイルではありません。');
    }

    const isStr = v => typeof v === 'string' && v !== '';
    const categories = data.categories.map((c, i) => {
      if (!c || !isStr(c.id) || typeof c.name !== 'string') throw new Error('カテゴリのデータが壊れています。');
      // 並び順がないと一覧の並べ替えが崩れるので、ファイル内の順番で補う
      return Number.isFinite(c.sortOrder) ? c : { ...c, sortOrder: i + 1 };
    });
    const records = data.records.map(r => {
      if (!r || !isStr(r.id) || !isStr(r.categoryId) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !/^\d{2}:\d{2}$/.test(r.time)) {
        throw new Error('記録のデータが壊れています。');
      }
      // 存在しない日付（13月など）は並べ替え用の値が作れず、一覧に出なくなるので弾く
      const datetime = new Date(`${r.date}T${r.time}`).getTime();
      if (!Number.isFinite(datetime)) throw new Error('記録のデータが壊れています。');
      return { ...r, memo: r.memo || '', datetime };
    });
    // 家族・できごと（それより前に書き出したファイルにはないので空として扱う）
    if ((data.people && !Array.isArray(data.people)) || (data.events && !Array.isArray(data.events))) {
      throw new Error('このアプリで書き出したバックアップファイルではありません。');
    }
    const people = (data.people || []).map((p, i) => {
      if (!p || !isStr(p.id) || typeof p.name !== 'string') throw new Error('家族のデータが壊れています。');
      return Number.isFinite(p.sortOrder) ? p : { ...p, sortOrder: i + 1 };
    });
    const events = (data.events || []).map(e => {
      if (!e || !isStr(e.id) || !isStr(e.personId) || typeof e.text !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
        throw new Error('できごとのデータが壊れています。');
      }
      return e;
    });

    // 並び順の設定（古いバックアップにはないので、そのときは今の設定のまま）
    const s = data.settings && data.settings.sort;
    const sort = SORT_MODES.some(([k]) => k === s) ? s : null;
    return { categories, records, people, events, sort };
  }

  const summary = d => `カテゴリ ${d.categories.length}件・記録 ${d.records.length}件・` +
    `できごと ${d.events.length}件・家族 ${d.people.filter(p => !p.deletedAt).length}人`; // 削除済みの人は数えない

  async function importData(file) {
    let data;
    try {
      data = parseBackup(await file.text());
    } catch (e) {
      await alertDialog('読み込めませんでした', e.message);
      return;
    }

    const now = await DB.exportAll();
    const action = await showDialog({
      title: 'データを読み込みますか？',
      message: `読み込むデータ：${summary(data)}\n\n` +
        `今のデータ（${summary(now)}）はすべて置き換わります。`,
      buttons: [
        { label: 'キャンセル', value: 'cancel', autofocus: true },
        { label: '読み込む', value: 'ok', style: 'danger' },
      ],
    });
    if (action !== 'ok') return;

    await DB.replaceAll(data);
    if (data.sort) setSortMode(data.sort);
    await renderSettings(); // 並べ替えの一覧を新しいデータに合わせる
    await alertDialog('読み込みました', `${summary(data)}を復元しました。`);
  }

  async function deleteAllData() {
    const now = await DB.exportAll();
    const action = await showDialog({
      title: 'データをすべて削除しますか？',
      message: `${summary(now)}がすべて消え、元に戻せません。\n\n` +
        '必要なら先に「データを書き出す」で保存してください。',
      buttons: [
        { label: 'キャンセル', value: 'cancel', autofocus: true },
        { label: 'すべて削除', value: 'ok', style: 'danger' },
      ],
    });
    if (action !== 'ok') return;

    await DB.clearAll();
    await renderSettings();
    await alertDialog('削除しました', 'すべてのデータを削除しました。');
  }

  // 最新版に更新：ホーム画面のアプリはアドレス欄がなく再読み込みできないので、
  // 保存済みのファイルを取り直し、オフライン用の保存も消してから読み込み直す（データは IndexedDB なので消えない）
  async function updateApp() {
    const files = ['./', 'index.html', 'css/style.css', 'js/db.js', 'js/app.js', 'sw.js'];
    try {
      const res = await fetch('index.html', { cache: 'reload' });
      if (!res.ok) throw new Error(res.status);
      const html = await res.text();
      // index.html が読み込む css/js（?v=番号 付き）も取り直す
      const linked = [...html.matchAll(/(?:href|src)="((?:css|js)\/[^"]+)"/g)].map(m => m[1]);
      await Promise.all([...files, ...linked].map(f => fetch(f, { cache: 'reload' })));
    } catch {
      await alertDialog('更新できませんでした', 'アプリのファイルを取りに行けませんでした。通信できる状態か確かめてください。');
      return;
    }
    try {
      if (window.caches) await Promise.all((await caches.keys()).map(k => caches.delete(k)));
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    } catch {}
    location.reload();
  }

  // ---- ルーター ----

  const routes = [
    [/^#?\/?$/, 'categories', renderCategories],
    [/^#\/category\/([^/]+)$/, 'categories', renderCategory],
    [/^#\/day\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/, 'categories', renderDay],
    [/^#\/record\/([^/]+)$/, null, renderRecord],
    [/^#\/history(?:\?q=(.*))?$/, 'history', renderHistory],
    [/^#\/calendar(?:\/(\d{4}-\d{2})(?:-(\d{2}))?)?$/, 'history', renderCalendar],
    [/^#\/events(?:\/(\d{4}))?(?:\?p=([^&]*))?$/, 'events', renderEvents],
    [/^#\/settings(?:\?to=(\w+))?$/, 'settings', renderSettings],
  ];

  let shownHash = null; // 最後に描いた画面の URL（hashchange と popstate の二重描画を防ぐ）
  // 表示した画面の順番（「‹ 戻る」用）。1つ前の画面へ移ったときは戻ったとみなして取り除く
  const navStack = [];

  async function route() {
    const hash = location.hash || '#/';
    shownHash = location.hash;
    if (navStack.length > 1 && navStack[navStack.length - 2] === hash) navStack.pop();
    else if (navStack[navStack.length - 1] !== hash) navStack.push(hash);
    if (navStack.length > 50) navStack.shift();
    for (const [re, tab, render] of routes) {
      const m = hash.match(re);
      if (!m) continue;
      // tab が null の画面（記録詳細）は、来た画面のタブを選択したままにする
      if (tab) {
        document.querySelectorAll('.tabbar a').forEach(a => {
          a.classList.toggle('active', a.dataset.tab === tab);
        });
      }
      await render(...m.slice(1).map(s => (s == null ? undefined : decodeURIComponent(s))));
      return;
    }
    location.hash = '#/';
  }

  // 画面を作り直さずに URL だけ書き換える（全履歴の検索・カレンダー・できごと・設定）
  function replaceHash(hash) {
    history.replaceState(null, '', hash);
    if (navStack.length) navStack[navStack.length - 1] = hash;
  }

  // iPhone の Safari は replaceState で書き換えた画面（全履歴・カレンダー）へ戻るとき
  // hashchange が来ず popstate だけ来ることがあるので、両方で描き直す
  const onNavigate = () => {
    if (location.hash === shownHash) return;
    route();
    window.scrollTo(0, 0);
  };
  window.addEventListener('hashchange', onNavigate);
  window.addEventListener('popstate', onNavigate);
  route();

  // オフライン対応（https か localhost のときだけ動く）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // ブラウザが容量不足のときにデータを勝手に消さないよう依頼する
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
})();
