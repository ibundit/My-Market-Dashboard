// State Management
const STATE = {
    // Default to a balanced tech/crypto portfolio 
    watchlist: JSON.parse(localStorage.getItem('watchlist')) || ['NVDA', 'ANET', 'SPY', 'BTC-USD'],
    refreshInterval: parseInt(localStorage.getItem('refreshInterval')) || 0,
    intervalId: null,
    cacheTTL: 12 * 60 * 60 * 1000, // 12 hours for time_series
    lastData: {}, 
    apiKey: localStorage.getItem('TWELVE_DATA_API_KEY') || ''
};

// API configuration limits (Free Tier: 8 credits / min)
const MAX_CREDITS_PER_MIN = 8;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initApiKey();
    initUI();
    fetchData();
});

function initApiKey() {
    if (!STATE.apiKey && window.APP_CONFIG && window.APP_CONFIG.TWELVE_DATA_API_KEY && window.APP_CONFIG.TWELVE_DATA_API_KEY !== 'PASTE_KEY_HERE') {
        STATE.apiKey = window.APP_CONFIG.TWELVE_DATA_API_KEY;
        localStorage.setItem('TWELVE_DATA_API_KEY', STATE.apiKey);
    }
    
    if (!STATE.apiKey) {
        const key = prompt("Please enter your Twelve Data API Key to start fetching live data:");
        if (key) {
            STATE.apiKey = key;
            localStorage.setItem('TWELVE_DATA_API_KEY', key);
        }
    }
}

function initUI() {
    document.getElementById('refresh-select').value = STATE.refreshInterval;
    
    // Event Listeners
    document.getElementById('add-btn').addEventListener('click', addSymbol);
    document.getElementById('symbol-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addSymbol();
    });
    
    document.getElementById('refresh-btn').addEventListener('click', () => {
        fetchData();
    });
    
    document.getElementById('refresh-select').addEventListener('change', (e) => {
        const newInterval = parseInt(e.target.value);
        if (newInterval > 0) {
            // Budget Check
            const requestsPerMin = 60 / newInterval;
            const requiredCredits = STATE.watchlist.length * requestsPerMin;
            
            if (requiredCredits > MAX_CREDITS_PER_MIN) {
                showAlert(`Cannot set auto-refresh. Your watchlist (${STATE.watchlist.length} symbols) at ${newInterval}s interval requires ${requiredCredits} credits/min. Free plan limit is ${MAX_CREDITS_PER_MIN}/min.`);
                e.target.value = STATE.refreshInterval; // Revert
                return;
            }
        }
        
        STATE.refreshInterval = newInterval;
        localStorage.setItem('refreshInterval', newInterval);
        setupAutoRefresh();
    });

    setupAutoRefresh();
    renderSkeleton();
}

function setupAutoRefresh() {
    if (STATE.intervalId) clearInterval(STATE.intervalId);
    
    if (STATE.refreshInterval > 0) {
        STATE.intervalId = setInterval(fetchData, STATE.refreshInterval * 1000);
    }
}

function showAlert(message) {
    const alerts = document.getElementById('alerts');
    const alertEl = document.createElement('div');
    alertEl.className = 'alert';
    alertEl.textContent = message;
    alerts.appendChild(alertEl);
    setTimeout(() => alertEl.remove(), 8000);
}

function updateStatus(status, text) {
    const dot = document.getElementById('connection-dot');
    const textEl = document.getElementById('market-status');
    
    dot.className = `dot ${status}`;
    textEl.textContent = text;
}

function addSymbol() {
    const input = document.getElementById('symbol-input');
    const symbol = input.value.trim().toUpperCase();
    
    if (!symbol) return;
    
    if (STATE.watchlist.includes(symbol)) {
        showAlert(`${symbol} is already in the watchlist.`);
        input.value = '';
        return;
    }
    
    // Check quota before adding if auto-refresh is on
    if (STATE.refreshInterval > 0) {
        const requiredCredits = (STATE.watchlist.length + 1) * (60 / STATE.refreshInterval);
        if (requiredCredits > MAX_CREDITS_PER_MIN) {
            showAlert(`Adding ${symbol} exceeds the API rate limit for your current auto-refresh setting. Please disable or lower auto-refresh first.`);
            return;
        }
    }
    
    STATE.watchlist.push(symbol);
    localStorage.setItem('watchlist', JSON.stringify(STATE.watchlist));
    input.value = '';
    
    renderSkeleton();
    fetchData();
}

