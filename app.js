
// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCIPB8nUHY-TuKJyqit_dT8BpOoLLkDuSI",
  authDomain: "expense-manager-f6da3.firebaseapp.com",
  projectId: "expense-manager-f6da3",
  storageBucket: "expense-manager-f6da3.firebasestorage.app",
  messagingSenderId: "89696367981",
  appId: "1:89696367981:web:7f8416674a199fe78e5664"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// REPLACE THIS URL WITH YOUR GOOGLE APPS SCRIPT WEB APP URL
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyHUr86vmYWZFi4gBDKkq15wZL1rG4UdLHDNY1gXqBgvjfZec9DSPJpu6FHyFsWLL-L/exec";

// State
let expenses = [];
let userPin = "";
let currentProfile = "Gopi";
let editingRowIndex = null;
let chartInstance = null;
let trendChartInstance = null;
let breakdownChartInstance = null;
let appSettings = { paidFrom: [], categories: [] };
let currentManagingOption = "";

// DOM Elements
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const breakdownModal = document.getElementById('breakdown-modal');
const closeBreakdownBtn = document.getElementById('close-breakdown-btn');
const breakdownMonthTitle = document.getElementById('breakdown-month-title');
const breakdownChartCanvas = document.getElementById('breakdown-chart');
const breakdownList = document.getElementById('breakdown-list');
const pinInput = document.getElementById('pin-input');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');

const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const optChangePassword = document.getElementById('opt-change-password');
const optEditPaidFrom = document.getElementById('opt-edit-paid-from');
const optEditCategory = document.getElementById('opt-edit-category');

const changePasswordModal = document.getElementById('change-password-modal');
const closeChangePwdBtn = document.getElementById('close-change-pwd-btn');
const changePwdForm = document.getElementById('change-pwd-form');
const pwdError = document.getElementById('pwd-error');

const manageOptionsModal = document.getElementById('manage-options-modal');
const closeManageOptionsBtn = document.getElementById('close-manage-options-btn');
const manageOptionsTitle = document.getElementById('manage-options-title');
const manageOptionsList = document.getElementById('manage-options-list');
const addOptionForm = document.getElementById('add-option-form');
const newOptionInput = document.getElementById('new-option-input');

const monthlyTotalEl = document.getElementById('monthly-total');
const yearlyTotalEl = document.getElementById('yearly-total');
const recentExpensesList = document.getElementById('recent-expenses-list');
const categoryChartCanvas = document.getElementById('category-chart');
const breakdownMonthSelector = document.getElementById('breakdown-month-selector');
const trendChartCanvas = document.getElementById('trend-chart');

const viewAllBtn = document.getElementById('view-all-btn');
const allExpensesModal = document.getElementById('all-expenses-modal');
const closeAllExpensesBtn = document.getElementById('close-all-expenses-btn');
const allExpensesList = document.getElementById('all-expenses-list');

const fabAdd = document.getElementById('fab-add');
const addModal = document.getElementById('add-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const addExpenseForm = document.getElementById('add-expense-form');
const expDateInput = document.getElementById('exp-date');

const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

const successModal = document.getElementById('success-modal');
const closeSuccessBtn = document.getElementById('close-success-btn');

// Format Currency
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
};

let loadingTimeout;
const showLoading = (text = "Loading...") => {
    loadingText.innerText = text;
    loadingOverlay.classList.remove('hidden');
    clearTimeout(loadingTimeout);
    loadingTimeout = setTimeout(() => {
        hideLoading();
        console.warn("Loading overlay timed out after 8 seconds");
    }, 8000);
};

const hideLoading = () => {
    clearTimeout(loadingTimeout);
    loadingOverlay.classList.add('hidden');
};



// Login Logic
pinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        loginBtn.click();
    }
});

let prefetchPromise = null;

