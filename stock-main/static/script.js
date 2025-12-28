const searchBtn = document.getElementById('searchBtn');
const symbolInput = document.getElementById('symbolInput');
const loading = document.getElementById('loading');
const dashboard = document.getElementById('dashboard');
const errorDiv = document.getElementById('error');

let priceChart = null;

searchBtn.addEventListener('click', handleSearch);
symbolInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
});

async function handleSearch() {
    const symbol = symbolInput.value.trim().toUpperCase();
    if (!symbol) return;

    // Reset State
    dashboard.classList.add('hidden');
    errorDiv.classList.add('hidden');
    loading.classList.remove('hidden');

    try {
        // Fetch Quote
        const quoteResponse = await fetch(`/api/quote/${symbol}`);
        if (!quoteResponse.ok) throw new Error('Stock not found or API error');
        const quoteData = await quoteResponse.json();

        // Fetch History
        const historyResponse = await fetch(`/api/history/${symbol}`);
        let historyData = [];
        if (historyResponse.ok) {
            historyData = await historyResponse.json();
        }

        renderDashboard(quoteData, historyData);

        // Fetch Ratios (Async, don't block main dashboard)
        fetchRatios(symbol);

    } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.classList.remove('hidden');
    } finally {
        loading.classList.add('hidden');
    }
}

async function fetchRatios(symbol) {
    const fundSection = document.getElementById('fundamentalsSection');
    // Keep it hidden or show loading state if you prefer. 
    // Here we show it regardless but with '--' until loaded.
    fundSection.classList.remove('hidden');

    try {
        const response = await fetch(`/api/ratios/${symbol}`);
        if (response.ok) {
            const data = await response.json();

            // Populate Valuation
            document.getElementById('ratioPE').textContent = data.Valuation["P/E"];
            document.getElementById('ratioPEG').textContent = data.Valuation["PEG"];
            document.getElementById('ratioPB').textContent = data.Valuation["P/B"];

            // Populate Profitability
            document.getElementById('ratioROE').textContent = data.Profitability["ROE"];
            document.getElementById('ratioROA').textContent = data.Profitability["ROA"];
            document.getElementById('ratioMargin').textContent = data.Profitability["Net Margin"];

            // Populate Liquidity/Leverage
            document.getElementById('ratioCurrent').textContent = data.Liquidity["Current Ratio"];
            document.getElementById('ratioDebtEq').textContent = data.Leverage["Debt/Equity"];
        }
    } catch (e) {
        console.error("Failed to load ratios", e);
    }
}

function renderDashboard(data, history) {
    dashboard.classList.remove('hidden');

    // Check data structure from nsepython (it varies, so we need to be defensive or inspect it)
    // Assuming standard response for now. nsepython usually returns a dict.
    // 'priceInfo' usually contains 'lastPrice', 'change', 'pChange'
    // But sometimes it's direct keys. Logic below depends on inspecting real response.
    // I'll assume the structure 'priceInfo' exists or top level keys.

    // DEBUG: Console log to see structure in browser if needed
    console.log('Quote Data:', data);

    // Adapting to common NSE API structure
    const price = data.priceInfo ? data.priceInfo.lastPrice : data.lastPrice;
    const change = data.priceInfo ? data.priceInfo.change : data.change;
    const pChange = data.priceInfo ? data.priceInfo.pChange : data.pChange;
    const open = data.priceInfo ? data.priceInfo.open : data.open;
    const close = data.priceInfo ? data.priceInfo.close : data.closePrice; // or previousClose
    const dayHigh = data.priceInfo ? data.priceInfo.intraDayHighLow.max : (data.dayHigh || data.high);
    const dayLow = data.priceInfo ? data.priceInfo.intraDayHighLow.min : (data.dayLow || data.low);
    const symbol = data.symbol || data.info.symbol;
    const updateTime = data.metadata ? data.metadata.lastUpdateTime : new Date().toLocaleTimeString();

    // Populate DOM
    document.getElementById('stockSymbol').textContent = symbol;
    document.getElementById('stockPrice').textContent = formatCurrency(price);

    const changeEl = document.getElementById('stockChange');
    changeEl.textContent = `${change > 0 ? '+' : ''}${change.toFixed(2)} (${pChange.toFixed(2)}%)`;
    changeEl.className = `change ${change >= 0 ? 'positive' : 'negative'}`;

    document.getElementById('lastUpdateTime').textContent = `Last Updated: ${updateTime}`;

    document.getElementById('statOpen').textContent = formatCurrency(open);
    document.getElementById('statHigh').textContent = formatCurrency(dayHigh);
    document.getElementById('statLow').textContent = formatCurrency(dayLow);

    // For Previous Close
    document.getElementById('statPrevClose').textContent = formatCurrency(close);

    renderChart(history);
    renderDayWiseAnalysis(history);
}

function formatCurrency(val) {
    if (val === undefined || val === null) return '--';
    return '₹' + parseFloat(val).toLocaleString('en-IN');
}