window.removeSymbol = function(symbol) {
    STATE.watchlist = STATE.watchlist.filter(s => s !== symbol);
    localStorage.setItem('watchlist', JSON.stringify(STATE.watchlist));
    
    // Remove from UI immediately
    const row = document.getElementById(`row-${symbol}`);
    if (row) row.remove();
    
    // If empty, show message
    if (STATE.watchlist.length === 0) {
        document.getElementById('table-body').innerHTML = '<tr><td colspan="11" class="text-center">Watchlist is empty. Add a symbol above.</td></tr>';
    }
};

// Utils
const formatSymbolForApi = (sym) => sym.includes('-') ? sym.replace('-', '/') : sym;
const formatSymbolForUI = (sym) => sym.includes('/') ? sym.replace('/', '-') : sym;
const formatMoney = (val) => val === undefined || val === null || isNaN(val) ? '—' : parseFloat(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatPercent = (val) => val === undefined || val === null || isNaN(val) ? '—' : parseFloat(val).toFixed(2) + '%';
const formatNumber = (val) => val === undefined || val === null || isNaN(val) ? '—' : parseFloat(val).toFixed(2);

function getColorClass(value) {
    if (value === undefined || value === null || isNaN(value) || value == 0) return 'val-neutral';
    return value > 0 ? 'val-up' : 'val-down';
}

async function fetchData() {
    if (!STATE.apiKey) {
        updateStatus('red', 'Missing API Key');
        return;
    }
    if (STATE.watchlist.length === 0) {
        updateStatus('yellow', 'No symbols in watchlist');
        return;
    }

    updateStatus('yellow', 'Fetching...');
    
    try {
        const apiSymbols = STATE.watchlist.map(formatSymbolForApi).join(',');
        
        // 1. Fetch live quotes
        const quoteRes = await fetch(`https://api.twelvedata.com/quote?symbol=${apiSymbols}&apikey=${STATE.apiKey}`);
        const quoteData = await quoteRes.json();
        
        if (quoteData.status === 'error') {
            throw new Error(quoteData.message || 'Rate limit exceeded');
        }

        // Normalize response (single vs multiple)
        let quotes = {};
        if (STATE.watchlist.length === 1) {
            quotes[formatSymbolForUI(quoteData.symbol)] = quoteData;
        } else {
            for (const key in quoteData) {
                quotes[formatSymbolForUI(key)] = quoteData[key];
            }
        }

        // 2. Fetch 1-year historical data for 365d metrics (using Cache to save credits)
        await fetchHistoricalData(STATE.watchlist);

        // 3. Merge and Render
        const now = new Date();
        document.getElementById('last-updated-time').textContent = now.toLocaleTimeString();
        updateStatus('green', 'Connected');
        
        renderTable(quotes);

    } catch (error) {
        console.error('Fetch error:', error);
        updateStatus('red', 'Connection Error or Rate Limited');
        showAlert(`Failed to fetch data: ${error.message}. Retaining last known values where possible.`);
        
        // Render with last known data if available
        if (Object.keys(STATE.lastData).length > 0) {
            renderTable(STATE.lastData);
        }
    }
}

async function fetchHistoricalData(symbols) {
    const today = new Date().toISOString().split('T')[0];
    
    for (const sym of symbols) {
        const apiSym = formatSymbolForApi(sym);
        const cacheKey = `ts_${sym}_${today}`;
        
        // Check cache
        const cached = localStorage.getItem(cacheKey);
        if (cached) continue; // We have today's historical reference

        try {
            // Fetch weekly data to minimize payload but still get 1 year ago reliably
            const res = await fetch(`https://api.twelvedata.com/time_series?symbol=${apiSym}&interval=1week&outputsize=54&apikey=${STATE.apiKey}`);
            const data = await res.json();
            
            if (data.status === 'error') {
                console.warn(`Could not fetch historical for ${sym}:`, data.message);
                continue;
            }

            // Find price closest to 365 days ago
            const oneYearAgoMs = Date.now() - (365 * 24 * 60 * 60 * 1000);
            let closestPrice = null;
            let minDiff = Infinity;
            
            if (data.values && data.values.length > 0) {
                for (let val of data.values) {
                    let time = new Date(val.datetime).getTime();
                    let diff = Math.abs(time - oneYearAgoMs);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestPrice = parseFloat(val.close);
                    }
                }
            }
            
            if (closestPrice) {
                localStorage.setItem(cacheKey, JSON.stringify({ price1YearAgo: closestPrice }));
            }
            
        } catch (err) {
            console.error(`History fetch failed for ${sym}`, err);
        }
    }
}

