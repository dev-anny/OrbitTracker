document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // 1. CONFIGURAÇÃO SUPABASE
    // ==========================================
    const SUPABASE_URL = 'https://hlkzlbtlvsmumkebltlq.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_fckHSeKHC6mVn0sPpse6Lg_SFngUH_v';

    let supabaseClient = null;

    if (window.supabase) {
        try {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        } catch (e) {
            console.error("Erro ao inicializar Supabase:", e);
        }
    }

    // ==========================================
    // 2. VARIÁVEIS E DOM
    // ==========================================
    const BASE_DAILY_GOAL_SECONDS = 3600; // 1 hora
    const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * 45;

    let systemDB = {};
    let currentUser = null;
    let isSaving = false;

    let state = {
        isRunning: false,
        timerInterval: null,
        clockInterval: null,
        rankingRefreshInterval: null
    };

    const els = {
        loginScreen: document.getElementById('login-screen'),
        appContent: document.getElementById('app-content'),
        inputUsername: document.getElementById('input-username'),
        btnLogin: document.getElementById('btn-login'),
        btnLogout: document.getElementById('btn-logout'),
        loadingOverlay: document.getElementById('loading-overlay'),

        userNameDisplay: document.getElementById('user-name'),
        userStreak: document.getElementById('user-streak'),
        liveDate: document.getElementById('live-date'),
        liveClock: document.getElementById('live-clock'),

        tabTracker: document.getElementById('tab-tracker'),
        tabRanking: document.getElementById('tab-ranking'),
        viewTracker: document.getElementById('view-tracker'),
        viewRanking: document.getElementById('view-ranking'),

        timeDisplay: document.getElementById('time-display'),
        progressCircle: document.getElementById('progress-circle'),
        btnToggleTimer: document.getElementById('btn-toggle-timer'),
        btnEndDay: document.getElementById('btn-end-day'),
        toggleIcon: document.getElementById('toggle-icon'),
        toggleText: document.getElementById('toggle-text'),
        statusBadge: document.getElementById('status-badge'),

        dailyGoalDisplay: document.getElementById('daily-goal-display'),
        goalProgressBar: document.getElementById('goal-progress-bar'),
        goalPercentage: document.getElementById('goal-percentage'),

        debtCard: document.getElementById('debt-card'),
        debtDisplay: document.getElementById('debt-display'),

        summaryDebt: document.getElementById('summary-debt'),
        summaryTotalGoal: document.getElementById('summary-total-goal'),

        rankingBody: document.getElementById('ranking-body'),
        rankingLoading: document.getElementById('ranking-loading'),
        rankingTableContainer: document.getElementById('ranking-table-container'),

        endDayModal: document.getElementById('end-day-modal'),
        endDayModalContent: document.getElementById('end-day-modal-content'),
        modalStudied: document.getElementById('modal-studied'),
        modalPercentage: document.getElementById('modal-percentage'),
        btnCancelEnd: document.getElementById('btn-cancel-end'),
        btnConfirmEnd: document.getElementById('btn-confirm-end'),

        historyModal: document.getElementById('history-modal'),
        historyModalContent: document.getElementById('history-modal-content'),
        historyUsername: document.getElementById('history-username'),
        historyTotalTime: document.getElementById('history-total-time'),
        historyTotalDebt: document.getElementById('history-total-debt'),
        historyList: document.getElementById('history-list'),
        productivityChart: document.getElementById('productivity-chart'),
        btnCloseHistory: document.getElementById('btn-close-history')
    };

    function initApp() {
        startLiveClock();
        els.btnLogin.addEventListener('click', performLogin);
        els.inputUsername.addEventListener('keypress', (e) => { if (e.key === 'Enter') performLogin(); });
        els.btnLogout.addEventListener('click', performLogout);
        els.btnToggleTimer.addEventListener('click', toggleTimer);
        els.btnEndDay.addEventListener('click', openEndDayModal);
        els.btnCancelEnd.addEventListener('click', closeEndDayModal);
        els.btnConfirmEnd.addEventListener('click', confirmEndDay);
        els.btnCloseHistory.addEventListener('click', closeHistoryModal);
        els.tabTracker.addEventListener('click', () => switchTab('tracker'));
        els.tabRanking.addEventListener('click', () => switchTab('ranking'));
    }

    // ==========================================
    // 3. UTILITÁRIOS (Datas, Tempo, Patentes)
    // ==========================================
    function formatTime(seconds, full = true) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (full) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${h}h ${m.toString().padStart(2, '0')}m`;
    }

    function getTodayStr() {
        const d = new Date();
        return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
    }

    // Converte DD/MM/YYYY para Objeto Date para matemática de calendário
    function parseBRDate(dateStr) {
        if (!dateStr) return new Date();
        const parts = dateStr.split('/');
        if (parts.length === 3) return new Date(parts[2], parts[1] - 1, parts[0]);
        return new Date(dateStr); // fallback
    }

    function getPatenteInfo(totalSeconds) {
        const hours = totalSeconds / 3600;
        if (hours < 10) return { name: "Cadete Espacial", color: "text-slate-400", bg: "bg-slate-400/10", border: "border-slate-400/30", icon: "fa-user-astronaut" };
        if (hours < 30) return { name: "Explorador", color: "text-space-star", bg: "bg-space-star/10", border: "border-space-star/30", icon: "fa-satellite" };
        if (hours < 70) return { name: "Comandante", color: "text-space-nebula", bg: "bg-space-nebula/10", border: "border-space-nebula/30", icon: "fa-shuttle-space" };
        if (hours < 150) return { name: "Mestre da Órbita", color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/30", icon: "fa-meteor" };
        return { name: "Guardião Galáctico", color: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/30", icon: "fa-sun" };
    }

    // Lógica de Ofensiva (Streak) baseada no histórico passado + hoje
    function calculateStreak(user) {
        let streak = 0;
        if (!user.history) return 0;

        // Cria um dicionário de dias atingidos para fácil checagem
        const successDays = {};
        user.history.forEach(h => { if (h.studied >= h.goal && h.goal > 0) successDays[h.date] = true; });

        const today = getTodayStr();
        const totalGoalToday = BASE_DAILY_GOAL_SECONDS + user.debt;

        // Verifica hoje
        if (user.studiedToday >= totalGoalToday) {
            streak++;
            successDays[today] = true;
        }

        // Verifica retroativamente dias anteriores sem pular
        let checkDate = parseBRDate(today);
        checkDate.setDate(checkDate.getDate() - 1); // começa a olhar a partir de ontem

        while (true) {
            const str = `${checkDate.getDate().toString().padStart(2, '0')}/${(checkDate.getMonth() + 1).toString().padStart(2, '0')}/${checkDate.getFullYear()}`;
            if (successDays[str]) {
                streak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                break; // Quebrou a sequência
            }
        }
        return streak;
    }

    function startLiveClock() {
        const updateClock = () => {
            const now = new Date();
            els.liveDate.textContent = now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '').replace(' de', '');
            els.liveClock.textContent = now.toLocaleTimeString('pt-BR');

            // Virada da meia-noite
            const todayStr = getTodayStr();
            if (currentUser && systemDB[currentUser] && systemDB[currentUser].lastLogin !== todayStr) {
                if (state.isRunning) stopTimer();
                processTimeJump().then(() => {
                    updateUI();
                    alert("☀️ Um novo dia em órbita começou! Suas pendências foram processadas no calendário.");
                });
            }
        };
        updateClock();
        state.clockInterval = setInterval(updateClock, 1000);
    }

    // ==========================================
    // 4. INTEGRAÇÃO SUPABASE & SYNC
    // ==========================================
    function showLoading(text) { els.loadingOverlay.classList.remove('opacity-0', 'pointer-events-none'); }
    function hideLoading() { els.loadingOverlay.classList.add('opacity-0', 'pointer-events-none'); }

    async function carregarUsuarios(forRanking = false) {
        if (forRanking) { els.rankingLoading.classList.remove('hidden'); els.rankingTableContainer.classList.add('hidden'); }
        try {
            if (!supabaseClient) throw new Error("Supabase Client nulo. Verifique CDN/Chaves.");
            const { data, error } = await supabaseClient.from('usuarios').select('*');
            if (error) throw new Error(error.message);

            if (data) {
                // Backup vital: Não deixa o fetch esmagar o cronômetro do usuário atual rodando na tela
                const backupCurrent = currentUser && systemDB[currentUser] ? { ...systemDB[currentUser] } : null;

                systemDB = {};
                data.forEach(user => {
                    systemDB[user.username] = {
                        studiedToday: user.studied_today || 0,
                        debt: user.debt || 0,
                        lastLogin: user.last_login || getTodayStr(),
                        totalStudiedAllTime: user.total_studied || 0,
                        history: user.history || []
                    };
                });

                // Restaura o cache do cronômetro local para o usuário logado
                if (backupCurrent && systemDB[currentUser]) {
                    if (backupCurrent.studiedToday > systemDB[currentUser].studiedToday) {
                        systemDB[currentUser].studiedToday = backupCurrent.studiedToday;
                        systemDB[currentUser].totalStudiedAllTime = backupCurrent.totalStudiedAllTime;
                    }
                }

                if (forRanking) renderRanking();
                if (currentUser) {
                    els.userStreak.textContent = calculateStreak(systemDB[currentUser]);
                }
            }
            return true;
        } catch (error) {
            console.error('Falha DB:', error);
            alert(`Falha na conexão:\n${error.message}`);
            return false;
        } finally {
            if (forRanking) { els.rankingLoading.classList.add('hidden'); els.rankingTableContainer.classList.remove('hidden'); }
        }
    }

    async function salvarUsuarioDB(username) {
        if (isSaving || !systemDB[username] || !supabaseClient) return;
        isSaving = true;
        const u = systemDB[username];
        try {
            await supabaseClient.from('usuarios').upsert({
                username: username, studied_today: u.studiedToday, debt: u.debt,
                last_login: u.lastLogin, total_studied: u.totalStudiedAllTime, history: u.history
            });
        } catch (error) { console.error('Erro Salvar:', error); }
        finally { isSaving = false; }
    }

    // Atualiza (ou insere) o dia atual no histórico - Impede duplicatas
    function upsertHistoryToday() {
        const u = systemDB[currentUser];
        const goal = BASE_DAILY_GOAL_SECONDS + u.debt;
        const today = getTodayStr();

        if (!u.history) u.history = [];
        const idx = u.history.findIndex(h => h.date === today);

        if (idx > -1) {
            u.history[idx].studied = u.studiedToday;
            u.history[idx].goal = goal;
        } else {
            u.history.unshift({ date: today, studied: u.studiedToday, goal: goal });
        }
    }

    // ==========================================
    // 5. MOTOR DO TEMPO (TIME JUMP)
    // ==========================================

    // Lida inteligentemente com dias que passaram enquanto o usuário estava off
    async function processTimeJump() {
        const userObj = systemDB[currentUser];
        const todayStr = getTodayStr();

        if (userObj.lastLogin !== todayStr) {
            const lastLoginDate = parseBRDate(userObj.lastLogin);
            const now = parseBRDate(todayStr);

            const diffTime = Math.abs(now - lastLoginDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays > 0) {
                const goalLastLogin = BASE_DAILY_GOAL_SECONDS + userObj.debt;

                // Garante que o último dia logado está no histórico com o valor correto
                if (!userObj.history) userObj.history = [];
                const idx = userObj.history.findIndex(h => h.date === userObj.lastLogin);
                if (idx > -1) {
                    userObj.history[idx].studied = userObj.studiedToday;
                } else {
                    userObj.history.unshift({ date: userObj.lastLogin, studied: userObj.studiedToday, goal: goalLastLogin });
                }

                // Calcula dívida deixada do último dia
                let newDebt = Math.max(0, goalLastLogin - userObj.studiedToday);

                // Dias completamente ausentes (Skipped Days)
                if (diffDays > 1) {
                    const skipped = diffDays - 1;
                    newDebt += (BASE_DAILY_GOAL_SECONDS * skipped);

                    // Cria histórico zerado para as faltas (para o gráfico e tracking)
                    for (let i = 1; i <= skipped; i++) {
                        const sd = new Date(lastLoginDate);
                        sd.setDate(sd.getDate() + i);
                        const sdStr = `${sd.getDate().toString().padStart(2, '0')}/${(sd.getMonth() + 1).toString().padStart(2, '0')}/${sd.getFullYear()}`;

                        userObj.history.unshift({ date: sdStr, studied: 0, goal: BASE_DAILY_GOAL_SECONDS });
                    }
                }

                // Zera o painel para o DIA DE HOJE
                userObj.studiedToday = 0;
                userObj.debt = newDebt;
                userObj.lastLogin = todayStr;

                await salvarUsuarioDB(currentUser);
            }
        }
    }

    // ==========================================
    // 6. CONTROLE DO SISTEMA (LOGIN/PLAY)
    // ==========================================
    async function performLogin() {
        const username = els.inputUsername.value.trim().replace(/\s+/g, '_');
        if (!username) return alert("Insira um nome válido.");

        showLoading();
        const sucesso = await carregarUsuarios();
        if (!sucesso) { hideLoading(); return; }

        currentUser = username;
        const todayStr = getTodayStr();

        if (!systemDB[currentUser]) {
            systemDB[currentUser] = { studiedToday: 0, debt: 0, lastLogin: todayStr, totalStudiedAllTime: 0, history: [] };
            await salvarUsuarioDB(currentUser);
        } else {
            await processTimeJump(); // Aplica a matemática de ausência
        }

        hideLoading();
        els.loginScreen.classList.add('hidden');
        els.appContent.classList.remove('hidden');
        setTimeout(() => els.appContent.classList.add('visible'), 50);

        updateUI();
        switchTab('tracker');

        // Atualiza ranking passivamente a cada 1 min
        if (!state.rankingRefreshInterval) {
            state.rankingRefreshInterval = setInterval(() => {
                if (!els.viewRanking.classList.contains('hidden')) carregarUsuarios(true);
            }, 60000);
        }
    }

    async function performLogout() {
        stopTimer();
        showLoading();
        upsertHistoryToday(); // Garante o backup no JSON antes de sair
        await salvarUsuarioDB(currentUser);
        hideLoading();

        currentUser = null;
        if (state.rankingRefreshInterval) clearInterval(state.rankingRefreshInterval);
        els.inputUsername.value = '';
        els.appContent.classList.remove('visible');
        setTimeout(() => { els.appContent.classList.add('hidden'); els.loginScreen.classList.remove('hidden'); }, 300);
    }

    function switchTab(tab) {
        if (tab === 'tracker') {
            els.tabTracker.classList.add('active', 'text-white'); els.tabTracker.classList.remove('text-slate-400');
            els.tabRanking.classList.remove('active', 'text-white'); els.tabRanking.classList.add('text-slate-400');
            els.viewTracker.classList.remove('hidden'); els.viewRanking.classList.add('hidden');
        } else {
            els.tabRanking.classList.add('active', 'text-white'); els.tabRanking.classList.remove('text-slate-400');
            els.tabTracker.classList.remove('active', 'text-white'); els.tabTracker.classList.add('text-slate-400');
            els.viewTracker.classList.add('hidden'); els.viewRanking.classList.remove('hidden');
            carregarUsuarios(true);
        }
    }

    function toggleTimer() { state.isRunning ? stopTimer() : startTimer(); }

    function startTimer() {
        if (state.isRunning || !currentUser) return;
        state.isRunning = true;

        els.toggleIcon.className = 'fa-solid fa-pause'; els.toggleText.textContent = 'Pausar Motor';
        els.btnToggleTimer.classList.replace('bg-space-700', 'bg-space-800');
        els.statusBadge.innerHTML = '<i class="fa-solid fa-satellite-dish fa-beat text-xs"></i> Sinal Captado (Contando)';
        els.statusBadge.className = 'absolute top-6 left-1/2 -translate-x-1/2 bg-blue-500/20 text-blue-300 border border-blue-500/30 px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-2 backdrop-blur-md transition-all drop-shadow-[0_0_10px_rgba(59,130,246,0.3)]';
        els.timeDisplay.classList.replace('timer-paused', 'timer-active'); els.timeDisplay.classList.add('text-white');
        els.progressCircle.style.strokeDashoffset = '283'; // force reset trans

        state.timerInterval = setInterval(() => {
            systemDB[currentUser].studiedToday++;
            systemDB[currentUser].totalStudiedAllTime++;
            updateUI();
            if (systemDB[currentUser].studiedToday % 10 === 0) salvarUsuarioDB(currentUser); // Salva a cada 10s
        }, 1000);
    }

    function stopTimer() {
        if (!state.isRunning) return;
        state.isRunning = false;
        clearInterval(state.timerInterval);

        els.toggleIcon.className = 'fa-solid fa-play'; els.toggleText.textContent = 'Retomar Motor';
        els.btnToggleTimer.classList.replace('bg-space-800', 'bg-space-700');
        els.statusBadge.innerHTML = '<i class="fa-solid fa-pause text-xs"></i> Sistema Pausado';
        els.statusBadge.className = 'absolute top-6 left-1/2 -translate-x-1/2 bg-slate-500/20 text-slate-300 border border-slate-500/30 px-4 py-1.5 rounded-full text-sm font-medium flex items-center gap-2 backdrop-blur-md transition-all';
        els.timeDisplay.classList.replace('timer-active', 'timer-paused'); els.timeDisplay.classList.remove('text-white');

        upsertHistoryToday();
        salvarUsuarioDB(currentUser);
    }

    function updateUI() {
        if (!currentUser) return;
        const u = systemDB[currentUser];
        const totalGoal = BASE_DAILY_GOAL_SECONDS + u.debt;

        els.timeDisplay.textContent = formatTime(u.studiedToday);
        els.dailyGoalDisplay.textContent = formatTime(totalGoal, false);
        els.summaryTotalGoal.textContent = formatTime(totalGoal, false);

        // Cabeçalho - Patente e Streak
        const patente = getPatenteInfo(u.totalStudiedAllTime || 0);
        els.userNameDisplay.innerHTML = `${currentUser.replace('_', ' ')} <br class="sm:hidden"><span class="text-[10px] sm:ml-2 px-2 py-0.5 rounded-full ${patente.bg} ${patente.color} ${patente.border} border uppercase tracking-wider inline-flex items-center gap-1 mt-1 sm:mt-0"><i class="fa-solid ${patente.icon}"></i> ${patente.name}</span>`;
        els.userStreak.textContent = calculateStreak(u);

        if (u.debt > 0) {
            els.debtCard.style.display = 'block';
            els.debtDisplay.textContent = formatTime(u.debt, false);
            els.summaryDebt.textContent = `+ ${formatTime(u.debt, false)}`;
        } else {
            els.debtCard.style.display = 'none';
            els.summaryDebt.textContent = "0h 00m";
            els.summaryDebt.className = 'font-medium text-slate-500';
        }

        let p = (u.studiedToday / totalGoal) * 100;
        if (p > 100) p = 100;
        if (isNaN(p)) p = 0;

        els.goalProgressBar.style.width = `${p}%`;
        els.goalPercentage.textContent = `${Math.floor(p)}% de avanço`;

        // Metas e cores dinâmicas
        if (p >= 100) {
            els.goalProgressBar.className = "bg-gradient-to-r from-space-star to-green-400 h-full rounded-full transition-all duration-1000 relative";
            if (state.isRunning) {
                els.statusBadge.innerHTML = '<i class="fa-solid fa-check-double text-xs"></i> Sobrecarregando (Meta Atingida!)';
                els.statusBadge.className = 'absolute top-6 left-1/2 -translate-x-1/2 bg-green-500/20 text-green-300 border border-green-500/30 px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-2 backdrop-blur-md transition-all drop-shadow-[0_0_15px_rgba(74,222,128,0.4)]';
            }
        } else {
            els.goalProgressBar.className = "bg-gradient-to-r from-space-star to-space-nebula h-full rounded-full transition-all duration-1000 relative";
        }

        const offset = CIRCLE_CIRCUMFERENCE - (p / 100) * CIRCLE_CIRCUMFERENCE;
        els.progressCircle.style.strokeDashoffset = offset;
    }

    // ==========================================
    // 7. MODAIS (SALVAR/SAIR & HISTÓRICO)
    // ==========================================
    function openEndDayModal() {
        stopTimer();
        const u = systemDB[currentUser];
        const totalGoal = BASE_DAILY_GOAL_SECONDS + u.debt;
        let p = (u.studiedToday / totalGoal) * 100;

        els.modalStudied.textContent = formatTime(u.studiedToday);
        els.modalPercentage.textContent = `${Math.floor(p > 100 ? 100 : p)}% concluído`;
        if (p >= 100) els.modalPercentage.className = "font-bold text-green-400 bg-green-400/10 border border-green-400/20 px-2 py-1 rounded";
        else els.modalPercentage.className = "font-bold text-space-star bg-space-star/10 border border-space-star/20 px-2 py-1 rounded";

        els.endDayModal.classList.remove('opacity-0', 'pointer-events-none');
        els.endDayModalContent.classList.remove('scale-95');
    }
    function closeEndDayModal() {
        els.endDayModal.classList.add('opacity-0', 'pointer-events-none');
        els.endDayModalContent.classList.add('scale-95');
    }
    async function confirmEndDay() { closeEndDayModal(); await performLogout(); }

    // Lógica do Modal de Ranking e Histórico Completo com Gráficos
    function renderRanking() {
        const users = Object.entries(systemDB).map(([username, data]) => ({ username, ...data }));
        users.sort((a, b) => b.studiedToday - a.studiedToday); // Rankeia por esforço no dia
        els.rankingBody.innerHTML = '';

        if (users.length === 0) return els.rankingBody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-500">Espaço vazio.</td></tr>`;

        users.forEach((u, index) => {
            const totalGoal = BASE_DAILY_GOAL_SECONDS + u.debt;
            const percentage = totalGoal > 0 ? (u.studiedToday / totalGoal) * 100 : 100;
            const streak = calculateStreak(u);

            let statusHtml = '';
            if (percentage >= 100) statusHtml = `<div class="w-full bg-space-900 rounded-full h-2 overflow-hidden" title="Meta Concluída"><div class="bg-green-500 h-full" style="width: 100%"></div></div><p class="text-[10px] text-green-400 mt-1">Sincronizado</p>`;
            else if (u.studiedToday > 0) statusHtml = `<div class="w-full bg-space-900 rounded-full h-2 overflow-hidden"><div class="bg-space-star h-full" style="width: ${percentage}%"></div></div><p class="text-[10px] text-space-star mt-1">Em Órbita</p>`;
            else statusHtml = `<div class="w-full bg-space-900 rounded-full h-2 overflow-hidden"><div class="bg-slate-600 h-full" style="width: 0%"></div></div><p class="text-[10px] text-slate-500 mt-1">Hibernando</p>`;

            let rankClass = '', rankIcon = `#${index + 1}`;
            if (index === 0) { rankClass = 'rank-1'; rankIcon = '<i class="fa-solid fa-crown rank-icon text-lg"></i>'; }
            else if (index === 1) { rankClass = 'rank-2'; rankIcon = '<i class="fa-solid fa-medal rank-icon text-lg"></i>'; }
            else if (index === 2) { rankClass = 'rank-3'; rankIcon = '<i class="fa-solid fa-medal rank-icon text-lg"></i>'; }

            const isMe = u.username === currentUser ? `<span class="ml-2 bg-space-nebula/30 text-space-star text-[10px] px-2 py-0.5 rounded border border-space-nebula/50 uppercase tracking-wider">Você</span>` : '';
            const patente = getPatenteInfo(u.totalStudiedAllTime || 0);

            const row = document.createElement('tr');
            row.className = `hover:bg-space-800/40 transition-colors ${rankClass} border-b border-space-700/30`;
            row.innerHTML = `
                        <td class="py-4 pl-4 font-bold text-slate-300">${rankIcon}</td>
                        <td class="py-4 font-medium text-white">
                            <div class="flex items-center">
                                <div class="w-10 h-10 rounded-xl bg-space-800 flex items-center justify-center mr-3 border border-space-700 text-sm shadow-inner shrink-0">
                                    ${u.username.substring(0, 2).toUpperCase()}
                                </div>
                                <div>
                                    <div class="flex items-center">${u.username.replace('_', ' ')} ${isMe}</div>
                                    <div class="text-[10px] ${patente.color} mt-0.5 flex items-center gap-1 opacity-80"><i class="fa-solid ${patente.icon}"></i> ${patente.name}</div>
                                </div>
                            </div>
                        </td>
                        <td class="py-4 text-center">
                            <span class="inline-flex items-center justify-center bg-space-900 border border-space-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-300 shadow-sm"><i class="fa-solid fa-fire text-space-fire mr-1.5 opacity-80"></i>${streak}</span>
                        </td>
                        <td class="py-4 text-center font-mono text-slate-200">${formatTime(u.studiedToday, false)}</td>
                        <td class="py-4 text-center align-middle w-24 pr-4">${statusHtml}</td>
                        <td class="py-4 text-right pr-4">
                            <button onclick="window.openHistoryModal('${u.username}')" class="text-slate-400 hover:text-space-star transition-colors p-2.5 bg-space-800/80 rounded-xl border border-space-700 hover:bg-space-700 hover:border-space-500 shadow-sm" title="Analisar Logs">
                                <i class="fa-solid fa-chart-column"></i>
                            </button>
                        </td>
                    `;
            els.rankingBody.appendChild(row);
        });
    }

    window.openHistoryModal = function (username) {
        const user = systemDB[username];
        if (!user) return;

        const patente = getPatenteInfo(user.totalStudiedAllTime || 0);
        els.historyUsername.innerHTML = `${username.replace('_', ' ')} <span class="text-[10px] ml-2 px-2 py-0.5 rounded-full ${patente.bg} ${patente.color} border ${patente.border} uppercase tracking-wider align-middle"><i class="fa-solid ${patente.icon} mr-1"></i> ${patente.name}</span>`;
        els.historyTotalTime.textContent = `Tempo Total: ${formatTime(user.totalStudiedAllTime || 0, false)}`;
        els.historyTotalDebt.textContent = `Déficit Pendente: ${formatTime(user.debt || 0, false)}`;

        // Prepara histórico e funde os dados de hoje se for o próprio usuário
        let fullHistory = user.history ? [...user.history] : [];

        // Ordena por data decrescente
        fullHistory.sort((a, b) => parseBRDate(b.date) - parseBRDate(a.date));

        // Montagem da Lista
        els.historyList.innerHTML = '';
        if (fullHistory.length === 0) {
            els.historyList.innerHTML = `<div class="text-center py-6 border border-dashed border-space-700 rounded-2xl"><p class="text-slate-500 text-sm">Sem logs anteriores.</p></div>`;
        } else {
            fullHistory.forEach(item => {
                const percentage = item.goal > 0 ? (item.studied / item.goal) * 100 : 100;
                const isSuccess = percentage >= 100;

                const el = document.createElement('div');
                el.className = `flex justify-between items-center p-4 rounded-xl border ${isSuccess ? 'bg-green-500/5 border-green-500/20' : 'bg-space-800/60 border-space-700'}`;
                el.innerHTML = `
                            <div class="flex items-center gap-4">
                                <div class="w-10 h-10 rounded-xl flex items-center justify-center ${isSuccess ? 'bg-green-500/20 text-green-400' : 'bg-space-900 border border-space-700 text-slate-400'}">
                                    <i class="fa-solid ${isSuccess ? 'fa-check' : 'fa-calendar-days'}"></i>
                                </div>
                                <div>
                                    <p class="font-medium text-slate-200">${item.date} ${item.date === getTodayStr() ? '<span class="text-[10px] bg-space-nebula/30 text-space-star px-1 rounded uppercase">Hoje</span>' : ''}</p>
                                    <p class="text-[11px] text-slate-400">Meta: ${formatTime(item.goal, false)}</p>
                                </div>
                            </div>
                            <div class="text-right">
                                <p class="font-bold font-mono ${isSuccess ? 'text-green-400' : 'text-white'} text-lg">${formatTime(item.studied, false)}</p>
                                <p class="text-xs ${isSuccess ? 'text-green-500 font-medium' : 'text-space-star'}">${Math.floor(percentage)}% concluído</p>
                            </div>
                        `;
                els.historyList.appendChild(el);
            });
        }

        // Montagem do Gráfico de Produtividade (Últimos 7 dias registrados)
        els.productivityChart.innerHTML = '';
        const last7 = fullHistory.slice(0, 7).reverse(); // Inverte p/ cronológico (esq->dir)

        if (last7.length > 0) {
            const maxStudied = Math.max(...last7.map(h => h.studied), BASE_DAILY_GOAL_SECONDS * 2); // Eixo Y máx adaptável

            last7.forEach(item => {
                const pHeight = Math.max((item.studied / maxStudied) * 100, 2); // Min 2% p/ ver algo
                const isSuccess = item.studied >= item.goal && item.goal > 0;
                const barColor = isSuccess ? 'bg-green-500' : 'bg-space-star';
                const dayLabel = item.date.substring(0, 5); // Ex: 23/09

                els.productivityChart.innerHTML += `
                            <div class="bar-wrapper">
                                <div class="bar-tooltip bg-space-900 border border-space-700 text-white px-2 py-1 rounded-md z-10">${formatTime(item.studied, false)}</div>
                                <div class="bar-fill ${barColor} hover:brightness-125 cursor-pointer shadow-lg" style="height: ${pHeight}%;"></div>
                                <span class="bar-label">${dayLabel}</span>
                            </div>
                        `;
            });
        } else {
            els.productivityChart.innerHTML = `<div class="w-full text-center text-slate-600 text-xs py-10">Dados insuficientes para gerar gráfico.</div>`;
        }

        els.historyModal.classList.remove('opacity-0', 'pointer-events-none');
        els.historyModalContent.classList.remove('scale-95');
    };

    function closeHistoryModal() { els.historyModal.classList.add('opacity-0', 'pointer-events-none'); els.historyModalContent.classList.add('scale-95'); }
    window.carregarUsuarios = carregarUsuarios;
    initApp();
});