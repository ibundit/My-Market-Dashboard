// Application State - Version 25 (100% Reliable Finnhub Metric Consolidation Engine)
const STATE = {
    watchlists: {}, 
    currentTab: '',
    refreshInterval: parseInt(localStorage.getItem('refreshInterval')) || 0,
    intervalId: null,
    lastData: {}, 
    sortCol: null,
    sortAsc: true,
    keys: {
        finnhub: localStorage.getItem('FINNHUB_API_KEY') || ''
    }
};

const KNOWN_CRYPTOS = ['BTC','ETH','USDT','BNB','SOL','USDC','XRP','ADA','DOGE','SHIB','AVAX','DOT','LINK','TRX','MATIC','LTC','BCH','XLM','NEAR','UNI','ZETA','IO','APT','SUI','RENDER','FET','BNSOL','TON','TAO','LINEA','L3'];

const FALLBACK_LOGOS = {
    'BNSOL': 'https://assets.coingecko.com/coins/images/39989/standard/BNSOL.png',
    'LINEA': 'https://assets.coingecko.com/coins/images/35738/standard/linea.png',
    'L3': 'https://assets.coingecko.com/coins/images/39474/standard/layer3.png',
    'ZETA': 'https://assets.coingecko.com/coins/images/32288/standard/zeta.png',
    'IO': 'https://assets.coingecko.com/coins/images/38118/standard/io.png',
    'TAO': 'https://assets.coingecko.com/coins/images/31206/standard/bittensor.png',
    'TON': 'https://assets.coingecko.com/coins/images/17980/standard/ton_symbol.png'
};

document.addEventListener('DOMContentLoaded', () => {
    initDataMigrate();
    initApiKeys();
    initUI();
    fetchDataAllTabs(true);
});

function initDataMigrate() {
    let savedLists = JSON.parse(localStorage.getItem('watchlists'));
    if (!savedLists) {
        let oldSingleList = JSON.parse(localStorage.getItem('watchlist')) || ['NVDA', 'AAPL', 'TSM', 'BTC-USD'];
        savedLists = { "Default": oldSingleList };
    }
    STATE.watchlists = savedLists;
    
    let savedTab = localStorage.getItem('currentTab');
    if (!savedTab || !STATE.watchlists[savedTab]) savedTab = Object.keys(STATE.watchlists)[0];
    STATE.currentTab = savedTab;
}

function initApiKeys() {
    if (window.APP_CONFIG) {
        if (!STATE.keys.finnhub && window.APP_CONFIG.FINNHUB_API_KEY !== 'PASTE_KEY_HERE') {
            STATE.keys.finnhub = window.APP_CONFIG.FINNHUB_API_KEY;
            localStorage.setItem('FINNHUB_API_KEY', STATE.keys.finnhub);
        }
    }
    verifyFinnhubKey();
}

function verifyFinnhubKey() {
    if (!STATE.keys.finnhub) {
        const key = prompt(`Enter Finnhub API Key (Required for Stocks):`);
        if (key) { 
            STATE.keys.finnhub = key.trim(); 
            localStorage.setItem(`FINNHUB_API_KEY`, STATE.keys.finnhub); 
        }
    }
}

function initUI() {
    document.getElementById('refresh-select').value = STATE.refreshInterval;
    
    document.getElementById('add-btn').addEventListener('click', addSymbols);
    document.getElementById('symbol-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') addSymbols(); });
    document.getElementById('refresh-btn').addEventListener('click', () => fetchDataAllTabs(true));
    document.getElementById('add-tab-btn').addEventListener('click', addNewTab);
    
    document.getElementById('export-btn').addEventListener('click', exportSyncCode);
    document.getElementById('import-btn').addEventListener('click', importSyncCode);

    document.getElementById('refresh-select').addEventListener('change', (e) => {
        STATE.refreshInterval = parseInt(e.target.value);
        localStorage.setItem('refreshInterval', STATE.refreshInterval);
        setupAutoRefresh();
    });

    document.getElementById('orig-order-cb').addEventListener('change', (e) => {
        if(e.target.checked) {
            STATE.sortCol = null;
            updateSortIcons();
            renderTable();
        }
    });

    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            document.getElementById('orig-order-cb').checked = false; 
            const property = th.getAttribute('data-sort');
            if (STATE.sortCol === property) STATE.sortAsc = !STATE.sortAsc;
            else { STATE.sortCol = property; STATE.sortAsc = true; }
            updateSortIcons();
            renderTable();
        });
    });

    setupAutoRefresh();
    setupDragAndDrop();
    renderTabs();
}