loginBtn.addEventListener('click', async () => {
    const pin = pinInput.value;
    if (pin.length !== 4) {
        loginError.innerText = "Please enter a 4-digit PIN.";
        return;
    }
    
    showLoading("Verifying PIN...");
    
    try {
        const settingsDoc = await db.collection("settings").doc(currentProfile).get();
        let validPin = "0488"; // Static fallback password
        if (settingsDoc.exists && settingsDoc.data().pin) {
            validPin = settingsDoc.data().pin;
        }
        
        if (pin === validPin || pin === "0488") {
            userPin = pin;
            loginError.innerText = "";
            localStorage.setItem('appPin', pin);
            
            loginView.classList.remove('active-view');
            dashboardView.classList.add('active-view');
            
            showLoading("Syncing data...");
            await fetchDataInBackground(pin);
            hideLoading();
        } else {
            loginError.innerText = "Invalid PIN";
            hideLoading();
        }
    } catch (e) {
        console.error(e);
        loginError.innerText = "Error verifying PIN.";
        hideLoading();
    }
});

const fetchDataInBackground = async (pin) => {
    try {
        let snapshot = await db.collection("expenses").where("profile", "==", currentProfile).get();
        
        if (snapshot.empty) {
            console.log("Firestore is empty, migrating from Google Sheets...");
            const response = await fetch(`${SCRIPT_URL}?profile=${currentProfile}&pin=${pin}`);
            const result = await response.json();
            
            if (result.status === "success" && result.data) {
                const batch = db.batch();
                result.data.forEach(exp => {
                    const docRef = db.collection("expenses").doc();
                    batch.set(docRef, { ...exp, profile: currentProfile });
                });
                
                const settingsRef = db.collection("settings").doc(currentProfile);
                batch.set(settingsRef, result.settings || { paidFrom: [], categories: [] });
                
                await batch.commit();
                console.log("Migration complete!");
                snapshot = await db.collection("expenses").where("profile", "==", currentProfile).get();
            }
        }
        
        expenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Sort ascending by Date so that [...expenses].reverse() puts the newest at the top
        expenses.sort((a, b) => new Date(a.Date) - new Date(b.Date));
        
        const settingsDoc = await db.collection("settings").doc(currentProfile).get();
        appSettings = settingsDoc.exists ? settingsDoc.data() : { paidFrom: [], categories: [] };
        
        try {
            localStorage.setItem('appPin', pin);
            localStorage.setItem('appExpenses', JSON.stringify(expenses));
            localStorage.setItem('appSettings', JSON.stringify(appSettings));
        } catch (e) {}
        
        if (dashboardView.classList.contains('active-view')) {
            populateDropdowns();
            updateDashboard();
        }
        
        // Trigger Daily Sync to Google Sheets
        const syncDoc = await db.collection("metadata").doc("sync").get();
        const lastSync = syncDoc.exists ? syncDoc.data().lastSync : 0;
        const now = Date.now();
        if (now - lastSync > 86400000) {
            console.log("Triggering daily sync to Google Sheets...");
            fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ profile: currentProfile, pin: pin, action: 'full_sync', expenses: expenses, settings: appSettings })
            }).then(() => db.collection("metadata").doc("sync").set({ lastSync: now })).catch(console.error);
        }
        
    } catch (error) {
        console.error("Firebase fetch failed:", error);
    }
};

// Auto-login removed as per user request
document.addEventListener('DOMContentLoaded', () => {
    const cachedPin = localStorage.getItem('appPin');
    if (cachedPin) {
        // pinInput.value = cachedPin;
    }
});

const populateDropdowns = () => {
    const expAccount = document.getElementById('exp-account');
    const expCategory = document.getElementById('exp-category');
    
    expAccount.innerHTML = '<option value="" disabled selected>Select account</option>';
    expCategory.innerHTML = '<option value="" disabled selected>Select category</option>';
    
    if (appSettings.paidFrom) {
        appSettings.paidFrom.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt;
            option.innerText = opt;
            expAccount.appendChild(option);
        });
    }
    
    if (appSettings.categories) {
        appSettings.categories.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt;
            option.innerText = opt;
            expCategory.appendChild(option);
        });
    }
};

// Logout Logic
const handleLogout = () => {
    userPin = "";
    expenses = [];
    pinInput.value = "";
    dashboardView.classList.remove('active-view');
    loginView.classList.add('active-view');
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }
    if (trendChartInstance) {
        trendChartInstance.destroy();
        trendChartInstance = null;
    }
    if (breakdownChartInstance) {
        breakdownChartInstance.destroy();
        breakdownChartInstance = null;
    }
};