function renderSkeleton() {
    const tbody = document.getElementById('table-body');
    if (STATE.watchlist.length === 0) return;
    
    tbody.innerHTML = '';
    STATE.watchlist.forEach(sym => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div class="skeleton skeleton-text" style="width: 50px;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 120px;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 70px; margin-left: auto;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 60px; margin-left: auto;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 50px; margin-left: auto;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 60px; margin-left: auto;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 50px; margin-left: auto;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 60px; margin-left: auto;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 60px; margin-left: auto;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 40px; margin-left: auto;"></div></td>
            <td><div class="skeleton skeleton-text" style="width: 20px; margin: 0 auto;"></div></td>
        `;
        tbody.appendChild(tr);
    });
}

function renderTable(quotesData) {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';
    
    const today = new Date().toISOString().split('T')[0];

    STATE.watchlist.forEach(sym => {
        const q = quotesData[sym];
        
        // Preserve last known state if rate limited per-symbol
        if (q && q.status !== 'error') {
            STATE.lastData[sym] = q;
        }
        
        const data = STATE.lastData[sym];
        
        if (!data) {
            // Render unavailable state
            tbody.innerHTML += renderRow(sym, {}, null);
            return;
        }

        // Calculate 1 Year metrics
        let price1YearAgo = null;
        const cacheStr = localStorage.getItem(`ts_${sym}_${today}`);
        if (cacheStr) {
            try {
                price1YearAgo = JSON.parse(cacheStr).price1YearAgo;
            } catch(e){}
        }

        const currentPrice = parseFloat(data.close);
        let change365 = null;
        let return1Y = null;

        if (price1YearAgo && !isNaN(currentPrice)) {
            change365 = currentPrice - price1YearAgo;
            return1Y = (change365 / price1YearAgo) * 100;
        }

        tbody.innerHTML += renderRow(sym, data, { change365, return1Y });
    });
}

function renderRow(sym, quote, history) {
    const isError = !quote || Object.keys(quote).length === 0;
    
    const price = isError ? null : quote.close;
    const changeDay = isError ? null : quote.change;
    const changePct = isError ? null : quote.percent_change;
    const high52 = isError || !quote.fifty_two_week ? null : quote.fifty_two_week.high;
    const low52 = isError || !quote.fifty_two_week ? null : quote.fifty_two_week.low;
    const pe = isError ? null : quote.pe;
    
    const change365 = history ? history.change365 : null;
    const return1Y = history ? history.return1Y : null;

    // Determine prefix for styling
    const signDay = changeDay > 0 ? '+' : '';
    const sign365 = change365 > 0 ? '+' : '';

    return `
        <tr id="row-${sym}">
            <td class="symbol-col">${sym}</td>
            <td class="name-col" title="${quote.name || '—'}">${quote.name || '—'}</td>
            <td class="text-right">${formatMoney(price)}</td>
            <td class="text-right ${getColorClass(changeDay)}">${signDay}${formatMoney(changeDay)}</td>
            <td class="text-right ${getColorClass(changePct)}">${signDay}${formatPercent(changePct)}</td>
            <td class="text-right ${getColorClass(change365)}">${sign365}${formatMoney(change365)}</td>
            <td class="text-right ${getColorClass(return1Y)}">${sign365}${formatPercent(return1Y)}</td>
            <td class="text-right">${formatMoney(high52)}</td>
            <td class="text-right">${formatMoney(low52)}</td>
            <td class="text-right">${formatNumber(pe)}</td>
            <td class="text-center">
                <button class="btn danger" onclick="removeSymbol('${sym}')" title="Remove">✕</button>
            </td>
        </tr>
    `;
}