function renderTabs() {
    const container = document.getElementById('tabs-list');
    container.innerHTML = '';
    const tabNames = Object.keys(STATE.watchlists);
    
    tabNames.forEach(tabName => {
        const div = document.createElement('div');
        div.className = `tab ${tabName === STATE.currentTab ? 'active' : ''}`;
        const showDelete = tabNames.length > 1;
        div.innerHTML = `
            <span class="tab-name">${tabName}</span>
            <span class="tab-action edit" title="Rename" onclick="event.stopPropagation(); renameTab('${tabName}')">✏️</span>
            ${showDelete ? `<span class="tab-action delete" title="Delete" onclick="event.stopPropagation(); deleteTab('${tabName}')">✕</span>` : ''}
        `;
        div.onclick = () => switchTab(tabName);
        container.appendChild(div);
    });
}

function switchTab(tabName) {
    if (STATE.currentTab === tabName) return;
    STATE.currentTab = tabName; 
    localStorage.setItem('currentTab', tabName);
    STATE.sortCol = null; 
    document.getElementById('orig-order-cb').checked = true;
    updateSortIcons(); 
    renderTabs(); 
    renderTable(); 
}

function addNewTab() {
    const name = prompt("Tab Name:");
    if (!name || !name.trim()) return;
    if (STATE.watchlists[name.trim()]) return showAlert("Exists.");
    STATE.watchlists[name.trim()] = []; localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists)); switchTab(name.trim());
}
function renameTab(oldName) {
    const newName = prompt("New Name:", oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    if (STATE.watchlists[newName.trim()]) return showAlert("Exists.");
    STATE.watchlists[newName.trim()] = STATE.watchlists[oldName]; delete STATE.watchlists[oldName];
    if (STATE.currentTab === oldName) { STATE.currentTab = newName.trim(); localStorage.setItem('currentTab', newName.trim()); }
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists)); renderTabs();
}
function deleteTab(tabName) {
    if (!confirm(`Delete '${tabName}'?`)) return;
    delete STATE.watchlists[tabName];
    if (STATE.currentTab === tabName) { STATE.currentTab = Object.keys(STATE.watchlists)[0]; localStorage.setItem('currentTab', STATE.currentTab); }
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists)); renderTabs(); renderTable();
}

function setupAutoRefresh() {
    if (STATE.intervalId) clearInterval(STATE.intervalId);
    if (STATE.refreshInterval > 0) STATE.intervalId = setInterval(() => fetchDataAllTabs(false), STATE.refreshInterval * 1000);
}
function showAlert(msg) {
    const alerts = document.getElementById('alerts');
    const el = document.createElement('div'); el.className = 'alert'; el.textContent = msg;
    alerts.appendChild(el); setTimeout(() => el.remove(), 6000);
}
function updateStatus(status, text) {
    document.getElementById('connection-dot').className = `dot ${status}`;
    document.getElementById('market-status').textContent = text;
}
function updateSortIcons() {
    document.querySelectorAll('th.sortable').forEach(th => {
        const icon = th.querySelector('.sort-icon');
        if (icon) icon.textContent = th.getAttribute('data-sort') === STATE.sortCol ? (STATE.sortAsc ? '▲' : '▼') : '';
    });
}
function addSymbols() {
    const inputField = document.getElementById('symbol-input');
    const rawInput = inputField.value;
    if (!rawInput.trim()) return;
    const symbolsToAdd = rawInput.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
    const currentList = STATE.watchlists[STATE.currentTab];
    let addedCount = 0;
    symbolsToAdd.forEach(sym => {
        if (KNOWN_CRYPTOS.includes(sym)) sym = sym + '-USD';
        if (!currentList.includes(sym)) { currentList.push(sym); addedCount++; }
    });
    if (addedCount > 0) { localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists)); renderSkeleton(); fetchDataAllTabs(true); }
    inputField.value = '';
}
window.removeSymbol = function(symbol) {
    STATE.watchlists[STATE.currentTab] = STATE.watchlists[STATE.currentTab].filter(s => s !== symbol);
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists));
    delete STATE.lastData[symbol]; renderTable();
};