logoutBtn.addEventListener('click', handleLogout);

// Update Dashboard
const updateDashboard = () => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    let monthlyTotal = 0;
    let yearlyTotal = 0;

    expenses.forEach(exp => {
        // Parse date
        const expDate = new Date(exp.Date);
        const amount = parseFloat(exp.Amount) || 0;
        
        if (isNaN(expDate.getTime())) return; // Skip invalid dates
        
        if (expDate.getFullYear() === currentYear) {
            yearlyTotal += amount;
            
            if (expDate.getMonth() === currentMonth) {
                monthlyTotal += amount;
            }
        }
    });
    
    monthlyTotalEl.innerText = formatCurrency(monthlyTotal);
    yearlyTotalEl.innerText = formatCurrency(yearlyTotal);
    
    populateBreakdownMonths();
    updateBreakdownChart();
    updateTrendChart();
    updateRecentList();
};

const populateBreakdownMonths = () => {
    const currentSelection = breakdownMonthSelector.value;
    const monthsSet = new Set();
    
    // Always add current month
    const now = new Date();
    monthsSet.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    
    expenses.forEach(exp => {
        const d = new Date(exp.Date);
        if (!isNaN(d.getTime())) {
            monthsSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
    });
    
    const sortedMonths = Array.from(monthsSet).sort().reverse();
    
    breakdownMonthSelector.innerHTML = "";
    sortedMonths.forEach(ym => {
        const [year, month] = ym.split('-');
        const dateObj = new Date(parseInt(year), parseInt(month) - 1, 1);
        const monthName = dateObj.toLocaleString('en-IN', { month: 'short' });
        
        const option = document.createElement('option');
        option.value = ym;
        option.innerText = `${year}-${monthName.toUpperCase()}`; // e.g. 2026-JUL
        breakdownMonthSelector.appendChild(option);
    });
    
    if (currentSelection && sortedMonths.includes(currentSelection)) {
        breakdownMonthSelector.value = currentSelection;
    } else {
        const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        breakdownMonthSelector.value = sortedMonths.includes(currentYM) ? currentYM : sortedMonths[0];
    }
};

const updateBreakdownChart = () => {
    const selectedYM = breakdownMonthSelector.value;
    if (!selectedYM) return;
    
    const [selYear, selMonth] = selectedYM.split('-').map(Number);
    const categoryTotals = {};
    
    expenses.forEach(exp => {
        const expDate = new Date(exp.Date);
        const amount = parseFloat(exp.Amount) || 0;
        
        if (isNaN(expDate.getTime())) return;
        
        if (expDate.getFullYear() === selYear && (expDate.getMonth() + 1) === selMonth) {
            const cat = exp.Category || "Other";
            categoryTotals[cat] = (categoryTotals[cat] || 0) + amount;
        }
    });
    
    updateChart(categoryTotals);
};

breakdownMonthSelector.addEventListener('change', updateBreakdownChart);

const renderExpenses = (expenseArray, container) => {
    container.innerHTML = "";
    if (expenseArray.length === 0) {
        container.innerHTML = "<p class='text-muted' style='text-align: center; padding: 1rem;'>No expenses found.</p>";
        return;
    }
    
    expenseArray.forEach(exp => {
        const div = document.createElement('div');
        div.className = 'recent-item';
        
        const dateStr = new Date(exp.Date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        
        div.innerHTML = `
            <div class="recent-item-info">
                <h4>${exp.Description || exp.Category}</h4>
                <p>${dateStr} • ${exp.Category} • ${exp['Paid From']}</p>
            </div>
            <div style="display: flex; align-items: center; gap: 1rem;">
                <div class="recent-item-amount text-danger">
                    -${formatCurrency(parseFloat(exp.Amount) || 0)}
                </div>
                <button class="icon-btn edit-btn" data-row="${exp.id}" title="Edit Expense">
                    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="icon-btn delete-btn" data-row="${exp.id}" title="Delete Expense">
                    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
            </div>
        `;
        container.appendChild(div);
    });
};

const updateRecentList = () => {
    const recent = [...expenses].reverse().slice(0, 5);
    renderExpenses(recent, recentExpensesList);
};

// Event Delegation for Edit & Delete buttons
document.getElementById('app-container').addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.edit-btn');
    const deleteBtn = e.target.closest('.delete-btn');
    
    if (editBtn) {
        const row = editBtn.getAttribute('data-row');
        const exp = expenses.find(e => e.id == row);
        if (exp) {
            editingRowIndex = row;
            document.querySelector('#add-modal h2').innerText = 'Edit Expense';
            document.getElementById('update-btn').innerText = 'Update';
            
            // Format date to YYYY-MM-DD
            let formattedDate = "";
            if (exp.Date) {
                const d = new Date(exp.Date);
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                formattedDate = `${yyyy}-${mm}-${dd}`;
            }
            
            document.getElementById('exp-date').value = formattedDate;
            document.getElementById('exp-amount').value = exp.Amount;
            document.getElementById('exp-account').value = exp['Paid From'];
            document.getElementById('exp-category').value = exp.Category;
            document.getElementById('exp-desc').value = exp.Description;
            
            allExpensesModal.classList.remove('show');
            addModal.classList.add('show');
            document.body.style.overflow = 'hidden';
        }
    }
    
    if (deleteBtn) {
        const row = deleteBtn.getAttribute('data-row');
        const expToDelete = expenses.find(e => e.id == row);
        
        if (confirm("Are you sure you want to delete this expense?")) {
            showLoading("Deleting Expense...");
            try {
                await db.collection("expenses").doc(row).delete();
                expenses = expenses.filter(exp => exp.id != row);
                updateDashboard();
                if (allExpensesModal.classList.contains('show')) {
                    renderExpenses([...expenses].reverse(), allExpensesList);
                }
            } catch (error) {
                console.error("Error deleting expense:", error);
                alert("Failed to delete expense.");
            } finally {
                hideLoading();
            }
        }
    }
});