function renderDayWiseAnalysis(history) {
    const tbody = document.querySelector('#analysisTable tbody');
    tbody.innerHTML = '';

    if (!Array.isArray(history) || history.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">No historical data available</td></tr>';
        return;
    }

    // Sort to show newest first for the table
    const sorted = history.slice(); // Assuming API returns oldest to newest or we trust the order. Usually we want newest on top.
    // If backend returns oldest->newest, we might want to reverse for table (newest first)
    // Let's assume input is oldest->newest, so reverse for table.
    // However, in main.py we didn't sort. nsepython equity_history usually returns oldest first.
    // Let's safe sort by date if possible, or just reverse.
    sorted.reverse();

    sorted.forEach(day => {
        const row = document.createElement('tr');

        // Use standardized keys from backend
        const date = day.Date || day.CH_TIMESTAMP;
        const open = day.Open || day.CH_OPENING_PRICE;
        const high = day.High || day.CH_TRADE_HIGH_PRICE;
        const low = day.Low || day.CH_TRADE_LOW_PRICE;
        const close = day.Close || day.CH_CLOSING_PRICE;

        if (date) {
            row.innerHTML = `
                <td>${date}</td>
                <td>${formatCurrency(open)}</td>
                <td>${formatCurrency(high)}</td>
                <td>${formatCurrency(low)}</td>
                <td>${formatCurrency(close)}</td>
            `;
            tbody.appendChild(row);
        }
    });
}

function renderChart(history) {
    const ctx = document.getElementById('priceChart').getContext('2d');

    if (priceChart) {
        priceChart.destroy();
    }

    let labels = [];
    let prices = [];

    if (Array.isArray(history)) {
        // For chart we want Oldest -> Newest (Left -> Right)
        // If history is oldest first (standard), we keep it.
        const dataset = history.slice();

        dataset.forEach(day => {
            // Updated to use standardized keys from main.py
            const date = day.Date;
            let close = day.Close;

            if (date && close !== undefined && close !== null) {
                if (typeof close === 'string') {
                    close = parseFloat(close.replace(/,/g, ''));
                }

                if (!isNaN(close)) {
                    labels.push(date);
                    prices.push(close);
                }
            }
        });
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(56, 189, 248, 0.5)');
    gradient.addColorStop(1, 'rgba(56, 189, 248, 0)');

    priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Closing Price',
                data: prices,
                borderColor: '#38bdf8',
                backgroundColor: gradient,
                borderWidth: 2,
                pointRadius: 3,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#94a3b8',
                    bodyColor: '#f1f5f9',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#94a3b8'
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#94a3b8'
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

// --- Ratios Tooltip Logic ---

const RATIO_DEFINITIONS = {
    'PE': {
        title: 'Price to Earnings (P/E) Ratio',
        desc: 'Measures the current share price relative to its per-share earnings. A high P/E could mean that a company\'s stock is over-valued, or else that investors are expecting high growth rates in the future.'
    },
    'PEG': {
        title: 'PEG Ratio',
        desc: 'The price/earnings to growth ratio (PEG ratio) is a stock\'s price-to-earnings (P/E) ratio divided by the growth rate of its earnings for a specified time period. A PEG ratio below 1.0 indicates a stock may be undervalued.'
    },
    'PB': {
        title: 'Price to Book (P/B) Ratio',
        desc: 'Compares a company\'s market capitalization to its book value. It differs from P/E because it looks at the value of assets rather than earnings. Useful for finding undervalued companies.'
    },
    'ROE': {
        title: 'Return on Equity (ROE)',
        desc: 'Measures financial performance calculated by dividing net income by shareholders\' equity. It gauges a corporation\'s profitability and how efficiently it generates those profits.'
    },
    'ROA': {
        title: 'Return on Assets (ROA)',
        desc: 'Percentage of how profitable a company\'s assets are in generating revenue. Helps investors measure how effectively a company is converting the money it has to invest into net income.'
    },
    'Margin': {
        title: 'Net Profit Margin',
        desc: 'The percentage of revenue the company retains after all expenses are deducted. Higher margins mean the company is more efficient at converting sales into actual profit.'
    },
    'CurrentRatio': {
        title: 'Current Ratio',
        desc: 'A liquidity ratio that measures a company\'s ability to pay short-term obligations or those due within one year. A ratio under 1 indicates the company may have problems meeting its short-term obligations.'
    },
    'DebtEq': {
        title: 'Debt to Equity Ratio',
        desc: 'Shows the proportion of equity and debt used to finance a company\'s assets. A high ratio indicates the company is leveraged (high debt), which implies higher financial risk.'
    }
};

const modal = document.getElementById('infoModal');
const modalTitle = document.getElementById('modalTitle');
const modalDesc = document.getElementById('modalDesc');

function showInfo(key) {
    const info = RATIO_DEFINITIONS[key];
    if (info) {
        modalTitle.textContent = info.title;
        modalDesc.textContent = info.desc;
        modal.classList.remove('hidden');
    }
}

function closeInfo() {
    modal.classList.add('hidden');
}

// Close modal if clicked outside content
window.onclick = function (event) {
    if (event.target == modal) {
        closeInfo();
    }
}