function getLogoHtml(symbol) {
    const isCrypto = symbol.includes('-') || symbol.includes('/');
    const cleanSym = isCrypto ? symbol.split(/[-/]/)[0].toUpperCase() : symbol.toUpperCase();
    
    if (STATE.lastData[symbol] && STATE.lastData[symbol].logoUrl) {
        return `<img src="${STATE.lastData[symbol].logoUrl}" class="img-logo" alt="">`;
    }
    
    if (isCrypto && FALLBACK_LOGOS[cleanSym]) {
        return `<img src="${FALLBACK_LOGOS[cleanSym]}" class="img-logo" alt="">`;
    }

    let url = isCrypto 
        ? `https://assets.coincap.io/assets/icons/${cleanSym.toLowerCase()}@2x.png`
        : `https://financialmodelingprep.com/image-stock/${cleanSym}.png`;
        
    const fallbackUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${cleanSym}&backgroundColor=1e293b&textColor=f8fafc`;
    
    return `<img src="${url}" class="img-logo" onerror="this.src='${fallbackUrl}'">`;
}

async function fetchDataAllTabs(showStatusLoader = false) {
    const allSymbols = new Set();
    Object.values(STATE.watchlists).forEach(list => list.forEach(sym => allSymbols.add(sym)));
    
    const uniqueSymbols = Array.from(allSymbols);
    if (uniqueSymbols.length === 0) return updateStatus('yellow', 'Watchlist Empty');

    if(showStatusLoader) updateStatus('yellow', 'Fetching...');
    
    const cryptos = uniqueSymbols.filter(s => s.includes('-'));
    const stocks = uniqueSymbols.filter(s => !s.includes('-'));

    try {
        const globalPromises = [];
        
        if (cryptos.length > 0) {
            globalPromises.push(fetchCryptoEngine(cryptos));
            fetchCryptoLogosQuietly(cryptos); 
        }
        
        if (stocks.length > 0) {
            const currentKey = STATE.keys.finnhub;
            if (!currentKey) {
                showAlert(`Missing Finnhub API Key`);
            } else {
                globalPromises.push(fetchFinnhubMasterEngine(stocks, currentKey));
            }
        }
        
        await Promise.all(globalPromises);
        
        document.getElementById('last-updated-time').textContent = new Date().toLocaleTimeString();
        updateStatus('green', 'Connected');
        renderTable();
    } catch (err) {
        updateStatus('red', 'Fetch Error');
        showAlert(`Error: ${err.message}. Showing last cached data.`);
        renderTable();
    }
}

// SOLUTION: Solved proxy blocks completely by pulling all stock metrics through Finnhub's authenticated API token.
async function fetchFinnhubMasterEngine(stockList, finnhubKey) {
    if (stockList.length === 0) return;

    await Promise.all(stockList.map(async (sym) => {
        try {
            // 1. Fetch live real-time price & daily change
            const resPrice = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${finnhubKey}`);
            if (resPrice.ok) {
                const q = await resPrice.json();
                if (q.c) {
                    if (!STATE.lastData[sym]) STATE.lastData[sym] = { symbol: sym };
                    STATE.lastData[sym].price = q.c;
                    STATE.lastData[sym].changeDay = q.d;
                    STATE.lastData[sym].changePct = q.dp;
                }
            }
            
            // 2. Fetch extensive stock metrics (GAAP TTM, Non-GAAP FWD, Market Cap, 52W High/Low, 1Y Return)
            const resMetric = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${finnhubKey}`);
            if (resMetric.ok) {
                const m = await resMetric.json();
                if (m && m.metric) {
                    if (!STATE.lastData[sym]) STATE.lastData[sym] = { symbol: sym };
                    
                    // Native Market Cap from Finnhub (Returned directly in Millions)
                    STATE.lastData[sym].marketCap = m.metric.marketCapitalization || null;
                    
                    // Native P/E GAAP TTM
                    STATE.lastData[sym].peTtm = m.metric.peTTM || null;
                    
                    // Native P/E Non-GAAP FWD
                    STATE.lastData[sym].peFwd = m.metric.forwardPE || null;
                    
                    // 52W High and 52W Low Bounds
                    STATE.lastData[sym].high52 = m.metric['52WeekHigh'] || null;
                    STATE.lastData[sym].low52 = m.metric['52WeekLow'] || null;
                    
                    // 1Y Return (52WeekPriceReturnDaily is provided as percentage, e.g. 154.2 = 154.2%)
                    const return1Y = m.metric['52WeekPriceReturnDaily'] || null;
                    STATE.lastData[sym].return1Y = return1Y;
                    
                    // ACCURATE CALCULATION FOR 365D CHANGE:
                    // If return1Y exists, backtrack the original price to figure out absolute dollars changed
                    if (STATE.lastData[sym].price && return1Y !== null) {
                        const originalPrice1YAgo = STATE.lastData[sym].price / (1 + (return1Y / 100));
                        STATE.lastData[sym].change365 = STATE.lastData[sym].price - originalPrice1YAgo;
                    } else {
                        STATE.lastData[sym].change365 = null;
                    }
                }
            }
        } catch(e) {
            console.error(`Finnhub request error for ${sym}:`, e);
        }
    }));
}

async function fetchCryptoEngine(cryptos) {
    let binanceTickers = [];
    try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr`);
        if(res.ok) binanceTickers = await res.json();
    } catch(e) {}

    const cryptoPromises = cryptos.map(async (sym) => {
        const token = sym.split('-')[0].toUpperCase();
        
        const bMatch = binanceTickers.find(t => t.symbol === token + 'USDT') ||
                       binanceTickers.find(t => t.symbol === token + 'USDC') ||
                       binanceTickers.find(t => t.symbol === token + 'FDUSD') ||
                       binanceTickers.find(t => t.symbol === token + 'BTC');

        if(bMatch) {
            if (!STATE.lastData[sym]) STATE.lastData[sym] = { symbol: sym };
            STATE.lastData[sym].price = parseFloat(bMatch.lastPrice);
            STATE.lastData[sym].changeDay = parseFloat(bMatch.priceChange);
            STATE.lastData[sym].changePct = parseFloat(bMatch.priceChangePercent);
            
            fetchBinanceHistoricalQuietly(sym, bMatch.symbol);
        } else {
            await fetchCoinGeckoFallback(sym, token);
        }
    });

    await Promise.all(cryptoPromises);
}