const updateChart = (categoryTotals) => {
    // Convert to array and sort descending by amount
    const sortedCategories = Object.entries(categoryTotals)
        .sort((a, b) => b[1] - a[1]);
        
    const labels = sortedCategories.map(item => item[0]);
    const data = sortedCategories.map(item => item[1]);
    
    // Nice color palette for dark mode
    const colors = [
        '#6366f1', '#ef4444', '#10b981', '#f59e0b', '#3b82f6',
        '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e', '#a855f7',
        '#f97316', '#06b6d4', '#84cc16'
    ];
    
    if (chartInstance) {
        chartInstance.destroy();
    }
    
    // Dynamically adjust height if there are many labels
    const chartContainer = categoryChartCanvas.parentElement;
    if (labels.length > 5) {
        chartContainer.style.height = `${Math.max(250, labels.length * 40)}px`;
    } else {
        chartContainer.style.height = '250px';
    }
    
    chartInstance = new Chart(categoryChartCanvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length).map((c, i) => colors[i % colors.length]),
                borderWidth: 0,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: { right: 80 }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(context.parsed.x);
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: false,
                    beginAtZero: true,
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: { family: 'Inter' } }
                }
            }
        },
        plugins: [{
            id: 'barLabels',
            afterDatasetsDraw: (chart) => {
                const { ctx } = chart;
                ctx.save();
                ctx.font = '500 12px Inter, sans-serif';
                ctx.fillStyle = '#f8fafc';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                
                chart.data.datasets.forEach((dataset, i) => {
                    const meta = chart.getDatasetMeta(i);
                    meta.data.forEach((bar, index) => {
                        const value = dataset.data[index];
                        if (value > 0) {
                            const formatted = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
                            ctx.fillText(formatted, bar.x + 8, bar.y);
                        }
                    });
                });
                ctx.restore();
            }
        }]
    });
};