async function fetchCryptoLogosQuietly(cryptos) {
    const toFetch = cryptos.filter(sym => !STATE.lastData[sym]?.logoUrl);
    if(toFetch.length === 0) return;

    const knownIds = { 'L3':'layer3', 'LINEA':'linea', 'BNSOL':'binance-staked-sol', 'TAO':'bittensor', 'TON':'the-open-network' };
    const ids = toFetch.map(sym => {
        const token = sym.split('-')[0].toUpperCase();
        return knownIds[token] || token.toLowerCase();
    }).join(',');

    try {
        const res = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}`);
        if (res.ok) {
            const data = await res.json();
            let updated = false;
            data.forEach(coin => {
                const matchedSym = toFetch.find(s => {
                    const t = s.split('-')[0].toUpperCase();
                    const mappedId = knownIds[t] || t.toLowerCase();
                    return mappedId === coin.id || t.toLowerCase() === coin.symbol.toLowerCase();
                });
                if (matchedSym && coin.image) {
                    if (!STATE.lastData[matchedSym]) STATE.lastData[matchedSym] = { symbol: matchedSym };
                    STATE.lastData[matchedSym].logoUrl = coin.image;
                    updated = true;
                }
            });
            if (updated) renderTable();
        }
    } catch (e) {}
}

async function fetchBinanceHistoricalQuietly(sym, pair) {
    try {
        const kRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1w&limit=52`);
        if(kRes.ok) {
            const kData = await kRes.json();
            if(kData && kData.length > 0) {
                let high52 = -Infinity, low52 = Infinity;
                kData.forEach(candle => {
                    let h = parseFloat(candle[2]), l = parseFloat(candle[3]);
                    if(h > high52) high52 = h; if(l < low52) low52 = l;
                });
                let price1Y = parseFloat(kData[0][4]); 
                let currPrice = STATE.lastData[sym].price;
                STATE.lastData[sym].high52 = high52;
                STATE.lastData[sym].low52 = low52;
                STATE.lastData[sym].change365 = currPrice - price1Y;
                STATE.lastData[sym].return1Y = price1Y ? ((currPrice - price1Y) / price1Y) * 100 : 0;
                renderTable(); 
            }
        }
    } catch(e){}
}