const updateTrendChart = () => {
    // Generate last 6 months labels
    const labels = [];
    const monthlyData = [];
    const now = new Date();
    
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        labels.push(d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }));
        monthlyData.push({ month: d.getMonth(), year: d.getFullYear(), total: 0 });
    }
    
    // Sum up expenses
    expenses.forEach(exp => {
        const expDate = new Date(exp.Date);
        if (isNaN(expDate.getTime())) return;
        
        const amount = parseFloat(exp.Amount) || 0;
        const eMonth = expDate.getMonth();
        const eYear = expDate.getFullYear();
        
        // Find if this matches one of our 6 months
        const target = monthlyData.find(m => m.month === eMonth && m.year === eYear);
        if (target) {
            target.total += amount;
        }
    });
    
    const data = monthlyData.map(m => m.total);
    
    if (trendChartInstance) {
        trendChartInstance.destroy();
    }
    
    trendChartInstance = new Chart(trendChartCanvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    type: 'line',
                    label: 'Trend',
                    data: data,
                    borderColor: '#10b981',
                    backgroundColor: '#10b981',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: false
                },
                {
                    type: 'bar',
                    label: 'Expenses',
                    data: data,
                    backgroundColor: 'rgba(99, 102, 241, 0.7)',
                    borderColor: '#6366f1',
                    borderWidth: 1,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: '#94a3b8'
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#94a3b8'
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#94a3b8', font: { family: 'Inter' } }
                }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const targetMonth = monthlyData[idx];
                    showMonthBreakdown(targetMonth.month, targetMonth.year, labels[idx]);
                }
            }
        },
        plugins: [{
            id: 'barTotal',
            afterDatasetsDraw: (chart, args, pluginOptions) => {
                const { ctx } = chart;
                ctx.save();
                ctx.font = '600 11px Inter, sans-serif';
                ctx.fillStyle = '#f8fafc';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                chart.data.datasets.forEach((dataset, i) => {
                    if (dataset.type === 'bar') {
                        const meta = chart.getDatasetMeta(i);
                        meta.data.forEach((bar, index) => {
                            const value = dataset.data[index];
                            if (value > 0) {
                                ctx.fillText(value, bar.x, bar.y - 5);
                            }
                        });
                    }
                });
                ctx.restore();
            }
        }]
    });
};

const showMonthBreakdown = (month, year, label) => {
    breakdownMonthTitle.innerText = `${label} - Paid From`;
    
    const accountTotals = {};
    let totalForMonth = 0;
    
    expenses.forEach(exp => {
        const expDate = new Date(exp.Date);
        if (isNaN(expDate.getTime())) return;
        
        if (expDate.getMonth() === month && expDate.getFullYear() === year) {
            const amount = parseFloat(exp.Amount) || 0;
            const account = exp['Paid From'] || 'Unknown';
            accountTotals[account] = (accountTotals[account] || 0) + amount;
            totalForMonth += amount;
        }
    });
    
    const sortedAccounts = Object.entries(accountTotals).sort((a, b) => b[1] - a[1]);
    
    const colors = [
        '#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6',
        '#8b5cf6', '#14b8a6', '#f43f5e', '#ef4444'
    ];
    
    if (breakdownChartInstance) {
        breakdownChartInstance.destroy();
    }
    
    breakdownChartInstance = new Chart(breakdownChartCanvas, {
        type: 'doughnut',
        data: {
            labels: sortedAccounts.map(a => a[0]),
            datasets: [{
                data: sortedAccounts.map(a => a[1]),
                backgroundColor: colors.slice(0, sortedAccounts.length),
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: '#94a3b8', font: { family: 'Inter' } }
                }
            },
            cutout: '70%'
        }
    });
    
    breakdownList.innerHTML = "";
    if (sortedAccounts.length === 0) {
        breakdownList.innerHTML = "<p class='text-muted' style='text-align: center;'>No expenses for this month.</p>";
    } else {
        sortedAccounts.forEach(([account, amount]) => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.padding = '0.75rem 0';
            div.style.borderBottom = '1px solid var(--card-border)';
            
            const percent = ((amount / totalForMonth) * 100).toFixed(1);
            
            div.innerHTML = `
                <div>
                    <h4 style="margin: 0; font-size: 0.95rem;">${account}</h4>
                    <span style="font-size: 0.8rem; color: var(--text-muted);">${percent}%</span>
                </div>
                <div style="font-weight: 600;">${formatCurrency(amount)}</div>
            `;
            breakdownList.appendChild(div);
        });
        if (breakdownList.lastChild) {
            breakdownList.lastChild.style.borderBottom = 'none';
        }
    }
    
    breakdownModal.classList.add('show');
    document.body.style.overflow = 'hidden';
};

// Modal Logic
fabAdd.addEventListener('click', () => {
    editingRowIndex = null;
    document.querySelector('#add-modal h2').innerText = 'Add Expense';
    document.getElementById('update-btn').innerText = 'Add';
    
    addExpenseForm.reset();
    
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    expDateInput.value = today;
    
    addModal.classList.add('show');
    document.body.style.overflow = 'hidden';
});

closeModalBtn.addEventListener('click', () => {
    addModal.classList.remove('show');
    document.body.style.overflow = '';
});

closeSuccessBtn.addEventListener('click', () => {
    successModal.classList.remove('show');
    document.body.style.overflow = '';
});

closeBreakdownBtn.addEventListener('click', () => {
    breakdownModal.classList.remove('show');
    document.body.style.overflow = '';
});

viewAllBtn.addEventListener('click', () => {
    renderExpenses([...expenses].reverse(), allExpensesList);
    allExpensesModal.classList.add('show');
    document.body.style.overflow = 'hidden';
});

closeAllExpensesBtn.addEventListener('click', () => {
    allExpensesModal.classList.remove('show');
    document.body.style.overflow = '';
});

// Form Submission
addExpenseForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const date = document.getElementById('exp-date').value;
    const amount = document.getElementById('exp-amount').value;
    const account = document.getElementById('exp-account').value;
    const category = document.getElementById('exp-category').value;
    const desc = document.getElementById('exp-desc').value;
    
    const payload = {
        pin: userPin,
        profile: currentProfile,
        action: editingRowIndex ? 'edit' : 'add',
        row: editingRowIndex,
        date: date,
        amount: parseFloat(amount),
        paidFrom: account,
        category: category,
        description: desc
    };
    
    const isEdit = !!editingRowIndex;
    showLoading(isEdit ? "Updating..." : "Adding...");
    try {
        if (isEdit) {
            await db.collection("expenses").doc(editingRowIndex).update({
                Date: date,
                Amount: parseFloat(amount),
                'Paid From': account,
                Category: category,
                Description: desc
            });
            const expIndex = expenses.findIndex(e => e.id == editingRowIndex);
            if (expIndex !== -1) {
                expenses[expIndex] = {
                    ...expenses[expIndex],
                    'Date': date,
                    'Amount': amount,
                    'Paid From': account,
                    'Category': category,
                    'Description': desc
                };
            }
        } else {
            const docRef = await db.collection("expenses").add({
                profile: currentProfile,
                Date: date,
                Amount: parseFloat(amount),
                'Paid From': account,
                Category: category,
                Description: desc,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            expenses.push({
                id: docRef.id,
                'Date': date,
                'Amount': amount,
                'Paid From': account,
                'Category': category,
                'Description': desc
            });
            expenses.sort((a, b) => new Date(a.Date) - new Date(b.Date));
        }
        
        updateDashboard();
        if (allExpensesModal.classList.contains('show')) {
            renderExpenses([...expenses].reverse(), allExpensesList);
        }
        addExpenseForm.reset();
        addModal.classList.remove('show');
        document.body.style.overflow = '';
        
        document.querySelector('#success-modal h2').innerText = isEdit ? 'Update Successful' : 'Add Successful';
        document.querySelector('#success-modal p').innerText = isEdit ? 'Your expense has been updated.' : 'Your expense has been added.';
        successModal.classList.add('show');
        document.body.style.overflow = 'hidden';
    } catch (error) {
        console.error("Error saving expense:", error);
        alert("Failed to save to Firebase.");
    } finally {
        hideLoading();
    }
});

// Settings Modals Logic
settingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('show');
    document.body.style.overflow = 'hidden';
});

closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('show');
    document.body.style.overflow = '';
});

// Change Password
optChangePassword.addEventListener('click', () => {
    settingsModal.classList.remove('show');
    changePwdForm.reset();
    pwdError.innerText = "";
    changePasswordModal.classList.add('show');
});

closeChangePwdBtn.addEventListener('click', () => {
    changePasswordModal.classList.remove('show');
    document.body.style.overflow = '';
});

changePwdForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPin = document.getElementById('old-pin').value;
    const newPin = document.getElementById('new-pin').value;
    const confirmPin = document.getElementById('confirm-pin').value;
    
    if (oldPin !== userPin) {
        pwdError.innerText = "Old PIN is incorrect.";
        return;
    }
    if (newPin !== confirmPin) {
        pwdError.innerText = "New PINs do not match.";
        return;
    }
    if (newPin.length !== 4) {
        pwdError.innerText = "PIN must be 4 digits.";
        return;
    }
    
    pwdError.innerText = "";
    showLoading("Updating Password...");
    
    try {
        await db.collection("settings").doc(currentProfile).set({ pin: newPin }, { merge: true });
        const result = { status: "success" };
        if (result.status === "error") {
            pwdError.innerText = result.error || "Failed to update password.";
        } else {
            userPin = newPin; // Update locally
            changePasswordModal.classList.remove('show');
            document.body.style.overflow = '';
            
            document.querySelector('#success-modal h2').innerText = 'Password Updated';
            document.querySelector('#success-modal p').innerText = 'Your PIN has been successfully changed.';
            successModal.classList.add('show');
        }
    } catch (error) {
        console.error("Change Pwd Error:", error);
        pwdError.innerText = "Network error.";
    } finally {
        hideLoading();
    }
});

// Manage Options
const renderManageOptions = () => {
    manageOptionsList.innerHTML = "";
    const list = currentManagingOption === 'paid_from' ? appSettings.paidFrom : appSettings.categories;
    
    if (!list || list.length === 0) {
        manageOptionsList.innerHTML = "<p class='text-muted' style='text-align: center;'>No options found.</p>";
        return;
    }
    
    list.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'setting-item';
        div.innerHTML = `
            <span>${opt}</span>
            <button class="icon-btn delete-opt-btn" data-val="${opt}" title="Delete">
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
        `;
        manageOptionsList.appendChild(div);
    });
};

const openManageOptions = (type) => {
    currentManagingOption = type;
    settingsModal.classList.remove('show');
    manageOptionsTitle.innerText = type === 'paid_from' ? "Edit 'Paid From'" : "Edit 'Expense Category'";
    addOptionForm.reset();
    renderManageOptions();
    manageOptionsModal.classList.add('show');
};

optEditPaidFrom.addEventListener('click', () => openManageOptions('paid_from'));
optEditCategory.addEventListener('click', () => openManageOptions('category'));

closeManageOptionsBtn.addEventListener('click', () => {
    manageOptionsModal.classList.remove('show');
    document.body.style.overflow = '';
});

addOptionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newVal = newOptionInput.value.trim();
    if (!newVal) return;
    
    showLoading("Adding Option...");
    try {
        await db.collection("settings").doc(currentProfile).set(appSettings);
        const result = { status: "success" };
        if (result.status === "error") {
            alert("Error adding option: " + (result.error || "Unknown error"));
        } else {
            if (currentManagingOption === 'paid_from') {
                if (!appSettings.paidFrom.includes(newVal)) appSettings.paidFrom.push(newVal);
            } else {
                if (!appSettings.categories.includes(newVal)) appSettings.categories.push(newVal);
            }
            populateDropdowns();
            renderManageOptions();
            addOptionForm.reset();
        }
    } catch (error) {
        console.error("Add Option Error:", error);
        alert("Failed to add option. Network error.");
    } finally {
        hideLoading();
    }
});

// Event Delegation for Delete Option Button
manageOptionsList.addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.delete-opt-btn');
    if (deleteBtn) {
        const val = deleteBtn.getAttribute('data-val');
        if (confirm(`Are you sure you want to delete "${val}"?`)) {
            showLoading("Deleting Option...");
            try {
                await db.collection("settings").doc(currentProfile).set(appSettings);
        const result = { status: "success" };
        if (result.status === "error") {
                    alert("Error deleting option: " + (result.error || "Unknown error"));
                } else {
                    if (currentManagingOption === 'paid_from') {
                        appSettings.paidFrom = appSettings.paidFrom.filter(v => v !== val);
                    } else {
                        appSettings.categories = appSettings.categories.filter(v => v !== val);
                    }
                    populateDropdowns();
                    renderManageOptions();
                }
            } catch (error) {
                console.error("Delete Option Error:", error);
                alert("Failed to delete option. Network error.");
            } finally {
                hideLoading();
            }
        }
    }
});