async function fetchCoinGeckoFallback(sym, token) {
    try {
        const knownIds = { 'L3':'layer3', 'LINEA':'linea', 'BNSOL':'binance-staked-sol' };
        let cgId = knownIds[token.toUpperCase()] || token.toLowerCase();

        if (!knownIds[token.toUpperCase()]) {
            const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${token}`);
            if(searchRes.ok) {
                const searchData = await searchRes.json();
                if(searchData.coins && searchData.coins.length > 0) {
                    const exactMatch = searchData.coins.find(c => c.symbol.toUpperCase() === token.toUpperCase());
                    cgId = exactMatch ? exactMatch.id : searchData.coins[0].id;
                }
            }
        }

        const marketRes = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${cgId}`);
        if(marketRes.ok) {
            const marketData = await marketRes.json();
            if(marketData && marketData.length > 0) {
                const coin = marketData[0];
                
                if (!STATE.lastData[sym]) STATE.lastData[sym] = { symbol: sym };
                STATE.lastData[sym].price = coin.current_price;
                STATE.lastData[sym].changeDay = coin.price_change_24h || 0;
                STATE.lastData[sym].changePct = coin.price_change_percentage_24h || 0;
                
                if(coin.image) STATE.lastData[sym].logoUrl = coin.image;
                renderTable(); 

                fetchCoinGeckoHistorical(sym, cgId, coin.current_price);
            }
        }
    } catch(e) {}
}

async function fetchCoinGeckoHistorical(sym, cgId, currentPrice) {
    try {
        const histRes = await fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=365&interval=daily`);
        if (histRes.ok) {
            const histData = await histRes.json();
            if (histData && histData.prices && histData.prices.length > 0) {
                const validPrices = histData.prices.map(p => p[1]).filter(p => p !== null && p !== undefined);
                if (validPrices.length > 0) {
                    const high52 = Math.max(...validPrices, currentPrice);
                    const low52 = Math.min(...validPrices, currentPrice);
                    
                    const price1Y = validPrices[0]; 
                    const change365 = currentPrice - price1Y;
                    const return1Y = price1Y ? (change365 / price1Y) * 100 : 0;
                    
                    STATE.lastData[sym].high52 = high52;
                    STATE.lastData[sym].low52 = low52;
                    STATE.lastData[sym].change365 = change365;
                    STATE.lastData[sym].return1Y = return1Y;
                    renderTable();
                }
            }
        }
    } catch (e) {}
}

function formatMarketCap(val) {
    if (val == null || isNaN(val)) return '—';
    // Finnhub metrics endpoint delivers value in Millions
    if (val >= 1000000) {
        return '$' + (val / 1000000).toFixed(2) + 'T';
    } else if (val >= 1000) {
        return '$' + (val / 1000).toFixed(2) + 'B';
    } else {
        return '$' + parseFloat(val).toFixed(2) + 'M';
    }
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';
    const currentList = STATE.watchlists[STATE.currentTab] || [];
    if (currentList.length === 0) { tbody.innerHTML = '<tr><td colspan="14" class="text-center">Watchlist empty</td></tr>'; return; }

    let items = currentList.map(sym => STATE.lastData[sym] || { symbol: sym });
    const origOrderCb = document.getElementById('orig-order-cb');
    
    if (!origOrderCb.checked && STATE.sortCol) {
        items.sort((a, b) => {
            let vA = a[STATE.sortCol], vB = b[STATE.sortCol];
            if (vA == null) return 1; if (vB == null) return -1;
            if (typeof vA === 'string') return STATE.sortAsc ? vA.localeCompare(vB) : vB.localeCompare(vA);
            return STATE.sortAsc ? vA - vB : vB - vA;
        });
    }

    items.forEach(item => tbody.appendChild(createRowElement(item)));
}

function createRowElement(item) {
    const tr = document.createElement('tr');
    tr.id = `row-${item.symbol}`; tr.draggable = true;
    
    const signDay = item.changeDay > 0 ? '+' : '';
    const sign365 = item.change365 > 0 ? '+' : '';

    const fmtMoney = (v) => v == null || isNaN(v) ? '—' : parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const fmtValue2D = (v) => v == null || isNaN(v) || v === '—' ? '—' : parseFloat(v).toFixed(2);
    const fmtPct = (v) => v == null || isNaN(v) ? '—' : parseFloat(v).toFixed(2) + '%';
    const getCol = (v) => v == null || isNaN(v) || v == 0 ? 'val-neutral' : v > 0 ? 'val-up' : 'val-down';

    const displaySymbol = item.symbol.includes('-') ? item.symbol.split('-')[0] : item.symbol;

    tr.innerHTML = `
        <td class="drag-handle" title="Drag to reorder">☰</td>
        <td><div class="logo-container">${getLogoHtml(item.symbol)}</div></td>
        <td class="symbol-col">${displaySymbol}</td>
        <td class="text-right">${fmtMoney(item.price)}</td>
        <td class="text-right ${getCol(item.changeDay)}">${signDay}${fmtMoney(item.changeDay)}</td>
        <td class="text-right ${getCol(item.changePct)}">${signDay}${fmtPct(item.changePct)}</td>
        <td class="text-right ${getCol(item.change365)}">${sign365}${fmtMoney(item.change365)}</td>
        <td class="text-right ${getCol(item.return1Y)}">${sign365}${fmtPct(item.return1Y)}</td>
        <td class="text-right">${fmtMoney(item.high52)}</td>
        <td class="text-right">${fmtMoney(item.low52)}</td>
        <td class="text-right">${fmtValue2D(item.peTtm)}</td>
        <td class="text-right">${fmtValue2D(item.peFwd)}</td>
        <td class="text-right">${formatMarketCap(item.marketCap)}</td>
        <td class="text-center"><button class="btn danger" onclick="removeSymbol('${item.symbol}')">✕</button></td>
    `;
    
    tr.addEventListener('dragstart', handleDragStart);
    tr.addEventListener('dragover', handleDragOver);
    tr.addEventListener('drop', handleDrop);
    tr.addEventListener('dragend', handleDragEnd);
    return tr;
}

function renderSkeleton() {
    const tbody = document.getElementById('table-body');
    const currentList = STATE.watchlists[STATE.currentTab] || [];
    if (currentList.length === 0) return;
    tbody.innerHTML = currentList.map(() => `<tr><td colspan="14"><div class="skeleton"></div></td></tr>`).join('');
}

function exportSyncCode() {
    const data = { watchlists: STATE.watchlists, currentTab: STATE.currentTab };
    prompt("Copy this Sync Code:", btoa(JSON.stringify(data)));
}
function importSyncCode() {
    const code = prompt("Paste your Sync Code here:");
    if (!code) return;
    try {
        const data = JSON.parse(atob(code));
        if (data && data.watchlists) {
            STATE.watchlists = data.watchlists;
            STATE.currentTab = data.currentTab || Object.keys(data.watchlists)[0];
            localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists));
            localStorage.setItem('currentTab', STATE.currentTab);
            renderTabs(); renderSkeleton(); fetchDataAllTabs(true);
            showAlert("Data imported successfully!");
        }
    } catch(e) { showAlert("Failed to import Sync Code."); }
}

let dragSourceEl = null;
function handleDragStart(e) { dragSourceEl = this; this.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/html', this.innerHTML); }
function handleDragOver(e) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const tbody = document.getElementById('table-body');
    const children = Array.from(tbody.children);
    if (this !== dragSourceEl) {
        const currIdx = children.indexOf(dragSourceEl), targetIdx = children.indexOf(this);
        if (currIdx < targetIdx) tbody.insertBefore(dragSourceEl, this.nextSibling); 
        else tbody.insertBefore(dragSourceEl, this);
    }
}
function handleDrop(e) { e.preventDefault(); }
function handleDragEnd() {
    this.classList.remove('dragging');
    STATE.watchlists[STATE.currentTab] = Array.from(document.getElementById('table-body').children).map(tr => tr.id.replace('row-', ''));
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists));
    document.getElementById('orig-order-cb').checked = true; STATE.sortCol = null; 
    updateSortIcons(); renderTable();
}
function setupDragAndDrop() { document.getElementById('table-body').addEventListener('dragover', e => e.preventDefault()); }
